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
  -- Recycle: pick the SMALLEST deposit_index whose most-recent use is
  -- older than 1 hour. Ordering by index (not created_at) means we always
  -- march #1, #2, #3… in order, even when an index was recently re-used
  -- and its "latest use" timestamp jumped forward.
  SELECT deposit_index INTO recycled
  FROM public.orders o
  WHERE deposit_index > 0
    AND created_at < now() - interval '1 hour'
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o2
      WHERE o2.deposit_index = o.deposit_index
        AND o2.created_at > o.created_at
    )
  ORDER BY deposit_index ASC
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