
-- 1) Extend order_status with a 'sending' state for local TXC payout
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'sending';

-- 2) Track fee paid + hot-wallet source address per payout
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS txc_fee_sats BIGINT,
  ADD COLUMN IF NOT EXISTS txc_from_address TEXT;

-- 3) order_events: full timeline of state transitions + telegram notifies + errors
CREATE TABLE IF NOT EXISTS public.order_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL,
  kind TEXT NOT NULL,            -- 'state' | 'telegram' | 'bitmart' | 'payout' | 'error' | 'note'
  event TEXT NOT NULL,           -- e.g. 'awaiting_payment->payment_detected', 'sent', 'buy_submitted'
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_events_order_id_created_at_idx
  ON public.order_events (order_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_events TO authenticated;
GRANT ALL ON public.order_events TO service_role;

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read order events"
  ON public.order_events FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
