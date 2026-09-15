ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS exclude_holidays boolean NOT NULL DEFAULT false;

UPDATE public.offers SET exclude_holidays = true WHERE slots_count = 1;

CREATE OR REPLACE FUNCTION public.offer_price_for_slots(_slot_ids uuid[])
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  n integer;
  is_hol boolean;
  p numeric;
BEGIN
  n := COALESCE(array_length(_slot_ids, 1), 0);
  IF n < 1 THEN RETURN NULL; END IF;

  SELECT bool_or(public.is_holiday_session(s.date, s.start_time)) INTO is_hol
    FROM public.booking_slots s WHERE s.id = ANY(_slot_ids);

  SELECT CASE WHEN COALESCE(is_hol, false) THEN o.price_holiday ELSE o.price_normal END
    INTO p
    FROM public.offers o
   WHERE o.is_active
     AND o.slots_count = n
     AND (NOT COALESCE(is_hol, false) OR NOT o.exclude_holidays)
   ORDER BY o.sort_order, o.created_at
   LIMIT 1;

  RETURN p;
END;
$$;