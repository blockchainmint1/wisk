ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS burn_amount numeric,
  ADD COLUMN IF NOT EXISTS burn_sweep_tx_hash text,
  ADD COLUMN IF NOT EXISTS burn_tx_hash text,
  ADD COLUMN IF NOT EXISTS burn_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS burned_at timestamptz;

CREATE INDEX IF NOT EXISTS orders_pending_burn_idx
  ON public.orders (updated_at)
  WHERE status = 'completed' AND dest_asset = 'ISK' AND burn_tx_hash IS NULL;