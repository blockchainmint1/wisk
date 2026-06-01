CREATE POLICY "Admins can view hd counter"
  ON public.hd_address_counter FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM authenticated;