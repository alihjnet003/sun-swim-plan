ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS loyalty_reward_type text NOT NULL DEFAULT 'discount',
  ADD COLUMN IF NOT EXISTS loyalty_reward_note text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_loyalty_reward_type_check
    CHECK (loyalty_reward_type IN ('discount','free','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT (loyalty_enabled, loyalty_threshold, loyalty_discount_percent, loyalty_reward_type, loyalty_reward_note)
  ON public.app_settings TO anon;