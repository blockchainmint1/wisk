
-- Rotating deposit-address pool: indexes 101..200, 1-hour lock.
CREATE OR REPLACE FUNCTION public.allocate_hd_index()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pool_start CONSTANT integer := 101;
  pool_end   CONSTANT integer := 200;
  lock_ttl   CONSTANT interval := interval '60 minutes';
  chosen     integer;
BEGIN
  -- Pick the least-recently-used index in [101,200] that is NOT currently
  -- locked. An index is locked iff there's an order using it whose
  -- created_at is within the last hour AND paid_tx_hash is NULL.
  WITH pool AS (
    SELECT generate_series(pool_start, pool_end) AS idx
  ),
  usage AS (
    SELECT deposit_index, MAX(created_at) AS last_used
    FROM public.orders
    WHERE deposit_index BETWEEN pool_start AND pool_end
    GROUP BY deposit_index
  ),
  locked AS (
    SELECT DISTINCT deposit_index
    FROM public.orders
    WHERE deposit_index BETWEEN pool_start AND pool_end
      AND paid_tx_hash IS NULL
      AND created_at > now() - lock_ttl
  )
  SELECT p.idx
  INTO chosen
  FROM pool p
  LEFT JOIN usage u ON u.deposit_index = p.idx
  WHERE p.idx NOT IN (SELECT deposit_index FROM locked)
  ORDER BY u.last_used ASC NULLS FIRST, p.idx ASC
  LIMIT 1;

  IF chosen IS NULL THEN
    RAISE EXCEPTION 'deposit address pool exhausted: all 100 addresses (101-200) are locked';
  END IF;

  -- Keep hd_address_counter in sync so wallet-scan sees the top of the window.
  UPDATE public.hd_address_counter
    SET next_index = GREATEST(next_index, pool_end + 1),
        updated_at = now()
    WHERE id = 1;

  RETURN chosen;
END;
$$;

-- Match order-expiry to the address lock window (60 min).
UPDATE public.app_settings
  SET expiry_minutes = 60, updated_at = now()
  WHERE id = 1 AND expiry_minutes < 60;
