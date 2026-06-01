
REVOKE EXECUTE ON FUNCTION public.next_hd_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_hd_index() TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
