-- Helper: effective time range of a booking
CREATE OR REPLACE FUNCTION public.booking_span(_slot_id uuid, _custom_start time, _custom_end time, _end_date date)
RETURNS tsrange
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  sl RECORD;
  st time;
  en time;
  sd date;
  ed date;
BEGIN
  SELECT date, start_time, end_time INTO sl FROM public.booking_slots WHERE id = _slot_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  sd := sl.date;
  st := COALESCE(_custom_start, sl.start_time);
  en := COALESCE(_custom_end, sl.end_time);
  IF _end_date IS NOT NULL AND _end_date > sd THEN
    ed := _end_date;
  ELSIF en <= st THEN
    ed := sd + 1;
  ELSE
    ed := sd;
  END IF;
  RETURN tsrange((sd + st)::timestamp, (ed + en)::timestamp, '[)');
END;
$$;

REVOKE ALL ON FUNCTION public.booking_span(uuid, time, time, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_span(uuid, time, time, date) TO authenticated, service_role;

-- Guard: no two active bookings may overlap in time
CREATE OR REPLACE FUNCTION public.prevent_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_span tsrange;
  clash RECORD;
BEGIN
  IF NEW.booking_status = 'cancelled' THEN RETURN NEW; END IF;
  new_span := public.booking_span(NEW.slot_id, NEW.custom_start_time, NEW.custom_end_time, NEW.end_date);
  IF new_span IS NULL THEN RETURN NEW; END IF;

  SELECT b.id, b.booking_number INTO clash
  FROM public.bookings b
  WHERE b.id <> NEW.id
    AND b.booking_status <> 'cancelled'
    AND public.booking_span(b.slot_id, b.custom_start_time, b.custom_end_time, b.end_date) && new_span
  LIMIT 1;

  IF clash.id IS NOT NULL THEN
    RAISE EXCEPTION 'This time overlaps booking % — please pick another time.', clash.booking_number
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_booking_overlap ON public.bookings;
CREATE TRIGGER trg_prevent_booking_overlap
  BEFORE INSERT OR UPDATE OF slot_id, custom_start_time, custom_end_time, end_date, booking_status
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_booking_overlap();

-- Public booking: lock slots and reject clashes
CREATE OR REPLACE FUNCTION public.public_book_consecutive_slots(
  _slot_ids uuid[],
  _customer_name text,
  _phone text,
  _whatsapp text DEFAULT NULL::text,
  _email text DEFAULT NULL::text,
  _people_count integer DEFAULT 1,
  _notes text DEFAULT NULL::text
)
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
  s RECORD;
  new_booking_id uuid;
  new_customer_id uuid;
  booking_num text;
  crosses boolean := false;
  anchor_end time;
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
  IF _customer_name IS NULL OR btrim(_customer_name) = '' OR _phone IS NULL OR btrim(_phone) = '' THEN
    RAISE EXCEPTION 'name and phone are required';
  END IF;

  -- serialize concurrent public bookings
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
            AND (prev.end_time = TIME '23:59:59' OR prev.end_time = TIME '24:00' OR prev.end_time = TIME '00:00') THEN
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

  crosses := crosses OR (last_slot.date > first_slot.date);

  -- reject if the requested window clashes with any active booking
  req_span := tsrange(
    (first_slot.date + first_slot.start_time)::timestamp,
    (CASE WHEN crosses THEN last_slot.date ELSE first_slot.date END + last_slot.end_time)::timestamp,
    '[)'
  );
  IF EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.booking_status <> 'cancelled'
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
  end_date_val := CASE WHEN crosses THEN last_slot.date ELSE NULL END;

  INSERT INTO public.bookings (
    booking_number, customer_id, slot_id, booking_status, payment_status,
    subtotal, discount, deposit_amount, paid_amount, remaining_amount,
    people_count, notes, custom_start_time, custom_end_time, end_date
  ) VALUES (
    booking_num, new_customer_id, first_slot.id, 'pending', 'unpaid',
    total_price, 0, 0, 0, total_price,
    _people_count, _notes, first_slot.start_time, last_slot.end_time, end_date_val
  ) RETURNING id INTO new_booking_id;

  UPDATE public.booking_slots
     SET start_time = first_slot.start_time,
         end_time   = anchor_end
   WHERE id = first_slot.id;

  DELETE FROM public.booking_slots
   WHERE id = ANY(_slot_ids)
     AND id <> first_slot.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', new_booking_id);
END;
$function$;
