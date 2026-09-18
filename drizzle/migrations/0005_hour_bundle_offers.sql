ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS bundle_hours integer NOT NULL DEFAULT 0;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS free_hours integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.hourly_price(_hours numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  rate numeric;
  best numeric;
  cand numeric;
  blocksize integer;
  blocks integer;
  b RECORD;
BEGIN
  IF _hours IS NULL OR _hours <= 0 THEN RETURN NULL; END IF;

  SELECT o.price_normal INTO rate
    FROM public.offers o
   WHERE o.is_active AND o.per_hour
   ORDER BY o.sort_order, o.created_at
   LIMIT 1;
  IF rate IS NULL THEN RETURN NULL; END IF;

  best := round(rate * _hours, 3);

  FOR b IN
    SELECT o.bundle_hours, o.free_hours, o.price_normal
      FROM public.offers o
     WHERE o.is_active AND o.bundle_hours > 0
  LOOP
    blocksize := b.bundle_hours + GREATEST(b.free_hours, 0);
    IF blocksize < 1 THEN CONTINUE; END IF;
    blocks := floor(_hours / blocksize);
    IF blocks < 1 THEN CONTINUE; END IF;
    cand := blocks * b.price_normal + (_hours - blocks * blocksize) * rate;
    IF cand < best THEN best := cand; END IF;
  END LOOP;

  RETURN round(best, 3);
END;
$function$;

REVOKE ALL ON FUNCTION public.hourly_price(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hourly_price(numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.offer_price_for_slots(_slot_ids uuid[])
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
  is_hol boolean;
  p numeric;
  total_hours numeric;
  hourly numeric;
BEGIN
  n := COALESCE(array_length(_slot_ids, 1), 0);
  IF n < 1 THEN RETURN NULL; END IF;

  SELECT bool_or(public.is_holiday_session(s.date, s.start_time)) INTO is_hol
    FROM public.booking_slots s WHERE s.id = ANY(_slot_ids);

  IF NOT COALESCE(is_hol, false) THEN
    SELECT sum(
             EXTRACT(epoch FROM (
               (CASE WHEN s.end_time <= s.start_time THEN TIME '23:59:59' ELSE s.end_time END)
               - s.start_time
             )) / 3600.0
           ) INTO total_hours
      FROM public.booking_slots s WHERE s.id = ANY(_slot_ids);

    IF total_hours IS NOT NULL THEN
      hourly := public.hourly_price(round(total_hours)::numeric);
      IF hourly IS NOT NULL THEN RETURN hourly; END IF;
    END IF;
  END IF;

  SELECT CASE WHEN COALESCE(is_hol, false) THEN o.price_holiday ELSE o.price_normal END
    INTO p
    FROM public.offers o
   WHERE o.is_active
     AND NOT o.per_hour
     AND o.bundle_hours = 0
     AND o.slots_count = n
     AND (NOT COALESCE(is_hol, false) OR NOT o.exclude_holidays)
   ORDER BY o.sort_order, o.created_at
   LIMIT 1;

  RETURN p;
END;
$function$;

CREATE OR REPLACE FUNCTION public.public_book_hours(_date date, _start time without time zone, _hours integer, _customer_name text, _phone text, _whatsapp text DEFAULT NULL::text, _email text DEFAULT NULL::text, _people_count integer DEFAULT 1, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_enabled boolean;
  start_ts timestamp;
  end_ts timestamp;
  end_day date;
  end_t time;
  crosses boolean;
  hourly numeric;
  total numeric;
  cursor_ts timestamp;
  s RECORD;
  h integer;
  probe timestamp;
  new_customer_id uuid;
  new_booking_id uuid;
  new_slot_id uuid;
  booking_num text;
  leftover_price numeric;
BEGIN
  SELECT public_booking_enabled INTO is_enabled FROM public.app_settings WHERE id = 1;
  IF NOT COALESCE(is_enabled, true) THEN
    RAISE EXCEPTION 'public booking is currently disabled';
  END IF;

  IF _date IS NULL OR _start IS NULL THEN RAISE EXCEPTION 'date and start are required'; END IF;
  IF _hours IS NULL OR _hours < 1 OR _hours > 12 THEN RAISE EXCEPTION 'invalid hours'; END IF;
  IF EXTRACT(minute FROM _start) <> 0 OR EXTRACT(second FROM _start) <> 0 THEN
    RAISE EXCEPTION 'start must be on the hour';
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

  start_ts := (_date + _start)::timestamp;
  end_ts   := start_ts + (_hours || ' hour')::interval;
  end_day  := end_ts::date;
  end_t    := end_ts::time;
  crosses  := end_day > _date;

  FOR h IN 0.._hours - 1 LOOP
    probe := start_ts + (h || ' hour')::interval;
    IF public.is_holiday_session(probe::date, probe::time) THEN
      RAISE EXCEPTION 'hourly booking is not available on holidays';
    END IF;
  END LOOP;

  SELECT o.price_normal INTO hourly
    FROM public.offers o
   WHERE o.is_active AND o.per_hour
   ORDER BY o.sort_order, o.created_at
   LIMIT 1;
  IF hourly IS NULL THEN RAISE EXCEPTION 'hourly booking is not available'; END IF;
  total := COALESCE(public.hourly_price(_hours::numeric), round(hourly * _hours, 3));

  PERFORM pg_advisory_xact_lock(hashtext('public_book_consecutive_slots'));

  IF EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.booking_status NOT IN ('cancelled', 'pending')
       AND public.booking_span(b.slot_id, b.custom_start_time, b.custom_end_time, b.end_date)
           && tsrange(start_ts, end_ts, '[)')
  ) THEN
    RAISE EXCEPTION 'this time is no longer available';
  END IF;

  cursor_ts := start_ts;
  FOR s IN
    SELECT sl.id,
           (sl.date + sl.start_time)::timestamp AS s_ts,
           (sl.date + CASE WHEN sl.end_time <= sl.start_time THEN TIME '23:59:59' ELSE sl.end_time END)::timestamp AS e_ts
      FROM public.booking_slots sl
     WHERE sl.date BETWEEN _date AND end_day
       AND NOT sl.is_closed
       AND NOT EXISTS (
         SELECT 1 FROM public.bookings b
          WHERE b.slot_id = sl.id AND b.booking_status <> 'cancelled')
     ORDER BY sl.date, sl.start_time
     FOR UPDATE
  LOOP
    IF s.e_ts <= cursor_ts THEN CONTINUE; END IF;
    IF s.s_ts > cursor_ts THEN EXIT; END IF;
    cursor_ts := s.e_ts;
    IF s.e_ts::time = TIME '23:59:59' THEN cursor_ts := cursor_ts + interval '1 second'; END IF;
    EXIT WHEN cursor_ts >= end_ts;
  END LOOP;
  IF cursor_ts < end_ts THEN
    RAISE EXCEPTION 'the requested hours are not fully available';
  END IF;

  FOR s IN
    SELECT sl.*,
           (sl.date + sl.start_time)::timestamp AS s_ts,
           (sl.date + CASE WHEN sl.end_time <= sl.start_time THEN TIME '23:59:59' ELSE sl.end_time END)::timestamp AS e_ts
      FROM public.booking_slots sl
     WHERE sl.date BETWEEN _date AND end_day
       AND NOT sl.is_closed
       AND NOT EXISTS (
         SELECT 1 FROM public.bookings b
          WHERE b.slot_id = sl.id AND b.booking_status <> 'cancelled')
     ORDER BY sl.date, sl.start_time
  LOOP
    IF s.e_ts <= start_ts OR s.s_ts >= end_ts THEN CONTINUE; END IF;

    IF s.s_ts >= start_ts AND s.e_ts <= end_ts + interval '1 second' THEN
      DELETE FROM public.booking_slots WHERE id = s.id;
    ELSIF s.s_ts < start_ts AND s.e_ts > end_ts THEN
      leftover_price := round(hourly * (EXTRACT(epoch FROM (s.e_ts - end_ts)) / 3600.0)::numeric, 3);
      INSERT INTO public.booking_slots (date, start_time, end_time, price, label, is_closed)
      VALUES (end_ts::date, end_ts::time, s.e_ts::time, leftover_price, s.label, false);
      UPDATE public.booking_slots
         SET end_time = start_ts::time,
             price = round(hourly * (EXTRACT(epoch FROM (start_ts - s.s_ts)) / 3600.0)::numeric, 3)
       WHERE id = s.id;
    ELSIF s.s_ts < start_ts THEN
      UPDATE public.booking_slots
         SET end_time = start_ts::time,
             price = round(hourly * (EXTRACT(epoch FROM (start_ts - s.s_ts)) / 3600.0)::numeric, 3)
       WHERE id = s.id;
    ELSE
      UPDATE public.booking_slots
         SET start_time = end_ts::time,
             price = round(hourly * (EXTRACT(epoch FROM (s.e_ts - end_ts)) / 3600.0)::numeric, 3)
       WHERE id = s.id;
    END IF;
  END LOOP;

  INSERT INTO public.booking_slots (date, start_time, end_time, price, label, is_closed)
  VALUES (_date, _start, CASE WHEN crosses THEN TIME '23:59:59' ELSE end_t END, total, 'Hourly', false)
  RETURNING id INTO new_slot_id;

  INSERT INTO public.customers (full_name, phone, whatsapp, email, notes)
    VALUES (btrim(_customer_name), btrim(_phone),
            NULLIF(btrim(COALESCE(_whatsapp,'')),''),
            NULLIF(btrim(COALESCE(_email,'')),''),
            _notes)
    RETURNING id INTO new_customer_id;

  booking_num := 'H' || to_char(now(), 'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text, 3, '0');

  INSERT INTO public.bookings (
    booking_number, customer_id, slot_id, booking_status, payment_status,
    subtotal, discount, deposit_amount, paid_amount, remaining_amount,
    people_count, notes, custom_start_time, custom_end_time, end_date
  ) VALUES (
    booking_num, new_customer_id, new_slot_id, 'pending', 'unpaid',
    total, 0, 0, 0, total,
    _people_count, _notes, _start, end_t,
    CASE WHEN crosses THEN end_day ELSE NULL END
  ) RETURNING id INTO new_booking_id;

  RETURN jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'total', total);
END;
$function$;