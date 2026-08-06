-- 1) Keep balance + payment status in sync automatically
CREATE OR REPLACE FUNCTION public.sync_booking_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  net numeric;
BEGIN
  net := GREATEST(COALESCE(NEW.subtotal,0) - COALESCE(NEW.discount,0), 0);
  NEW.remaining_amount := GREATEST(net - COALESCE(NEW.paid_amount,0), 0);
  IF COALESCE(NEW.paid_amount,0) <= 0 THEN
    NEW.payment_status := 'unpaid';
  ELSIF NEW.remaining_amount <= 0 THEN
    NEW.payment_status := 'paid';
  ELSE
    NEW.payment_status := 'partial';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_sync_totals ON public.bookings;
CREATE TRIGGER bookings_sync_totals
BEFORE INSERT OR UPDATE OF subtotal, discount, paid_amount, deposit_amount ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_booking_totals();

-- backfill existing rows
UPDATE public.bookings SET subtotal = subtotal;

-- 2) Pending public requests must not reserve the slot until approved
CREATE OR REPLACE FUNCTION public.prevent_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_span tsrange;
  clash RECORD;
BEGIN
  IF NEW.booking_status IN ('cancelled', 'pending') THEN RETURN NEW; END IF;
  new_span := public.booking_span(NEW.slot_id, NEW.custom_start_time, NEW.custom_end_time, NEW.end_date);
  IF new_span IS NULL THEN RETURN NEW; END IF;

  SELECT b.id, b.booking_number INTO clash
  FROM public.bookings b
  WHERE b.id <> NEW.id
    AND b.booking_status NOT IN ('cancelled', 'pending')
    AND public.booking_span(b.slot_id, b.custom_start_time, b.custom_end_time, b.end_date) && new_span
  LIMIT 1;

  IF clash.id IS NOT NULL THEN
    RAISE EXCEPTION 'This time overlaps booking % — please pick another time.', clash.booking_number
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;