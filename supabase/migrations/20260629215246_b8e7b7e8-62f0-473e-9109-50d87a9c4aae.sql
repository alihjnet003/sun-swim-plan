
DO $$
BEGIN
  PERFORM cron.unschedule('auto-close-past-slots');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-close-past-slots',
  '0 1 * * *',
  $$SELECT public.auto_close_past_slots();$$
);
