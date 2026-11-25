// ── ManagedSocket ───────────────────────────────────────────────
// One WebSocket with a safe lifecycle:
//  • generation guard: callbacks from a superseded/closed socket are ignored,
//    so rapid asset/timeframe switching can never leave a zombie connection
//    that reconnects on its own (the bug in the previous per-hook code);
//  • exactly one pending reconnect timer at any time;
//  • exponential backoff with jitter, capped — never a tight loop;
//  • stale-stream watchdog: a socket that is "open" but silent is recycled;
//  • endpoint rotation across mirror URLs;
//  • reconnects promptly on `online` / tab-visible, and cleans every
//    listener/timer in stop().

export type SocketStatus = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

export interface ManagedSocketOptions {
  /** Candidate URLs, tried in rotation when a connection fails. */
  urls: string[];
  onMessage: (raw: string) => void;
  onStatus: (status: SocketStatus) => void;
  /** Called after each successful open (e.g. to send subscribe frames). */
  onOpen?: (send: (data: string) => void) => void;
  /** Recycle the socket when no message arrives for this long. 0 disables. */
  staleAfterMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** After this many consecutive failures the status becomes 'disconnected'
   *  (retries continue at maxDelayMs so recovery is still automatic). */
  maxFastAttempts?: number;
}

export class ManagedSocket {
  private ws: WebSocket | null = null;
  private generation = 0;
  private stopped = true;
  private attempts = 0;
  private urlIndex = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private listenersAttached = false;

  constructor(private readonly opts: ManagedSocketOptions) {}

  /** Epoch ms of the last message received on the current connection. */
  get lastMessageTime(): number { return this.lastMessageAt; }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    this.attachListeners();
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.generation++; // invalidates every in-flight callback
    this.clearReconnect();
    this.clearWatchdog();
    this.detachListeners();
    this.teardownSocket();
  }

  send(data: string): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
      return true;
    }
    return false;
  }

  /** Manual retry (e.g. a "Reconnect" button). Safe to call at any time. */
  retryNow(): void {
    if (this.stopped) return;
    this.attempts = 0;
    this.clearReconnect();
    this.teardownSocket();
    this.generation++;
    this.open();
  }

  // ── internals ────────────────────────────────────────────────

  private open(): void {
    if (this.stopped) return;
    const gen = ++this.generation;
    this.opts.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.urls[this.urlIndex % this.opts.urls.length]);
    } catch {
      this.scheduleReconnect(gen);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (gen !== this.generation || this.stopped) { safeClose(ws); return; }
      this.lastMessageAt = Date.now();
      this.startWatchdog(gen);
      this.opts.onOpen?.(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });
      // 'live' + attempt reset happen on the first real message, so a socket
      // that opens then dies instantly cannot reset the backoff.
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (gen !== this.generation || this.stopped) return;
      this.lastMessageAt = Date.now();
      if (this.attempts !== 0) this.attempts = 0;
      this.opts.onStatus('live');
      try {
        this.opts.onMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch (err) {
        // A bad message must never kill the stream.
        console.error('[ManagedSocket] message handler error', err);
      }
    };

    ws.onerror = () => { safeClose(ws); };

    ws.onclose = () => {
      if (gen !== this.generation || this.stopped) return;
      this.ws = null;
      this.clearWatchdog();
      this.urlIndex++; // rotate mirror on every failure/close
      this.scheduleReconnect(gen);
    };
  }

  private scheduleReconnect(gen: number): void {
    if (this.stopped || gen !== this.generation) return;
    this.clearReconnect();
    this.attempts++;
    const base = this.opts.baseDelayMs ?? 1000;
    const max = this.opts.maxDelayMs ?? 30_000;
    const fast = this.opts.maxFastAttempts ?? 10;
    const exp = Math.min(base * Math.pow(2, this.attempts - 1), max);
    const delay = Math.round(exp * (0.75 + Math.random() * 0.5)); // ±25% jitter
    this.opts.onStatus(this.attempts > fast ? 'disconnected' : 'reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private startWatchdog(gen: number): void {
    this.clearWatchdog();
    const stale = this.opts.staleAfterMs ?? 0;
    if (stale <= 0) return;
    this.watchdog = setInterval(() => {
      if (gen !== this.generation || this.stopped) { this.clearWatchdog(); return; }
      if (Date.now() - this.lastMessageAt > stale) {
        // Silent socket: recycle it. onclose drives the normal backoff path.
        if (this.ws) safeClose(this.ws);
      }
    }, Math.max(200, Math.floor(stale / 3)));
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private clearWatchdog(): void {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }

  private teardownSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
    safeClose(ws);
  }

  private onOnline = (): void => {
    if (!this.stopped && !(this.ws && this.ws.readyState === WebSocket.OPEN)) this.retryNow();
  };

  private onVisible = (): void => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (!this.stopped && !(this.ws && this.ws.readyState === WebSocket.OPEN)) this.retryNow();
  };

  private attachListeners(): void {
    if (this.listenersAttached || typeof window === 'undefined') return;
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.listenersAttached = true;
  }

  private detachListeners(): void {
    if (!this.listenersAttached || typeof window === 'undefined') return;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.listenersAttached = false;
  }
}

function safeClose(ws: WebSocket): void {
  try { ws.close(); } catch { /* already closed */ }
}
