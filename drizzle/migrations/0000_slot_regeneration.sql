-- Standard session grid: 02-06, 08-12, 14-18, 20-24 (stored as 23:59:59)
CREATE OR REPLACE FUNCTION public.generate_free_slots_for_date(_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  w RECORD;
  s RECORD;
  cursor_t time;
  created integer := 0;
  seg_end time;
BEGIN
  IF _date IS NULL THEN RETURN 0; END IF;

  FOR w IN
    SELECT * FROM (VALUES
      (TIME '02:00', TIME '06:00',     'Dawn'),
      (TIME '08:00', TIME '12:00',     'Morning'),
      (TIME '14:00', TIME '18:00',     'Afternoon'),
      (TIME '20:00', TIME '23:59:59',  'Evening')
    ) AS v(ws, we, label)
  LOOP
    cursor_t := w.ws;

    FOR s IN
      SELECT start_time,
             CASE WHEN end_time <= start_time THEN TIME '23:59:59' ELSE end_time END AS eff_end
        FROM public.booking_slots
       WHERE date = _date
         AND start_time < w.we
         AND (CASE WHEN end_time <= start_time THEN TIME '23:59:59' ELSE end_time END) > w.ws
       ORDER BY start_time
    LOOP
      IF s.start_time > cursor_t THEN
        seg_end := LEAST(s.start_time, w.we);
        IF seg_end > cursor_t THEN
          INSERT INTO public.booking_slots (date, start_time, end_time, price, label, is_closed)
          VALUES (_date, cursor_t, seg_end,
                  CASE WHEN public.is_holiday_session(_date, w.ws) THEN 35 ELSE 25 END,
                  w.label, false);
          created := created + 1;
        END IF;
      END IF;
      IF s.eff_end > cursor_t THEN
        cursor_t := s.eff_end;
      END IF;
      EXIT WHEN cursor_t >= w.we;
    END LOOP;

    IF cursor_t < w.we THEN
      INSERT INTO public.booking_slots (date, start_time, end_time, price, label, is_closed)
      VALUES (_date, cursor_t, w.we,
              CASE WHEN public.is_holiday_session(_date, w.ws) THEN 35 ELSE 25 END,
              w.label, false);
      created := created + 1;
    END IF;
  END LOOP;

  RETURN created;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_free_slots_for_date(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_free_slots_for_date(date) TO authenticated, service_role;

-- Restore free time when a booking is shortened, cancelled or deleted.
CREATE OR REPLACE FUNCTION public.regen_slots_after_booking_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sl RECORD;
  win_start time;
  win_end time;
  old_start time;
  old_end time;
  new_start time;
  new_end time;
  shortened boolean := false;
  cancelled boolean := false;
BEGIN
  SELECT * INTO sl FROM public.booking_slots WHERE id = COALESCE(OLD.slot_id, NEW.slot_id);
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    cancelled := (NEW.booking_status = 'cancelled' AND OLD.booking_status <> 'cancelled');

    old_start := COALESCE(OLD.custom_start_time, sl.start_time);
    old_end   := COALESCE(OLD.custom_end_time,   sl.end_time);
    new_start := COALESCE(NEW.custom_start_time, sl.start_time);
    new_end   := COALESCE(NEW.custom_end_time,   sl.end_time);
    shortened := (new_start > old_start) OR (new_end < old_end)
                 OR (OLD.end_date IS NOT NULL AND NEW.end_date IS NULL);

    IF NOT (cancelled OR shortened) THEN
      RETURN NULL;
    END IF;
  END IF;

  -- A cancelled or removed booking should not keep hogging more than the
  -- standard session window its start belongs to.
  IF TG_OP = 'DELETE' OR cancelled THEN
    SELECT v.ws, v.we INTO win_start, win_end FROM (VALUES
      (TIME '02:00', TIME '06:00'),
      (TIME '08:00', TIME '12:00'),
      (TIME '14:00', TIME '18:00'),
      (TIME '20:00', TIME '23:59:59')
    ) AS v(ws, we)
    WHERE sl.start_time >= v.ws AND sl.start_time < v.we
    LIMIT 1;

    IF win_end IS NOT NULL THEN
      UPDATE public.booking_slots
         SET end_time = LEAST(
               CASE WHEN end_time <= start_time THEN TIME '23:59:59' ELSE end_time END,
               win_end)
       WHERE id = sl.id;
    END IF;
  END IF;

  PERFORM public.generate_free_slots_for_date(sl.date);
  IF OLD.end_date IS NOT NULL AND OLD.end_date <> sl.date THEN
    PERFORM public.generate_free_slots_for_date(OLD.end_date);
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_regen_slots_after_booking_change ON public.bookings;
CREATE TRIGGER trg_regen_slots_after_booking_change
AFTER UPDATE OR DELETE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.regen_slots_after_booking_change();