
CREATE OR REPLACE FUNCTION public.grant_admin_to_seed_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email = ANY (ARRAY['bobby@blockchainmint.com']) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_admin_to_seed_emails_trigger ON auth.users;
CREATE TRIGGER grant_admin_to_seed_emails_trigger
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_to_seed_emails();
