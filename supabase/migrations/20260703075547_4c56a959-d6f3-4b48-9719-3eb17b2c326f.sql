
CREATE TABLE public.txc_balance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  balance_txc NUMERIC(24, 8) NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_txc_balance_snapshots_taken_at ON public.txc_balance_snapshots (taken_at DESC);

GRANT SELECT, INSERT ON public.txc_balance_snapshots TO authenticated;
GRANT ALL ON public.txc_balance_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.txc_balance_snapshots_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.txc_balance_snapshots_id_seq TO service_role;

ALTER TABLE public.txc_balance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read TXC balance snapshots"
  ON public.txc_balance_snapshots FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages TXC balance snapshots"
  ON public.txc_balance_snapshots FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
