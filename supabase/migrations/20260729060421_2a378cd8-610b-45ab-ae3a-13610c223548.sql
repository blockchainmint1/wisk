REVOKE EXECUTE ON FUNCTION public.allocate_hd_index(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index(boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_hd_index(boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.next_hd_index() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_hd_index() FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_hd_index() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.next_hd_index() TO service_role;

REVOKE EXECUTE ON FUNCTION public.try_acquire_wallet_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_wallet_lock(text, integer, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_wallet_lock(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_wallet_lock(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role, postgres;