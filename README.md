# TradeX Aizen

An AI-assisted Forex and cryptocurrency market-analysis and paper-trading project. It combines chart analysis, technical indicators, market-data adapters, risk controls, and a paper-trading engine.

> **Development status:** under active development. This is an analysis and paper-trading tool, not a broker or investment adviser. It does not guarantee trading results and must not be used to place real orders.

## Current capabilities

- React, TypeScript, and Vite application
- Technical-indicator and market-structure analysis
- Forex, gold, and cryptocurrency chart/data adapters
- Aizen paper-trading engine with risk controls and history
- Unit/integration-style offline tests and live-provider verification script

## Getting started

```bash
npm ci
cp .env.example .env.local
npm run dev
```

See [docs/AIZEN.md](docs/AIZEN.md) for the paper-trading engine and [docs/AUDIT.md](docs/AUDIT.md) for the previous engineering audit.

## Security status

Read [SECURITY.md](SECURITY.md) before configuring services or deploying. Supabase browser access is locked down until authenticated per-user RLS is implemented. Provider API keys are currently read by client-side code; do not place paid secrets in `VITE_*` variables or deploy with them configured until a server-side proxy is implemented.

## License

MIT. See [LICENSE](LICENSE).
