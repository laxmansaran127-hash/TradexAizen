// ── Resilient JSON fetching ─────────────────────────────────────
// Timeout + bounded retries + mirror rotation + caller cancellation.
// Never returns guessed data: it either resolves with the provider's JSON or throws.

export class HttpError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  /** Extra attempts per URL for network errors / 5xx / 429 (not for other 4xx). */
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

async function fetchOnce(url: string, timeoutMs: number, outer?: AbortSignal): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onOuterAbort = () => ctl.abort();
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** Try each URL in order; retry transient failures. Throws the last error. */
export async function fetchJson(urls: string | string[], opts: FetchJsonOptions = {}): Promise<unknown> {
  const list = Array.isArray(urls) ? urls : [urls];
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 1;
  let lastErr: unknown = new Error('No URL to fetch');

  for (const url of list) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        return await fetchOnce(url, timeoutMs, opts.signal);
      } catch (err) {
        lastErr = err;
        if ((err as Error)?.name === 'AbortError' && opts.signal?.aborted) throw err;
        const status = err instanceof HttpError ? err.status : undefined;
        const transient = status === undefined || status === 429 || status >= 500;
        if (!transient) break; // 4xx other than 429: retrying the same URL is pointless
        if (attempt < retries) await sleep((opts.retryDelayMs ?? 800) * (attempt + 1), opts.signal);
      }
    }
  }
  throw lastErr;
}
