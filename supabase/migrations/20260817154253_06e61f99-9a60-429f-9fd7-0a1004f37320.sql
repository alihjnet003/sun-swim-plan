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

REVOKE ALL ON FUNCTION public.public_book_consecutive_slots(uuid[], text, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_book_consecutive_slots(uuid[], text, text, text, text, integer, text) TO anon, authenticated;