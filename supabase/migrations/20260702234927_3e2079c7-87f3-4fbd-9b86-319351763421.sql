
CREATE TABLE public.hot_wallet_locks (
  wallet_key TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
  locked_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.hot_wallet_locks TO service_role;
ALTER TABLE public.hot_wallet_locks ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS; no other roles should touch this.

INSERT INTO public.hot_wallet_locks (wallet_key) VALUES ('txc_hot'), ('wtxc_hot')
  ON CONFLICT (wallet_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.try_acquire_wallet_lock(
  _wallet_key TEXT,
  _ttl_seconds INTEGER,
  _holder TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok BOOLEAN;
BEGIN
  INSERT INTO public.hot_wallet_locks (wallet_key, locked_until, locked_by, updated_at)
  VALUES (_wallet_key, now() + make_interval(secs => _ttl_seconds), _holder, now())
  ON CONFLICT (wallet_key) DO UPDATE
    SET locked_until = EXCLUDED.locked_until,
        locked_by = EXCLUDED.locked_by,
        updated_at = now()
    WHERE public.hot_wallet_locks.locked_until < now()
  RETURNING TRUE INTO ok;
  RETURN COALESCE(ok, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_wallet_lock(
  _wallet_key TEXT,
  _holder TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.hot_wallet_locks
    SET locked_until = to_timestamp(0), updated_at = now()
    WHERE wallet_key = _wallet_key AND locked_by = _holder;
END;
$$;
