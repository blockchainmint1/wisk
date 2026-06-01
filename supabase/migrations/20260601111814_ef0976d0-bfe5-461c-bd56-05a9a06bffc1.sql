
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TYPE public.order_status AS ENUM (
  'awaiting_payment',
  'payment_detected',
  'confirmed',
  'buying_on_bitmart',
  'bought',
  'withdrawing',
  'completed',
  'expired',
  'failed',
  'refunded'
);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can see their own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can see all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ ORDERS ============
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE DEFAULT (
    'TX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  status public.order_status NOT NULL DEFAULT 'awaiting_payment',
  -- input
  source_chain TEXT NOT NULL,
  source_token TEXT NOT NULL,
  source_amount_usd NUMERIC(20, 6) NOT NULL,
  -- deposit address
  deposit_address TEXT NOT NULL,
  deposit_index INTEGER NOT NULL,
  -- destination
  dest_txc_address TEXT NOT NULL,
  -- quote (locked at creation)
  quoted_txc_per_usd NUMERIC(30, 12) NOT NULL,
  quoted_txc_out NUMERIC(30, 8) NOT NULL,
  premium_bps INTEGER NOT NULL DEFAULT 500,
  bitmart_spot_price NUMERIC(20, 8) NOT NULL,
  -- timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  -- fulfillment
  paid_tx_hash TEXT,
  paid_amount_usd NUMERIC(20, 6),
  bitmart_order_id TEXT,
  bitmart_filled_txc NUMERIC(30, 8),
  bitmart_avg_price NUMERIC(20, 8),
  withdrawal_id TEXT,
  txc_tx_hash TEXT,
  error_message TEXT
);

CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_deposit_address ON public.orders(deposit_address);
CREATE INDEX idx_orders_created_at ON public.orders(created_at DESC);

GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can see all orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ HD COUNTER ============
CREATE TABLE public.hd_address_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  next_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO public.hd_address_counter (id, next_index) VALUES (1, 0);

GRANT ALL ON public.hd_address_counter TO service_role;

ALTER TABLE public.hd_address_counter ENABLE ROW LEVEL SECURITY;

-- Atomically allocate the next deposit index
CREATE OR REPLACE FUNCTION public.next_hd_index()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  idx INTEGER;
BEGIN
  UPDATE public.hd_address_counter
    SET next_index = next_index + 1, updated_at = now()
    WHERE id = 1
    RETURNING next_index - 1 INTO idx;
  RETURN idx;
END;
$$;

-- ============ DEPOSITS ============
CREATE TABLE public.deposits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount_usd NUMERIC(20, 6) NOT NULL,
  block_number BIGINT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, tx_hash, log_index)
);

CREATE INDEX idx_deposits_order ON public.deposits(order_id);

GRANT SELECT ON public.deposits TO authenticated;
GRANT ALL ON public.deposits TO service_role;

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can see all deposits"
  ON public.deposits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ ADMIN AUDIT ============
CREATE TABLE public.admin_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.admin_audit TO authenticated;
GRANT ALL ON public.admin_audit TO service_role;

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can see audit log"
  ON public.admin_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can write audit log"
  ON public.admin_audit FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_user_id = auth.uid());

-- ============ TIMESTAMP TRIGGER ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_touch_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
