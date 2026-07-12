
-- 1) Extend bookings with custom start/end
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS custom_start_time time,
  ADD COLUMN IF NOT EXISTS custom_end_time time;

-- 2) Resolve slot overlaps for an extended booking.
--    decisions maps other-slot-id -> 'delete' | 'shrink'.
--    Returns jsonb: {ok:true} or {conflicts:[{slot_id,start_time,end_time,coverage}]}
CREATE OR REPLACE FUNCTION public.resolve_booking_slot_overlaps(
  _booking_id uuid,
  _start time,
  _end time,
  _decisions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  s RECORD;
  b_slot RECORD;
  conflicts jsonb := '[]'::jsonb;
  decision text;
  new_start time;
  new_end   time;
  covered_full boolean;
  is_admin boolean;
BEGIN
  -- Only staff/admin allowed here (public path uses SECURITY DEFINER with role check).
  SELECT public.is_staff_or_admin(auth.uid()) INTO is_admin;
  IF NOT is_admin THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF _end <= _start THEN
    RAISE EXCEPTION 'end must be after start';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;

  SELECT * INTO b_slot FROM public.booking_slots WHERE id = b.slot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'slot not found'; END IF;

  -- Pass 1: enumerate overlapping OTHER slots on the same date.
  FOR s IN
    SELECT * FROM public.booking_slots
    WHERE date = b_slot.date
      AND id <> b_slot.id
      AND start_time < _end
      AND end_time   > _start
    ORDER BY start_time
  LOOP
    -- Reject if any overlapping slot is booked by someone else.
    IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = s.id AND id <> _booking_id) THEN
      RAISE EXCEPTION 'conflict: slot % (%–%) is already booked', s.id, s.start_time, s.end_time
        USING ERRCODE = 'check_violation';
    END IF;

    covered_full := (s.start_time >= _start AND s.end_time <= _end);

    IF covered_full THEN
      -- silent delete of fully-covered empty slot
      CONTINUE;
    END IF;

    -- Partial overlap: needs decision
    decision := _decisions->>s.id::text;
    IF decision IS NULL THEN
      conflicts := conflicts || jsonb_build_object(
        'slot_id', s.id,
        'start_time', to_char(s.start_time, 'HH24:MI'),
        'end_time',   to_char(s.end_time,   'HH24:MI'),
        'coverage', 'partial'
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 THEN
    RETURN jsonb_build_object('conflicts', conflicts);
  END IF;

  -- Pass 2: apply changes.
  FOR s IN
    SELECT * FROM public.booking_slots
    WHERE date = b_slot.date
      AND id <> b_slot.id
      AND start_time < _end
      AND end_time   > _start
    ORDER BY start_time
  LOOP
    covered_full := (s.start_time >= _start AND s.end_time <= _end);
    IF covered_full THEN
      DELETE FROM public.booking_slots WHERE id = s.id;
      CONTINUE;
    END IF;

    decision := COALESCE(_decisions->>s.id::text, 'delete');
    IF decision = 'delete' THEN
      DELETE FROM public.booking_slots WHERE id = s.id;
    ELSIF decision = 'shrink' THEN
      -- Shrink: cut the overlapping segment out.
      IF s.start_time < _start AND s.end_time > _end THEN
        -- straddles: keep the longer side
        IF (_start - s.start_time) >= (s.end_time - _end) THEN
          new_start := s.start_time;
          new_end   := _start;
        ELSE
          new_start := _end;
          new_end   := s.end_time;
        END IF;
      ELSIF s.start_time < _start THEN
        new_start := s.start_time;
        new_end   := _start;
      ELSE
        new_start := _end;
        new_end   := s.end_time;
      END IF;

      IF new_end <= new_start THEN
        DELETE FROM public.booking_slots WHERE id = s.id;
      ELSE
        UPDATE public.booking_slots
           SET start_time = new_start,
               end_time   = new_end
         WHERE id = s.id;
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid decision % for slot %', decision, s.id;
    END IF;
  END LOOP;

  -- Update the booking's own slot to match the extended window.
  UPDATE public.booking_slots
     SET start_time = _start,
         end_time   = _end
   WHERE id = b_slot.id;

  UPDATE public.bookings
     SET custom_start_time = _start,
         custom_end_time   = _end
   WHERE id = _booking_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_booking_slot_overlaps(uuid, time, time, jsonb) TO authenticated;

-- 3) Public multi-slot booking: create ONE booking spanning several consecutive slots.
CREATE OR REPLACE FUNCTION public.public_book_consecutive_slots(
  _slot_ids uuid[],
  _customer_name text,
  _phone text,
  _whatsapp text DEFAULT NULL,
  _email text DEFAULT NULL,
  _people_count int DEFAULT 1,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  slots_arr RECORD;
  first_slot RECORD;
  last_slot RECORD;
  prev_end time;
  the_date date;
  total_price numeric := 0;
  s RECORD;
  new_booking_id uuid;
  new_customer_id uuid;
  booking_num text;
  ext_slot RECORD;
BEGIN
  IF _slot_ids IS NULL OR array_length(_slot_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no slots provided';
  END IF;

  IF _customer_name IS NULL OR btrim(_customer_name) = '' OR _phone IS NULL OR btrim(_phone) = '' THEN
    RAISE EXCEPTION 'name and phone are required';
  END IF;

  -- Validate slots: same date, ordered, contiguous, open, unbooked
  SELECT * INTO first_slot FROM public.booking_slots
   WHERE id = ANY(_slot_ids)
   ORDER BY date, start_time LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'slot not found'; END IF;
  the_date := first_slot.date;

  FOR s IN
    SELECT * FROM public.booking_slots
     WHERE id = ANY(_slot_ids)
     ORDER BY start_time
  LOOP
    IF s.date <> the_date THEN RAISE EXCEPTION 'slots must be on same date'; END IF;
    IF s.is_closed THEN RAISE EXCEPTION 'slot % is closed', s.id; END IF;
    IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = s.id) THEN
      RAISE EXCEPTION 'slot % (%–%) is already booked', s.id, s.start_time, s.end_time;
    END IF;
    IF prev_end IS NOT NULL AND s.start_time <> prev_end THEN
      RAISE EXCEPTION 'slots are not consecutive';
    END IF;
    prev_end := s.end_time;
    total_price := total_price + COALESCE(s.price, 0);
    last_slot := s;
  END LOOP;

  -- Create customer
  INSERT INTO public.customers (full_name, phone, whatsapp, email, notes)
    VALUES (btrim(_customer_name), btrim(_phone), NULLIF(btrim(COALESCE(_whatsapp,'')),''), NULLIF(btrim(COALESCE(_email,'')),''), _notes)
    RETURNING id INTO new_customer_id;

  booking_num := 'B' || to_char(now(), 'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text, 3, '0');

  INSERT INTO public.bookings (
    booking_number, customer_id, slot_id, booking_status, payment_status,
    subtotal, discount, deposit_amount, paid_amount, remaining_amount,
    people_count, notes, custom_start_time, custom_end_time
  ) VALUES (
    booking_num, new_customer_id, first_slot.id, 'new', 'unpaid',
    total_price, 0, 0, 0, total_price,
    _people_count, _notes, first_slot.start_time, last_slot.end_time
  ) RETURNING id INTO new_booking_id;

  -- Extend the first slot to cover the whole range and delete the rest
  UPDATE public.booking_slots
     SET start_time = first_slot.start_time,
         end_time   = last_slot.end_time
   WHERE id = first_slot.id;

  DELETE FROM public.booking_slots
   WHERE id = ANY(_slot_ids)
     AND id <> first_slot.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', new_booking_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_book_consecutive_slots(uuid[], text, text, text, text, int, text) TO anon, authenticated;
