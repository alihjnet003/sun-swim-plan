CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ar text NOT NULL DEFAULT '',
  title_en text NOT NULL DEFAULT '',
  slots_count integer NOT NULL DEFAULT 2,
  price_normal numeric NOT NULL DEFAULT 0,
  price_holiday numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.offers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offers TO authenticated;
GRANT ALL ON public.offers TO service_role;

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read active offers" ON public.offers
  FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "signed-in read offers" ON public.offers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert offers" ON public.offers
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update offers" ON public.offers
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete offers" ON public.offers
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER offers_touch BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.offers (title_ar, title_en, slots_count, price_normal, price_holiday, sort_order)
VALUES ('عرض الفترتين (9 ساعات)', 'Two-session offer (9 hours)', 2, 45, 65, 1);

-- Holiday session rule: Thursday evening, all Friday, Saturday mornings
CREATE OR REPLACE FUNCTION public.is_holiday_session(_date date, _start time)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (EXTRACT(dow FROM _date) = 4 AND _start >= TIME '14:00')
      OR EXTRACT(dow FROM _date) = 5
      OR (EXTRACT(dow FROM _date) = 6 AND _start < TIME '14:00')
$$;

-- Returns the bundle price for a set of slots, or NULL when no offer matches
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
  IF n < 2 THEN RETURN NULL; END IF;

  SELECT bool_or(public.is_holiday_session(s.date, s.start_time)) INTO is_hol
    FROM public.booking_slots s WHERE s.id = ANY(_slot_ids);

  SELECT CASE WHEN COALESCE(is_hol, false) THEN o.price_holiday ELSE o.price_normal END
    INTO p
    FROM public.offers o
   WHERE o.is_active AND o.slots_count = n
   ORDER BY o.sort_order, o.created_at
   LIMIT 1;

  RETURN p;
END;
$$;

REVOKE ALL ON FUNCTION public.offer_price_for_slots(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_price_for_slots(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_holiday_session(date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_holiday_session(date, time) TO authenticated, service_role;

-- Apply the offer automatically for public bookings
CREATE OR REPLACE FUNCTION public.public_book_consecutive_slots(_slot_ids uuid[], _customer_name text, _phone text, _whatsapp text DEFAULT NULL::text, _email text DEFAULT NULL::text, _people_count integer DEFAULT 1, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  first_slot RECORD;
  last_slot RECORD;
  prev RECORD;
  total_price numeric := 0;
  offer_total numeric;
  discount_val numeric := 0;
  s RECORD;
  new_booking_id uuid;
  new_customer_id uuid;
  booking_num text;
  crosses boolean := false;
  anchor_end time;
  end_day date;
  end_date_val date;
  is_enabled boolean;
  req_span tsrange;
BEGIN
  SELECT public_booking_enabled INTO is_enabled FROM public.app_settings WHERE id = 1;
  IF NOT COALESCE(is_enabled, true) THEN
    RAISE EXCEPTION 'public booking is currently disabled';
  END IF;

  IF _slot_ids IS NULL OR array_length(_slot_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no slots provided';
  END IF;
  IF array_length(_slot_ids, 1) > 12 THEN
    RAISE EXCEPTION 'too many sessions requested';
  END IF;
  IF _customer_name IS NULL OR btrim(_customer_name) = '' OR _phone IS NULL OR btrim(_phone) = '' THEN
    RAISE EXCEPTION 'name and phone are required';
  END IF;
  IF length(btrim(_customer_name)) > 100 THEN RAISE EXCEPTION 'name is too long'; END IF;
  IF length(btrim(_phone)) > 30 THEN RAISE EXCEPTION 'phone is too long'; END IF;
  IF _whatsapp IS NOT NULL AND length(btrim(_whatsapp)) > 30 THEN RAISE EXCEPTION 'whatsapp is too long'; END IF;
  IF _notes IS NOT NULL AND length(_notes) > 1000 THEN RAISE EXCEPTION 'notes are too long'; END IF;
  IF _email IS NOT NULL AND btrim(_email) <> '' THEN
    IF length(btrim(_email)) > 200 OR btrim(_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' THEN
      RAISE EXCEPTION 'invalid email';
    END IF;
  END IF;
  IF _people_count IS NULL OR _people_count < 1 OR _people_count > 200 THEN
    RAISE EXCEPTION 'invalid people count';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('public_book_consecutive_slots'));

  prev := NULL;
  FOR s IN
    SELECT * FROM public.booking_slots
     WHERE id = ANY(_slot_ids)
     ORDER BY date, start_time
     FOR UPDATE
  LOOP
    IF s.is_closed THEN RAISE EXCEPTION 'slot % is closed', s.id; END IF;
    IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = s.id AND booking_status <> 'cancelled') THEN
      RAISE EXCEPTION 'this session is already booked';
    END IF;

    IF first_slot IS NULL THEN
      first_slot := s;
    ELSE
      IF s.date = prev.date THEN
        IF s.start_time <> prev.end_time THEN RAISE EXCEPTION 'slots are not consecutive'; END IF;
      ELSIF s.date = prev.date + 1 AND s.start_time = TIME '00:00'
            AND (prev.end_time = TIME '23:59:59' OR prev.end_time = TIME '00:00') THEN
        IF crosses THEN RAISE EXCEPTION 'only one midnight crossing allowed'; END IF;
        crosses := true;
      ELSE
        RAISE EXCEPTION 'slots are not consecutive across days';
      END IF;
    END IF;

    total_price := total_price + COALESCE(s.price, 0);
    last_slot := s;
    prev := s;
  END LOOP;

  IF first_slot IS NULL THEN RAISE EXCEPTION 'slot not found'; END IF;

  offer_total := public.offer_price_for_slots(_slot_ids);
  IF offer_total IS NOT NULL AND offer_total < total_price THEN
    discount_val := total_price - offer_total;
  END IF;

  IF last_slot.end_time <= last_slot.start_time THEN
    end_day := last_slot.date + 1;
  ELSE
    end_day := last_slot.date;
  END IF;

  crosses := (end_day > first_slot.date);

  req_span := tsrange(
    (first_slot.date + first_slot.start_time)::timestamp,
    (end_day + last_slot.end_time)::timestamp,
    '[)'
  );
  IF EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.booking_status NOT IN ('cancelled', 'pending')
       AND public.booking_span(b.slot_id, b.custom_start_time, b.custom_end_time, b.end_date) && req_span
  ) THEN
    RAISE EXCEPTION 'this time is no longer available';
  END IF;

  INSERT INTO public.customers (full_name, phone, whatsapp, email, notes)
    VALUES (btrim(_customer_name), btrim(_phone),
            NULLIF(btrim(COALESCE(_whatsapp,'')),''),
            NULLIF(btrim(COALESCE(_email,'')),''),
            _notes)
    RETURNING id INTO new_customer_id;

  booking_num := 'B' || to_char(now(), 'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text, 3, '0');

  anchor_end   := CASE WHEN crosses THEN TIME '23:59:59' ELSE last_slot.end_time END;
  end_date_val := CASE WHEN crosses THEN end_day ELSE NULL END;

  INSERT INTO public.bookings (
    booking_number, customer_id, slot_id, booking_status, payment_status,
    subtotal, discount, deposit_amount, paid_amount, remaining_amount,
    people_count, notes, custom_start_time, custom_end_time, end_date
  ) VALUES (
    booking_num, new_customer_id, first_slot.id, 'pending', 'unpaid',
    total_price, discount_val, 0, 0, GREATEST(total_price - discount_val, 0),
    _people_count, _notes, first_slot.start_time, last_slot.end_time, end_date_val
  ) RETURNING id INTO new_booking_id;

  UPDATE public.booking_slots
     SET start_time = first_slot.start_time,
         end_time   = anchor_end
   WHERE id = first_slot.id;

  DELETE FROM public.booking_slots
   WHERE id = ANY(_slot_ids)
     AND id <> first_slot.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'discount', discount_val);
END;
$function$;