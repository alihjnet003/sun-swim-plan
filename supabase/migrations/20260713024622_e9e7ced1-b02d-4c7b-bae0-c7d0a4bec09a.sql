
-- Overnight bookings support
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS end_date DATE NULL;

-- Rewrite resolve_booking_slot_overlaps to support overnight (cross-midnight) ranges.
CREATE OR REPLACE FUNCTION public.resolve_booking_slot_overlaps(
  _booking_id uuid,
  _start time,
  _end time,
  _decisions jsonb DEFAULT '{}'::jsonb,
  _end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  crosses boolean;
  start_date date;
  effective_end_date date;
  ov_start time;
  ov_end   time;
  seg_date date;
BEGIN
  SELECT public.is_staff_or_admin(auth.uid()) INTO is_admin;
  IF NOT is_admin THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;

  SELECT * INTO b_slot FROM public.booking_slots WHERE id = b.slot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'slot not found'; END IF;

  start_date := b_slot.date;
  -- Auto-detect overnight: end <= start, or caller provided a later end_date
  crosses := (_end <= _start) OR (_end_date IS NOT NULL AND _end_date > start_date);
  IF crosses THEN
    effective_end_date := COALESCE(_end_date, start_date + 1);
    IF effective_end_date <= start_date THEN
      RAISE EXCEPTION 'end_date must be after start date for overnight bookings';
    END IF;
  ELSE
    effective_end_date := start_date;
    IF _end <= _start THEN
      RAISE EXCEPTION 'end must be after start';
    END IF;
  END IF;

  -- We check overlaps on the start day (window [_start, 24:00)) AND, if overnight,
  -- on the end day (window [00:00, _end)).
  FOR seg_date, ov_start, ov_end IN
    SELECT * FROM (
      VALUES
        (start_date, _start, CASE WHEN crosses THEN TIME '23:59:59' ELSE _end END),
        (effective_end_date, TIME '00:00', _end)
    ) AS v(d, s, e)
    WHERE (crosses OR v.d = start_date)
  LOOP
    -- Pass 1: enumerate conflicts.
    FOR s IN
      SELECT * FROM public.booking_slots
      WHERE date = seg_date
        AND id <> b_slot.id
        AND start_time < ov_end
        AND end_time   > ov_start
      ORDER BY start_time
    LOOP
      IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = s.id AND id <> _booking_id) THEN
        RAISE EXCEPTION 'conflict: slot on % (%–%) is already booked', seg_date, s.start_time, s.end_time
          USING ERRCODE = 'check_violation';
      END IF;

      covered_full := (s.start_time >= ov_start AND s.end_time <= ov_end);
      IF covered_full THEN CONTINUE; END IF;

      decision := _decisions->>s.id::text;
      IF decision IS NULL THEN
        conflicts := conflicts || jsonb_build_object(
          'slot_id', s.id,
          'date', to_char(seg_date, 'YYYY-MM-DD'),
          'start_time', to_char(s.start_time, 'HH24:MI'),
          'end_time',   to_char(s.end_time,   'HH24:MI'),
          'coverage', 'partial'
        );
      END IF;
    END LOOP;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 THEN
    RETURN jsonb_build_object('conflicts', conflicts);
  END IF;

  -- Pass 2: apply changes.
  FOR seg_date, ov_start, ov_end IN
    SELECT * FROM (
      VALUES
        (start_date, _start, CASE WHEN crosses THEN TIME '23:59:59' ELSE _end END),
        (effective_end_date, TIME '00:00', _end)
    ) AS v(d, s, e)
    WHERE (crosses OR v.d = start_date)
  LOOP
    FOR s IN
      SELECT * FROM public.booking_slots
      WHERE date = seg_date
        AND id <> b_slot.id
        AND start_time < ov_end
        AND end_time   > ov_start
      ORDER BY start_time
    LOOP
      covered_full := (s.start_time >= ov_start AND s.end_time <= ov_end);
      IF covered_full THEN
        DELETE FROM public.booking_slots WHERE id = s.id;
        CONTINUE;
      END IF;

      decision := COALESCE(_decisions->>s.id::text, 'delete');
      IF decision = 'delete' THEN
        DELETE FROM public.booking_slots WHERE id = s.id;
      ELSIF decision = 'shrink' THEN
        IF s.start_time < ov_start AND s.end_time > ov_end THEN
          IF (ov_start - s.start_time) >= (s.end_time - ov_end) THEN
            new_start := s.start_time; new_end := ov_start;
          ELSE
            new_start := ov_end; new_end := s.end_time;
          END IF;
        ELSIF s.start_time < ov_start THEN
          new_start := s.start_time; new_end := ov_start;
        ELSE
          new_start := ov_end; new_end := s.end_time;
        END IF;

        IF new_end <= new_start THEN
          DELETE FROM public.booking_slots WHERE id = s.id;
        ELSE
          UPDATE public.booking_slots
             SET start_time = new_start, end_time = new_end
           WHERE id = s.id;
        END IF;
      ELSE
        RAISE EXCEPTION 'invalid decision % for slot %', decision, s.id;
      END IF;
    END LOOP;
  END LOOP;

  -- Update the anchor slot: keep it on the start date; if overnight, extend to 23:59:59.
  UPDATE public.booking_slots
     SET start_time = _start,
         end_time   = CASE WHEN crosses THEN TIME '23:59:59' ELSE _end END
   WHERE id = b_slot.id;

  UPDATE public.bookings
     SET custom_start_time = _start,
         custom_end_time   = _end,
         end_date          = CASE WHEN crosses THEN effective_end_date ELSE NULL END
   WHERE id = _booking_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Rewrite public_book_consecutive_slots to allow crossing midnight.
CREATE OR REPLACE FUNCTION public.public_book_consecutive_slots(
  _slot_ids uuid[],
  _customer_name text,
  _phone text,
  _whatsapp text DEFAULT NULL,
  _email text DEFAULT NULL,
  _people_count integer DEFAULT 1,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  IF _slot_ids IS NULL OR array_length(_slot_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no slots provided';
  END IF;
  IF _customer_name IS NULL OR btrim(_customer_name) = '' OR _phone IS NULL OR btrim(_phone) = '' THEN
    RAISE EXCEPTION 'name and phone are required';
  END IF;

  -- Validate slots: contiguous, open, unbooked. Allow one midnight crossing.
  prev := NULL;
  FOR s IN
    SELECT * FROM public.booking_slots
     WHERE id = ANY(_slot_ids)
     ORDER BY date, start_time
  LOOP
    IF s.is_closed THEN RAISE EXCEPTION 'slot % is closed', s.id; END IF;
    IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = s.id) THEN
      RAISE EXCEPTION 'slot % is already booked', s.id;
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
    booking_num, new_customer_id, first_slot.id, 'new', 'unpaid',
    total_price, 0, 0, 0, total_price,
    _people_count, _notes, first_slot.start_time, last_slot.end_time, end_date_val
  ) RETURNING id INTO new_booking_id;

  -- Extend the anchor slot to cover the whole first-day range (up to midnight if overnight).
  UPDATE public.booking_slots
     SET start_time = first_slot.start_time,
         end_time   = anchor_end
   WHERE id = first_slot.id;

  -- Delete all other picked slots (same-day siblings AND next-day tail).
  DELETE FROM public.booking_slots
   WHERE id = ANY(_slot_ids)
     AND id <> first_slot.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', new_booking_id);
END;
$$;
