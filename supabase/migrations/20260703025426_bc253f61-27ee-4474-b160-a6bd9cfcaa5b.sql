-- Lock down hot_wallet_locks: service role only.
-- Revoke any anon/authenticated grants and add explicit deny policies so
-- intent is unambiguous. All app access goes through SECURITY DEFINER RPCs
-- (try_acquire_wallet_lock / release_wallet_lock) or the service role.
REVOKE ALL ON public.hot_wallet_locks FROM anon, authenticated;
GRANT ALL ON public.hot_wallet_locks TO service_role;

DROP POLICY IF EXISTS "No client access to hot wallet locks" ON public.hot_wallet_locks;
CREATE POLICY "No client access to hot wallet locks"
  ON public.hot_wallet_locks
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);