import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import './index.css';

// Prevents unhandled promise rejections from silently crashing the app
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason);
  event.preventDefault?.();
});

// Prevents uncaught errors from blanking the screen
window.addEventListener('error', (event) => {
  console.error('[Uncaught Error]', event.error || event.message);
  event.preventDefault?.();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Top-level boundary: catches render errors that would otherwise blank the entire screen */}
    <ErrorBoundary
      fallback={
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950">
          <p className="text-sm text-slate-400">TradeX encountered an unexpected error.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold"
          >
            Reload
          </button>
        </div>
      }
    >
      <App />
    </ErrorBoundary>
  </StrictMode>
);
