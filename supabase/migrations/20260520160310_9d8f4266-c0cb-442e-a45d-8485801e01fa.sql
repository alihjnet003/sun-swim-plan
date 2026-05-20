
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

-- Trigger to track updated_by on bookings
CREATE OR REPLACE FUNCTION public.set_booking_updated_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_set_updated_by ON public.bookings;
CREATE TRIGGER bookings_set_updated_by
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_booking_updated_by();
