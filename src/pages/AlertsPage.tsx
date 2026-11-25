import { useState, useEffect } from 'react';
import { ASSET_CONFIGS } from '@/types/trading';
import { supabase } from '@/lib/supabase';
import type { Alert, AlertType, AlertCondition } from '@/lib/types';
import { classNames, formatPrice } from '@/lib/format';
import { Bell, BellOff, Plus, Check, Trash2 } from 'lucide-react';
import { sendNotification, playAlertSound } from '@/lib/alertEngine';

interface AlertsPageProps {
  alerts: Alert[];
  onAlertsChange: (alerts: Alert[]) => void;
}

const TRADE_SYMBOLS = ASSET_CONFIGS.map(a => ({ symbol: a.displaySymbol, name: a.name }));

export function AlertsPage({ alerts, onAlertsChange }: AlertsPageProps) {
  const [showForm, setShowForm] = useState(false);
  const [inAppNotifications, setInAppNotifications] = useState<{ id: string; msg: string }[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('alerts').select('*').order('created_at', { ascending: false });
      if (data) onAlertsChange(data as Alert[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addNotification = (msg: string) => {
    const id = `notif-${Date.now()}`;
    setInAppNotifications(prev => [...prev, { id, msg }]);
    setTimeout(() => setInAppNotifications(prev => prev.filter(n => n.id !== id)), 5000);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      addNotification(`Alert: ${detail.symbol} ${detail.condition} $${detail.target.toFixed(2)}`);
      sendNotification('TradeX Live Alert', `${detail.symbol} ${detail.condition} $${detail.target.toFixed(2)}`);
      playAlertSound();
    };
    window.addEventListener('tradex-alert-triggered', handler);
    return () => window.removeEventListener('tradex-alert-triggered', handler);
  }, []);

  const createAlert = async (symbol: string, alertType: AlertType, condition: AlertCondition, target: number) => {
    const { data } = await supabase.from('alerts').insert({
      symbol, alert_type: alertType, condition, target, active: true, triggered: false,
    }).select('*').single();
    if (data) {
      onAlertsChange([data as Alert, ...alerts]);
      setShowForm(false);
    }
  };

  const toggleAlert = async (id: string, active: boolean) => {
    await supabase.from('alerts').update({ active: !active }).eq('id', id);
    onAlertsChange(alerts.map(a => a.id === id ? { ...a, active: !active } : a));
  };

  const deleteAlert = async (id: string) => {
    await supabase.from('alerts').delete().eq('id', id);
    onAlertsChange(alerts.filter(a => a.id !== id));
  };

  return (
    <div className="p-3 lg:p-5 space-y-4 relative">
      <div className="fixed top-16 right-4 z-50 space-y-2 pointer-events-none">
        {inAppNotifications.map(n => (
          <div key={n.id} className="bg-slate-800 border border-amber-500/30 rounded-lg px-4 py-3 shadow-xl animate-in slide-in-from-right pointer-events-auto">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-slate-200">{n.msg}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Alerts</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Alert
        </button>
      </div>

      {showForm && <AlertForm onCreate={createAlert} onCancel={() => setShowForm(false)} />}

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
        <div className="divide-y divide-slate-800">
          {alerts.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500 text-center">No alerts configured. Create one to get notified.</p>
          ) : (
            alerts.map(a => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-800/30">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleAlert(a.id, a.active)} className={classNames(
                    'p-1.5 rounded-lg', a.active ? 'text-amber-400' : 'text-slate-600'
                  )}>
                    {a.active ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-200">{a.symbol}</span>
                      <span className="text-xs text-slate-500 uppercase">{a.alert_type}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {a.condition === 'crosses_above' ? 'crosses above' : 'crosses below'} ${formatPrice(a.target)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {a.triggered && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <Check className="w-3 h-3" /> Triggered
                    </span>
                  )}
                  <span className={classNames('text-xs', a.active ? 'text-emerald-400' : 'text-slate-600')}>
                    {a.active ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => deleteAlert(a.id)} className="p-1 text-slate-600 hover:text-red-400 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AlertForm({ onCreate, onCancel }: {
  onCreate: (symbol: string, type: AlertType, condition: AlertCondition, target: number) => void;
  onCancel: () => void;
}) {
  const [symbol, setSymbol] = useState(TRADE_SYMBOLS[0].symbol);
  const [alertType, setAlertType] = useState<AlertType>('price');
  const [condition, setCondition] = useState<AlertCondition>('crosses_above');
  const [target, setTarget] = useState('');

  const handleSubmit = () => {
    const t = parseFloat(target);
    if (isNaN(t)) return;
    onCreate(symbol, alertType, condition, t);
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-200">Create New Alert</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Symbol</label>
          <select value={symbol} onChange={e => setSymbol(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200">
            {TRADE_SYMBOLS.map(s => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Type</label>
          <select value={alertType} onChange={e => setAlertType(e.target.value as AlertType)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200">
            <option value="price">Price</option>
            <option value="percent">Percentage</option>
            <option value="breakout">Breakout</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Condition</label>
          <select value={condition} onChange={e => setCondition(e.target.value as AlertCondition)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200">
            <option value="crosses_above">Crosses Above</option>
            <option value="crosses_below">Crosses Below</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">
            {alertType === 'percent' ? 'Value (%)' : 'Target Price'}
          </label>
          <input
            type="number"
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={handleSubmit}
          className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium">
          Create Alert
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
