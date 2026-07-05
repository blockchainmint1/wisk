
CREATE OR REPLACE FUNCTION public.allocate_hd_index()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recycled INTEGER;
  fresh INTEGER;
BEGIN
  -- Fixed 1-hour reservation: any order older than 1 hour releases its
  -- index back to the pool, regardless of status (completed, expired,
  -- failed, or still pending). We never hand back an index that a newer
  -- order is already using.
  SELECT deposit_index INTO recycled
  FROM public.orders o
  WHERE deposit_index > 0
    AND created_at < now() - interval '1 hour'
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o2
      WHERE o2.deposit_index = o.deposit_index
        AND o2.created_at > o.created_at
    )
  ORDER BY created_at ASC
  LIMIT 1;

  IF recycled IS NOT NULL THEN
    RETURN recycled;
  END IF;

  UPDATE public.hd_address_counter
    SET next_index = next_index + 1, updated_at = now()
    WHERE id = 1
    RETURNING next_index - 1 INTO fresh;
  RETURN fresh;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.allocate_hd_index() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index() FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_hd_index() TO service_role;
