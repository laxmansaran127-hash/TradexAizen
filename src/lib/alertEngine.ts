import type { Alert, Quote } from './types';

// ── Alert Engine ────────────────────────────────────────────────
// Evaluates alert conditions against incoming quotes. Returns triggered alerts.

export interface AlertEngineCallbacks {
  onTriggered?: (alert: Alert, quote: Quote) => void;
}

class AlertEngine {
  private alerts: Alert[] = [];
  private callbacks = new Set<AlertEngineCallbacks>();
  private lastPrices = new Map<string, number>();
  /** Alert ids already fired — prevents duplicate notifications before React state catches up. */
  private fired = new Set<string>();

  setAlerts(alerts: Alert[]) {
    this.alerts = alerts.filter(a => a.active && !a.triggered);
  }

  subscribe(cbs: AlertEngineCallbacks): () => void {
    this.callbacks.add(cbs);
    return () => this.callbacks.delete(cbs);
  }

  evaluate(quote: Quote) {
    const prevPrice = this.lastPrices.get(quote.symbol);
    this.lastPrices.set(quote.symbol, quote.price);

    for (const alert of this.alerts) {
      if (alert.symbol !== quote.symbol || this.fired.has(alert.id)) continue;

      let triggered = false;
      switch (alert.alert_type) {
        case 'price':
          if (alert.condition === 'crosses_above' && prevPrice !== undefined &&
              prevPrice <= alert.target && quote.price > alert.target) triggered = true;
          if (alert.condition === 'crosses_below' && prevPrice !== undefined &&
              prevPrice >= alert.target && quote.price < alert.target) triggered = true;
          break;
        case 'percent':
          if (Math.abs(quote.changePercent) >= alert.target) triggered = true;
          break;
        case 'rsi':
          // RSI alerts are evaluated with the analysis engine; simplified here
          break;
        case 'volume':
          // Volume spike: target is multiplier of average
          if (quote.volume >= alert.target) triggered = true;
          break;
        case 'breakout':
          if (alert.condition === 'crosses_above' && prevPrice !== undefined &&
              prevPrice <= alert.target && quote.price > alert.target) triggered = true;
          if (alert.condition === 'crosses_below' && prevPrice !== undefined &&
              prevPrice >= alert.target && quote.price < alert.target) triggered = true;
          break;
      }

      if (triggered) {
        this.fired.add(alert.id);
        this.callbacks.forEach(c => c.onTriggered?.(alert, quote));
      }
    }
  }
}

export const alertEngine = new AlertEngine();

// ── Notifications ───────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function sendNotification(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

export function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio not available
  }
}
