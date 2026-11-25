import {
  TrendingUp, BarChart3, Bell, ArrowRight,
  Activity, Zap, Globe, Shield, Clock, Bitcoin, Coins
} from 'lucide-react';

interface LandingPageProps {
  onLaunch: () => void;
}

export function LandingPage({ onLaunch }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 overflow-x-hidden">
      {/* Nav */}
      <nav className="absolute top-0 left-0 right-0 z-20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">
            TradeX<span className="text-sky-400"> Live</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/30">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-emerald-400 tracking-wide">LIVE DATA</span>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center pt-20 pb-12 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-700/10 rounded-full blur-3xl" />
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }} />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
            </span>
            <span className="text-xs font-medium text-sky-300">Real-Time Market Analysis Platform</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
            <span className="text-white">Real-Time</span>
            <br />
            <span className="bg-gradient-to-r from-sky-400 to-blue-600 bg-clip-text text-transparent">
              Market Analysis
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Live Bitcoin and Gold charts with real-time WebSocket data, automated pattern
            recognition, liquidity detection, and professional-grade technical analysis.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={onLaunch}
              className="group flex items-center gap-2 px-8 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-base transition-all hover:scale-105 hover:shadow-lg hover:shadow-sky-500/25"
            >
              Launch Terminal
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {/* Asset badges */}
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900/80 border border-slate-800">
              <Bitcoin className="w-5 h-5 text-amber-400" />
              <span className="text-sm font-semibold text-slate-200">BTC/USDT</span>
              <span className="text-xs text-slate-500">Binance</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900/80 border border-slate-800">
              <Coins className="w-5 h-5 text-amber-400" />
              <span className="text-sm font-semibold text-slate-200">XAU/USD</span>
              <span className="text-xs text-slate-500">Finnhub</span>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            <TrustStat icon={Activity} label="Live Data" value="Real-Time" />
            <TrustStat icon={BarChart3} label="Patterns" value="12+" />
            <TrustStat icon={Zap} label="Updates" value="Per Tick" />
            <TrustStat icon={Globe} label="Assets" value="BTC + Gold" />
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-950 to-transparent" />
      </section>

      {/* Features */}
      <section className="py-24 px-6 relative">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Professional analysis toolkit</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">Real pattern detection, liquidity analysis, and market structure mapping from live OHLC data.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard icon={BarChart3} title="Live Charts" description="Real-time candlestick charts via WebSocket. Historical data loaded via REST. 7 timeframes from 1m to 1D." gradient="from-sky-500/20 to-blue-700/10" />
            <FeatureCard icon={Activity} title="Pattern Recognition" description="Double Top/Bottom, Head & Shoulders, Flags, Triangles, Wedges, Channels, Cup & Handle — detected from actual OHLC data." gradient="from-amber-500/20 to-orange-700/10" />
            <FeatureCard icon={Zap} title="Liquidity Detection" description="Buy-side/sell-side liquidity, equal highs/lows, liquidity sweeps, and stop-hunt displacement analysis." gradient="from-emerald-500/20 to-teal-700/10" />
            <FeatureCard icon={Shield} title="Market Structure" description="HH/HL/LH/LL labeling, BOS/CHOCH/MSS detection, supply/demand zones, and support/resistance mapping." gradient="from-pink-500/20 to-rose-700/10" />
            <FeatureCard icon={Bell} title="Real-Time Alerts" description="Set price and breakout alerts. Get browser notifications and sound alerts when conditions are met." gradient="from-cyan-500/20 to-blue-700/10" />
            <FeatureCard icon={Globe} title="Multi-Source Data" description="Binance for crypto; Finnhub live ticks for gold and spot forex, with real candle history from Twelve Data or Finnhub. If a provider is down TradeX says so — it never substitutes simulated data." gradient="from-slate-500/20 to-slate-700/10" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800/50 border border-slate-700 p-12 overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl" />
            <div className="relative">
              <h2 className="text-3xl font-bold text-white mb-4">Start analyzing live markets</h2>
              <p className="text-slate-400 mb-8">
                Launch the terminal to access real-time charts, automated pattern detection, and full technical analysis.
              </p>
              <button
                onClick={onLaunch}
                className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold transition-all hover:scale-105 hover:shadow-lg hover:shadow-sky-500/25"
              >
                Launch Terminal
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-300">TradeX Live</span>
          </div>
          <p className="text-xs text-slate-600 text-center sm:text-right max-w-xl">
            TradeX Live is a technical analysis tool. It does not provide financial advice.
            All analysis is informational only and is not a guarantee of future results.
          </p>
        </div>
      </footer>
    </div>
  );
}

function TrustStat({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Icon className="w-5 h-5 text-sky-400" />
      <span className="text-lg font-bold text-white">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description, gradient }: {
  icon: typeof BarChart3;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="group relative rounded-xl bg-slate-900/50 border border-slate-800 p-6 hover:border-slate-700 transition-all overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <div className="relative">
        <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
          <Icon className="w-5 h-5 text-sky-400" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
