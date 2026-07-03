ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS original_quoted_dest_out numeric(38,8),
  ADD COLUMN IF NOT EXISTS underpayment_ack text;

CREATE INDEX IF NOT EXISTS orders_underpayment_ack_idx
  ON public.orders (underpayment_ack)
  WHERE underpayment_ack IS NOT NULL;