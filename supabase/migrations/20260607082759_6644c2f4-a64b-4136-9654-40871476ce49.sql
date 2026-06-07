
CREATE TABLE public.app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  premium_bps INTEGER NOT NULL DEFAULT 500,
  expiry_minutes INTEGER NOT NULL DEFAULT 15,
  min_usd NUMERIC NOT NULL DEFAULT 10,
  max_usd NUMERIC NOT NULL DEFAULT 50000,
  paused BOOLEAN NOT NULL DEFAULT false,
  paused_reason TEXT,
  notify_min_usd_created NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  CONSTRAINT app_settings_singleton CHECK (id = 1)
);

GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settings"
  ON public.app_settings FOR SELECT
  USING (true);

CREATE POLICY "Only admins can update settings"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER app_settings_touch_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
