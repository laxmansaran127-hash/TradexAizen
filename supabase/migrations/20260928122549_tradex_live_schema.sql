/*
# TradeX Live — Core Schema

## Overview
Single-tenant schema for the TradeX Live trading terminal. No authentication is
required by the app, so all tables allow anon + authenticated CRUD (the data is
per-browser / shared demo data). Market symbols are seeded as reference data.

## New Tables
1. `market_symbols` — catalog of tradeable symbols (symbol, name, sector, exchange, logo_url)
2. `watchlists` — user watchlist entries (symbol, position for ordering)
3. `saved_charts` — saved chart layouts (name, symbol, timeframe, indicators, layout JSON)
4. `alerts` — price/indicator alerts (symbol, type, condition, target value, active, triggered)
5. `user_settings` — singleton row for app settings (demo mode, notifications, sound, theme)

## Security
- RLS enabled on every table.
- Policies use `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)`
  because this is a single-tenant app with no sign-in screen.
*/

-- ── market_symbols ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  name text NOT NULL,
  sector text NOT NULL DEFAULT 'Other',
  exchange text NOT NULL DEFAULT 'NASDAQ',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE market_symbols ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_symbols" ON market_symbols;
CREATE POLICY "anon_read_symbols" ON market_symbols FOR SELECT
  TO anon, authenticated USING (true);

-- ── watchlists ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_watchlist" ON watchlists;
CREATE POLICY "anon_select_watchlist" ON watchlists FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_watchlist" ON watchlists;
CREATE POLICY "anon_insert_watchlist" ON watchlists FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_watchlist" ON watchlists;
CREATE POLICY "anon_update_watchlist" ON watchlists FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_watchlist" ON watchlists;
CREATE POLICY "anon_delete_watchlist" ON watchlists FOR DELETE
  TO anon, authenticated USING (true);

-- ── saved_charts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT '1H',
  indicators jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE saved_charts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_charts" ON saved_charts;
CREATE POLICY "anon_select_charts" ON saved_charts FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_charts" ON saved_charts;
CREATE POLICY "anon_insert_charts" ON saved_charts FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_charts" ON saved_charts;
CREATE POLICY "anon_update_charts" ON saved_charts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_charts" ON saved_charts;
CREATE POLICY "anon_delete_charts" ON saved_charts FOR DELETE
  TO anon, authenticated USING (true);

-- ── alerts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  alert_type text NOT NULL DEFAULT 'price',
  condition text NOT NULL DEFAULT 'crosses_above',
  target double precision NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  triggered boolean NOT NULL DEFAULT false,
  triggered_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_alerts" ON alerts;
CREATE POLICY "anon_select_alerts" ON alerts FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_alerts" ON alerts;
CREATE POLICY "anon_insert_alerts" ON alerts FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_alerts" ON alerts;
CREATE POLICY "anon_update_alerts" ON alerts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_alerts" ON alerts;
CREATE POLICY "anon_delete_alerts" ON alerts FOR DELETE
  TO anon, authenticated USING (true);

-- ── user_settings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_mode boolean NOT NULL DEFAULT true,
  notifications_enabled boolean NOT NULL DEFAULT true,
  sound_enabled boolean NOT NULL DEFAULT true,
  theme text NOT NULL DEFAULT 'dark',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_settings" ON user_settings;
CREATE POLICY "anon_select_settings" ON user_settings FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_settings" ON user_settings;
CREATE POLICY "anon_insert_settings" ON user_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_settings" ON user_settings;
CREATE POLICY "anon_update_settings" ON user_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_settings" ON user_settings;
CREATE POLICY "anon_delete_settings" ON user_settings FOR DELETE
  TO anon, authenticated USING (true);

-- ── Seed market symbols ─────────────────────────────────────────
INSERT INTO market_symbols (symbol, name, sector, exchange) VALUES
  ('AAPL',  'Apple Inc.',           'Technology',    'NASDAQ'),
  ('MSFT',  'Microsoft Corp.',      'Technology',    'NASDAQ'),
  ('GOOGL', 'Alphabet Inc.',        'Technology',    'NASDAQ'),
  ('AMZN',  'Amazon.com Inc.',      'Consumer',      'NASDAQ'),
  ('NVDA',  'NVIDIA Corp.',         'Technology',    'NASDAQ'),
  ('META',  'Meta Platforms Inc.',  'Technology',    'NASDAQ'),
  ('TSLA',  'Tesla Inc.',           'Automotive',    'NASDAQ'),
  ('AMD',   'Advanced Micro Dev.',  'Technology',    'NASDAQ'),
  ('INTC',  'Intel Corp.',          'Technology',    'NASDAQ'),
  ('NFLX',  'Netflix Inc.',         'Entertainment', 'NASDAQ'),
  ('DIS',   'Walt Disney Co.',      'Entertainment', 'NYSE'),
  ('BAC',   'Bank of America',      'Financials',    'NYSE'),
  ('JPM',   'JPMorgan Chase',       'Financials',    'NYSE'),
  ('GS',    'Goldman Sachs',        'Financials',    'NYSE'),
  ('XOM',   'Exxon Mobil',          'Energy',        'NYSE'),
  ('CVX',   'Chevron Corp.',        'Energy',        'NYSE'),
  ('PFE',   'Pfizer Inc.',          'Healthcare',    'NYSE'),
  ('JNJ',   'Johnson & Johnson',    'Healthcare',    'NYSE'),
  ('KO',    'Coca-Cola Co.',        'Consumer',      'NYSE'),
  ('PEP',   'PepsiCo Inc.',         'Consumer',      'NASDAQ'),
  ('WMT',   'Walmart Inc.',         'Consumer',      'NYSE'),
  ('COST',  'Costco Wholesale',     'Consumer',      'NASDAQ'),
  ('BA',    'Boeing Co.',           'Industrial',    'NYSE'),
  ('CAT',   'Caterpillar Inc.',     'Industrial',    'NYSE'),
  ('UBER',  'Uber Technologies',    'Technology',    'NYSE'),
  ('SHOP',  'Shopify Inc.',         'Technology',    'NYSE'),
  ('SQ',    'Block Inc.',           'Financials',    'NYSE'),
  ('COIN',  'Coinbase Global',      'Financials',    'NASDAQ'),
  ('PLTR',  'Palantir Tech.',       'Technology',    'NASDAQ'),
  ('SOFI',  'SoFi Technologies',    'Financials',    'NASDAQ')
ON CONFLICT (symbol) DO NOTHING;
