# Security notes before public deployment

## Changes in this repository preparation

- Added a Supabase lockdown migration that removes the original broad `anon` / `authenticated` policies and revokes browser-role table/sequence privileges.
- Removed the `.bolt` editor backup directory to avoid publishing duplicate/stale source snapshots.
- Added explicit environment-variable guidance. Vite `VITE_*` variables are public browser values, not secrets.
- Confirmed the supplied ZIP contains `.env.example` but no `.env` file or literal provider credential file.

## Important remaining work

1. **Supabase persistence is intentionally blocked for browser roles.** The app currently has no sign-in or per-user ownership model. Implement authentication, add `owner_id` columns, and write `auth.uid()`-scoped RLS policies before restoring remote reads/writes. Until then, alerts/settings persistence through Supabase may fail. Do not re-enable the old `USING (true)` policies.
2. **Market-data provider calls are still client-side in the current source.** The code reads Finnhub and Twelve Data credentials from `VITE_*` variables and places them in browser requests/WebSocket URLs. Never set real paid provider keys in a public Vite build. A server-side proxy/Edge Function and client refactor are still required before enabling those integrations publicly.
3. If any provider key was ever used in a previous public build or shared ZIP, rotate/revoke it at the provider. The ZIP inspected for this preparation did not contain an actual `.env` file or literal key value.
4. Review provider terms, rate limits, CORS, and data redistribution rights before launch.

## Suggested validation

Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` in an environment with package registry access. Then test the deployed app with no provider secrets in the frontend bundle and verify Supabase requests are denied until authenticated RLS is ready.
