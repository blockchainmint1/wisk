-- 1. Add new order status
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'canceled';

-- 2. Blocked addresses table
CREATE TABLE IF NOT EXISTS public.blocked_addresses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  reason TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blocked_addresses_address ON public.blocked_addresses (address);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_addresses TO authenticated;
GRANT ALL ON public.blocked_addresses TO service_role;

ALTER TABLE public.blocked_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage blocked addresses"
  ON public.blocked_addresses FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));