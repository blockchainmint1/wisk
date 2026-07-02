
REVOKE EXECUTE ON FUNCTION public.try_acquire_wallet_lock(TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_wallet_lock(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_wallet_lock(TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_lock(TEXT, TEXT) TO service_role;
