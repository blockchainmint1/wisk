CREATE OR REPLACE FUNCTION public.allocate_hd_index()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recycled INTEGER;
  fresh INTEGER;
BEGIN
  -- Try to recycle the oldest expired+unpaid order's deposit_index
  -- once its expiry is at least 60 minutes in the past.
  SELECT deposit_index INTO recycled
  FROM public.orders
  WHERE status = 'expired'
    AND paid_tx_hash IS NULL
    AND expires_at < now() - interval '60 minutes'
    AND deposit_index > 0
    AND NOT EXISTS (
      -- never recycle an index that any newer order is already using
      SELECT 1 FROM public.orders o2
      WHERE o2.deposit_index = orders.deposit_index
        AND o2.created_at > orders.created_at
    )
  ORDER BY expires_at ASC
  LIMIT 1;

  IF recycled IS NOT NULL THEN
    RETURN recycled;
  END IF;

  -- Otherwise increment the counter
  UPDATE public.hd_address_counter
    SET next_index = next_index + 1, updated_at = now()
    WHERE id = 1
    RETURNING next_index - 1 INTO fresh;
  RETURN fresh;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_hd_index() TO service_role;