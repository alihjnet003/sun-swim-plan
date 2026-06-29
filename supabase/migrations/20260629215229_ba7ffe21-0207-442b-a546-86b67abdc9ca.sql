
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.auto_close_past_slots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.booking_slots s
     SET is_closed = true
   WHERE s.is_closed = false
     AND s.date < CURRENT_DATE
     AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.slot_id = s.id);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Run an immediate first pass.
SELECT public.auto_close_past_slots();
