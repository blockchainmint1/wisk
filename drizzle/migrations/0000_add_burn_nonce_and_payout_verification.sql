ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS burn_broadcast_nonce integer,
  ADD COLUMN IF NOT EXISTS dest_verified_at timestamptz;