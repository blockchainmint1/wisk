ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS payouts_frozen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payouts_frozen_reason text;

UPDATE public.app_settings
  SET payouts_frozen = true,
      payouts_frozen_reason = 'Manual freeze — investigating swap payout math',
      updated_at = now()
  WHERE id = 1;