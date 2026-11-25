import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useAizenAgent } from '@/hooks/useAizenAgent';
import { AizenPage } from '@/pages/AizenPage';

// Test harness: the REAL Aizen hook + page, mounted in StrictMode exactly like src/main.tsx does.
function Harness() {
  const agent = useAizenAgent();
  return <AizenPage agent={agent} />;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><Harness /></StrictMode>);
