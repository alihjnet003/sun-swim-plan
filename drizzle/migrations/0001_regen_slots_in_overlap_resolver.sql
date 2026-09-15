CREATE OR REPLACE FUNCTION public.resolve_booking_slot_overlaps(_booking_id uuid, _start time without time zone, _end time without time zone, _decisions jsonb DEFAULT '{}'::jsonb, _end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  crosses := (_end <= _start) OR (_end_date IS NOT NULL AND _end_date > start_date);
  IF crosses THEN
    effective_end_date := COALESCE(NULLIF(_end_date, start_date), start_date + 1);
    IF effective_end_date <= start_date THEN
      effective_end_date := start_date + 1;
    END IF;
  ELSE
    effective_end_date := start_date;
    IF _end <= _start THEN
      RAISE EXCEPTION 'end must be after start';
    END IF;
  END IF;

  -- Pass 1: enumerate conflicts.
  FOR seg_date, ov_start, ov_end IN
    SELECT * FROM (
      VALUES
        (start_date, _start, CASE WHEN crosses THEN TIME '23:59:59' ELSE _end END),
        (effective_end_date, TIME '00:00', _end)
    ) AS v(d, s, e)
    WHERE (crosses OR v.d = start_date)
  LOOP
    IF ov_end <= ov_start THEN CONTINUE; END IF;
    FOR s IN
      SELECT *,
             CASE WHEN end_time <= start_time THEN TIME '23:59:59' ELSE end_time END AS eff_end
        FROM public.booking_slots
       WHERE date = seg_date
         AND id <> b_slot.id
         AND start_time < ov_end
         AND (CASE WHEN end_time <= start_time THEN TIME '23:59:59' ELSE end_time END) > ov_start
       ORDER BY start_time
    LOOP
      IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = s.id AND id <> _booking_id AND booking_status <> 'cancelled') THEN
        RAISE EXCEPTION 'conflict: slot on % (%–%) is already booked', seg_date, s.start_time, s.end_time
          USING ERRCODE = 'check_violation';
      END IF;

      covered_full := (s.start_time >= ov_start AND s.eff_end <= ov_end);
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
    IF ov_end <= ov_start THEN CONTINUE; END IF;
    FOR s IN
      SELECT *,
             CASE WHEN end_time <= start_time THEN TIME '23:59:59' ELSE end_time END AS eff_end
        FROM public.booking_slots
       WHERE date = seg_date
         AND id <> b_slot.id
         AND start_time < ov_end
         AND (CASE WHEN end_time <= start_time THEN TIME '23:59:59' ELSE end_time END) > ov_start
       ORDER BY start_time
    LOOP
      covered_full := (s.start_time >= ov_start AND s.eff_end <= ov_end);
      IF covered_full THEN
        DELETE FROM public.booking_slots WHERE id = s.id;
        CONTINUE;
      END IF;

      decision := COALESCE(_decisions->>s.id::text, 'delete');
      IF decision = 'delete' THEN
        DELETE FROM public.booking_slots WHERE id = s.id;
      ELSIF decision = 'shrink' THEN
        IF s.start_time < ov_start AND s.eff_end > ov_end THEN
          IF (ov_start - s.start_time) >= (s.eff_end - ov_end) THEN
            new_start := s.start_time; new_end := ov_start;
          ELSE
            new_start := ov_end; new_end := s.eff_end;
          END IF;
        ELSIF s.start_time < ov_start THEN
          new_start := s.start_time; new_end := ov_start;
        ELSE
          new_start := ov_end; new_end := s.eff_end;
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

  UPDATE public.booking_slots
     SET start_time = _start,
         end_time   = CASE WHEN crosses THEN TIME '23:59:59' ELSE _end END
   WHERE id = b_slot.id;

  UPDATE public.bookings
     SET custom_start_time = _start,
         custom_end_time   = _end,
         end_date          = CASE WHEN crosses THEN effective_end_date ELSE NULL END
   WHERE id = _booking_id;

  -- Re-create free sessions for any time left over after the booking window.
  PERFORM public.generate_free_slots_for_date(start_date);
  IF crosses THEN
    PERFORM public.generate_free_slots_for_date(effective_end_date);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;