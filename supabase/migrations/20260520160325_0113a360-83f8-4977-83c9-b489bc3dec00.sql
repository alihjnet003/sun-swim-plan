
CREATE OR REPLACE FUNCTION public.set_booking_updated_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;
