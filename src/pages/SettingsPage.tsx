import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { UserSettings } from '@/lib/types';
import { classNames } from '@/lib/format';
import { Bell, Volume2, TrendingUp, Shield, AlertTriangle, Bitcoin, Coins } from 'lucide-react';
import { requestNotificationPermission, sendNotification } from '@/lib/alertEngine';

interface SettingsPageProps {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
}

export function SettingsPage({ settings, onSettingsChange }: SettingsPageProps) {
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if ('Notification' in window) setNotifPermission(Notification.permission);
  }, []);

  const updateSetting = async (patch: Partial<UserSettings>) => {
    const newSettings = { ...settings, ...patch };
    onSettingsChange(newSettings);
    const { data: existing } = await supabase.from('user_settings').select('id').limit(1).maybeSingle();
    if (existing) {
      await supabase.from('user_settings').update(patch).eq('id', existing.id);
    } else {
      await supabase.from('user_settings').insert(newSettings);
    }
  };

  const enableNotifications = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      setNotifPermission('granted');
      updateSetting({ notifications_enabled: true });
      sendNotification('TradeX Live', 'Notifications enabled successfully!');
    }
  };

  return (
    <div className="p-3 lg:p-5 space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Live Data Sources */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-bold text-slate-200">Live Data Sources</h2>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40">
          <Bitcoin className="w-5 h-5 text-amber-400" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-200">BTC/USDT</div>
            <div className="text-xs text-slate-500">Binance WebSocket + REST API</div>
          </div>
          <span className="text-xs text-emerald-400 font-semibold">LIVE</span>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40">
          <Coins className="w-5 h-5 text-amber-400" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-200">XAU/USD</div>
            <div className="text-xs text-slate-500">Finnhub WebSocket + REST API</div>
          </div>
          <span className="text-xs text-emerald-400 font-semibold">LIVE</span>
        </div>
        <div className="rounded-lg p-3 text-xs bg-emerald-500/10 text-emerald-400">
          All market data comes from live providers (Binance for crypto; Finnhub / Twelve Data for gold and spot forex). When data is stale, missing or invalid, TradeX shows it as unavailable instead of estimating.
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-bold text-slate-200">Notifications</h2>
        </div>
        <ToggleRow
          icon={Bell}
          label="Browser Notifications"
          description="Receive alerts in your browser when conditions are met."
          value={settings.notifications_enabled}
          onChange={v => {
            if (v && notifPermission !== 'granted') {
              enableNotifications();
            } else {
              updateSetting({ notifications_enabled: v });
            }
          }}
        />
        {notifPermission !== 'granted' && settings.notifications_enabled && (
          <button onClick={enableNotifications}
            className="text-xs text-sky-400 hover:text-sky-300">
            Grant browser notification permission
          </button>
        )}
        <ToggleRow
          icon={Volume2}
          label="Sound Alerts"
          description="Play a sound when an alert is triggered."
          value={settings.sound_enabled}
          onChange={v => updateSetting({ sound_enabled: v })}
        />
      </div>

      {/* About */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-bold text-slate-200">About TradeX Live</h2>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          TradeX Live is a real-time market analysis platform providing live charts,
          automated pattern recognition, liquidity detection, and technical analysis
          for Bitcoin (BTC/USDT) and Gold (XAU/USD).
        </p>
        <div className="flex items-start gap-2 pt-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-500 leading-relaxed">
            Technical analysis is informational only and does not constitute financial advice.
            All indicators and analysis outputs are not guarantees of future performance or profit.
            Always do your own research before making investment decisions.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
          <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-xs text-slate-500">TradeX Live · Version 2.0.0</span>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ icon: Icon, label, description, value, onChange }: {
  icon: typeof Bell;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="flex items-start gap-3 flex-1">
        <Icon className="w-4 h-4 text-slate-500 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-slate-200">{label}</div>
          <div className="text-xs text-slate-500">{description}</div>
        </div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={classNames('relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
          value ? 'bg-sky-500' : 'bg-slate-700')}
      >
        <span className={classNames('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
          value && 'translate-x-5')} />
      </button>
    </div>
  );
}
