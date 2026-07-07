ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deposit_start_block bigint;

CREATE INDEX IF NOT EXISTS orders_dest_address_status_idx
  ON public.orders (lower(dest_address), status, created_at DESC);
