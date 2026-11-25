import { useState, useEffect, useCallback } from 'react';
import { Layout, type Page } from '@/components/Layout';
import { LandingPage } from '@/components/LandingPage';
import { ChartsPage } from '@/pages/ChartsPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AizenPage } from '@/pages/AizenPage';
import { useAizenAgent } from '@/hooks/useAizenAgent';
import { alertEngine, requestNotificationPermission } from '@/lib/alertEngine';
import { supabase } from '@/lib/supabase';
import type { Alert, UserSettings } from '@/lib/types';

const DEFAULT_SETTINGS: UserSettings = {
  demo_mode: false,
  notifications_enabled: true,
  sound_enabled: true,
  theme: 'dark',
};

export default function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [page, setPage] = useState<Page>('charts');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  // Aizen paper-trading agent: hosted here (not in its page) so it keeps running while you browse other pages.
  const aizen = useAizenAgent();

  // Load settings from DB — wrapped in try/catch to prevent unhandled rejection from blanking the app
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('user_settings').select('*').limit(1).maybeSingle();
        if (data) {
          setSettings({ ...data, demo_mode: false } as UserSettings);
        } else {
          await supabase.from('user_settings').insert(DEFAULT_SETTINGS);
        }
      } catch { /* Supabase unavailable — fall back to default settings */ }
    })();
  }, []);

  // Keep alert engine in sync
  useEffect(() => {
    alertEngine.setAlerts(alerts);
  }, [alerts]);

  // Alert triggered callback
  useEffect(() => {
    const unsub = alertEngine.subscribe({
      onTriggered: (alert, quote) => {
        // Guarded: prevents Supabase update failure from throwing unhandled rejection
        supabase.from('alerts').update({ triggered: true, triggered_at: new Date().toISOString() }).eq('id', alert.id).then(undefined, () => {});
        setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, triggered: true, triggered_at: new Date().toISOString() } : a));

        window.dispatchEvent(new CustomEvent('tradex-alert-triggered', { detail: alert }));

        if (settings.notifications_enabled) {
          requestNotificationPermission().then(granted => {
            if (granted) {
              new Notification('TradeX Live Alert', {
                body: `${alert.symbol} ${alert.condition === 'crosses_above' ? 'crossed above' : 'crossed below'} $${alert.target.toFixed(2)} (current: $${quote.price.toFixed(2)})`,
              });
            }
          });
        }

        if (settings.sound_enabled) {
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
          } catch { /* audio not available */ }
        }
      },
    });
    return unsub;
  }, [settings.notifications_enabled, settings.sound_enabled]);

  const handleNavigate = useCallback((p: Page) => {
    setPage(p);
    setShowLanding(false);
  }, []);

  if (showLanding) {
    return (
      <LandingPage
        onLaunch={() => { setShowLanding(false); setPage('charts'); }}
      />
    );
  }

  return (
    <Layout current={page} onNavigate={handleNavigate}>
      {page === 'charts' && <ChartsPage />}
      {page === 'aizen' && <AizenPage agent={aizen} />}
      {page === 'alerts' && <AlertsPage alerts={alerts} onAlertsChange={setAlerts} />}
      {page === 'settings' && <SettingsPage settings={settings} onSettingsChange={setSettings} />}
    </Layout>
  );
}
