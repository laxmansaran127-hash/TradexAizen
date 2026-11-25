-- TradeX Aizen security lockdown.
-- The initial schema migration allowed unauthenticated visitors to read/write
-- every user's rows. This migration intentionally removes that public access.
-- The current frontend has no sign-in/user-ownership flow, so remote persistence
-- must remain unavailable until authenticated, per-user RLS is implemented.

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('market_symbols', 'watchlists', 'saved_charts', 'alerts', 'user_settings')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END
$$;

ALTER TABLE IF EXISTS public.market_symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saved_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.market_symbols,
  public.watchlists,
  public.saved_charts,
  public.alerts,
  public.user_settings
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- No policies are created here: RLS therefore denies browser-role access by default.
-- Add auth.uid()-scoped policies only after every user-owned table has an owner_id
-- column and the app enforces sign-in.
