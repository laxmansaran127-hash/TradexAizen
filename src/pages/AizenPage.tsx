import type { AizenAgent } from '@/hooks/useAizenAgent';
import { AizenControlPanel } from '@/components/aizen/AizenControlPanel';
import { AizenDecisions, AizenKpis, AizenPending, AizenPositions } from '@/components/aizen/AizenLive';
import { AizenHistory } from '@/components/aizen/AizenHistory';
import { AizenRiskSettings } from '@/components/aizen/AizenRiskSettings';

export function AizenPage({ agent }: { agent: AizenAgent }) {
  return (
    <div className="max-w-6xl mx-auto p-3 md:p-5 space-y-4">
      <AizenControlPanel ag={agent} />
      <AizenKpis ag={agent} />
      <AizenPending ag={agent} />
      <AizenPositions ag={agent} />
      <AizenDecisions ag={agent} />
      <AizenRiskSettings ag={agent} />
      <AizenHistory ag={agent} />
      <p className="text-[11px] text-slate-600 pb-6">
        Aizen paper trading is a simulation using real market data with assumed fees and slippage. It does not place orders with any exchange or broker and does not guarantee future results. Not financial advice.
      </p>
    </div>
  );
}
