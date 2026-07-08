ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dest_broadcast_nonce integer,
  ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0;