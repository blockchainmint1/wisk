
-- Restrict app_settings to admin/service_role only (read via supabaseAdmin).
DROP POLICY IF EXISTS "Anyone can read settings" ON public.app_settings;
CREATE POLICY "Admins can read settings" ON public.app_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE SELECT ON public.app_settings FROM anon;

-- Deposits / order_events / orders: custodial app with no per-user identity;
-- all writes go through service_role. Explicitly deny non-admin access
-- for INSERT/UPDATE/DELETE (SELECT already admin-only) so the intent is
-- codified in policy rather than implied by the absence of policies.
CREATE POLICY "Block non-admin writes to orders" ON public.orders
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block non-admin writes to deposits" ON public.deposits
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Block non-admin writes to order_events" ON public.order_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.orders FROM anon, authenticated;
GRANT SELECT ON public.orders TO authenticated;
REVOKE ALL ON public.deposits FROM anon, authenticated;
GRANT SELECT ON public.deposits TO authenticated;
REVOKE ALL ON public.order_events FROM anon, authenticated;
GRANT SELECT ON public.order_events TO authenticated;

-- SECURITY DEFINER function hardening: revoke EXECUTE from anon/authenticated
-- for functions that are only called via triggers or service_role code.
REVOKE EXECUTE ON FUNCTION public.next_hd_index() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.grant_admin_to_seed_emails() FROM anon, authenticated, public;

-- has_role is referenced inside RLS policies, so authenticated users need
-- EXECUTE to evaluate their own row access. Switch to SECURITY INVOKER so
-- it no longer runs with elevated privileges; user_roles RLS already lets
-- users read their own roles, which is all this function checks.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
