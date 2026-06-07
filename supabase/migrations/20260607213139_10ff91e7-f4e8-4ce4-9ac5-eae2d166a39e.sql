
-- Custom tokens registry (admin-managed source assets)
CREATE TABLE public.custom_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chain TEXT NOT NULL CHECK (chain IN ('ethereum','base','arbitrum','polygon','bsc')),
  symbol TEXT NOT NULL,
  address TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals >= 0 AND decimals <= 36),
  is_native BOOLEAN NOT NULL DEFAULT false,
  bitmart_symbol TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, symbol)
);

GRANT SELECT ON public.custom_tokens TO anon, authenticated;
GRANT ALL ON public.custom_tokens TO service_role;

ALTER TABLE public.custom_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read enabled custom tokens"
  ON public.custom_tokens FOR SELECT
  USING (enabled = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert custom tokens"
  ON public.custom_tokens FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update custom tokens"
  ON public.custom_tokens FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete custom tokens"
  ON public.custom_tokens FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_custom_tokens_updated_at
  BEFORE UPDATE ON public.custom_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
