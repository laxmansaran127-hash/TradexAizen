import { useState, type ReactNode } from 'react';
import {
  LayoutDashboard, BarChart3, Bell, Settings,
  TrendingUp, Menu, X, Bot,
} from 'lucide-react';
import { classNames } from '@/lib/format';

export type Page = 'charts' | 'aizen' | 'alerts' | 'settings';

interface LayoutProps {
  current: Page;
  onNavigate: (p: Page) => void;
  children: ReactNode;
}

const NAV_ITEMS: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'charts', label: 'Live Charts', icon: BarChart3 },
  { id: 'aizen', label: 'Aizen AI', icon: Bot },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const MOBILE_NAV: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'charts', label: 'Charts', icon: BarChart3 },
  { id: 'aizen', label: 'Aizen', icon: Bot },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Layout({ current, onNavigate, children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
      {/* Top bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm flex items-center px-3 gap-3 sticky top-0 z-40">
        <button
          className="lg:hidden p-2 hover:bg-slate-800 rounded-lg"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight hidden sm:block">
            TradeX<span className="text-sky-400"> Live</span>
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/30">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-emerald-400 tracking-wide">LIVE DATA</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop */}
        <aside className="hidden lg:flex w-56 border-r border-slate-800 bg-slate-900/50 flex-col py-4">
          <nav className="flex flex-col gap-1 px-3">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={classNames(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  current === item.id
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto px-3">
            <div className="px-3 py-2 rounded-lg bg-slate-800/30 text-xs text-slate-500">
              <p className="font-semibold text-slate-400 mb-1">Real-Time Analysis Tool</p>
              <p>Informational only. Not financial advice.</p>
            </div>
          </div>
        </aside>

        {/* Sidebar — mobile drawer */}
        {sidebarOpen && (
          <>
            <div className="lg:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setSidebarOpen(false)} />
            <aside className="lg:hidden fixed left-0 top-14 bottom-0 w-56 bg-slate-900 border-r border-slate-800 z-50 flex flex-col py-4">
              <nav className="flex flex-col gap-1 px-3">
                {NAV_ITEMS.map(item => (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); setSidebarOpen(false); }}
                    className={classNames(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                      current === item.id
                        ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </button>
                ))}
              </nav>
            </aside>
          </>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-14 bg-slate-900/95 backdrop-blur-sm border-t border-slate-800 flex items-center justify-around z-40">
        {MOBILE_NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={classNames(
              'flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors',
              current === item.id ? 'text-sky-400' : 'text-slate-500'
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
