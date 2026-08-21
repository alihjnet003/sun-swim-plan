ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS loyalty_threshold integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS loyalty_discount_percent numeric NOT NULL DEFAULT 25;

CREATE OR REPLACE FUNCTION public.customer_loyalty(_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s RECORD;
  visits integer;
  cycle integer;
BEGIN
  IF NOT public.is_staff_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT loyalty_enabled, loyalty_threshold, loyalty_discount_percent
    INTO s FROM public.app_settings WHERE id = 1;

  SELECT count(*) INTO visits
    FROM public.bookings
   WHERE customer_id = _customer_id
     AND booking_status IN ('new','confirmed','completed');

  cycle := GREATEST(COALESCE(s.loyalty_threshold, 4), 1) + 1;

  RETURN jsonb_build_object(
    'enabled', COALESCE(s.loyalty_enabled, true),
    'visits', visits,
    'threshold', GREATEST(COALESCE(s.loyalty_threshold, 4), 1),
    'discount_percent', COALESCE(s.loyalty_discount_percent, 25),
    'eligible', COALESCE(s.loyalty_enabled, true) AND (visits % cycle) = cycle - 1,
    'until_reward', (cycle - 1) - (visits % cycle)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_loyalty(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_loyalty(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_booking(
  _booking_id uuid,
  _new_date date,
  _start time without time zone,
  _end time without time zone,
  _end_date date DEFAULT NULL,
  _decisions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  b RECORD;
  old_slot_id uuid;
  new_slot_id uuid;
  new_booking_id uuid;
  crosses boolean;
  anchor_end time;
  res jsonb;
  new_num text;
BEGIN
  IF NOT public.is_staff_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;
  old_slot_id := b.slot_id;

  crosses := (_end <= _start) OR (_end_date IS NOT NULL AND _end_date > _new_date);
  anchor_end := CASE WHEN crosses THEN TIME '23:59:59' ELSE _end END;

  -- free the old booking from overlap checks
  UPDATE public.bookings SET booking_status = 'cancelled' WHERE id = _booking_id;

  INSERT INTO public.booking_slots (date, start_time, end_time, price, label)
  VALUES (_new_date, _start, anchor_end, COALESCE(b.subtotal, 0), 'Rescheduled')
  RETURNING id INTO new_slot_id;

  new_num := 'R' || to_char(now(), 'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text, 3, '0');

  INSERT INTO public.bookings (
    booking_number, customer_id, slot_id, booking_status, payment_status,
    subtotal, discount, deposit_amount, paid_amount, remaining_amount,
    people_count, notes, custom_start_time, custom_end_time, end_date, created_by
  ) VALUES (
    new_num, b.customer_id, new_slot_id, b.booking_status, b.payment_status,
    b.subtotal, b.discount, b.deposit_amount, b.paid_amount, b.remaining_amount,
    b.people_count, b.notes, _start, _end,
    CASE WHEN crosses THEN COALESCE(NULLIF(_end_date, _new_date), _new_date + 1) ELSE NULL END,
    COALESCE(b.created_by, auth.uid())
  ) RETURNING id INTO new_booking_id;

  UPDATE public.payments   SET booking_id = new_booking_id WHERE booking_id = _booking_id;
  UPDATE public.reminders  SET booking_id = new_booking_id WHERE booking_id = _booking_id;
  UPDATE public.audit_logs SET booking_id = new_booking_id WHERE booking_id = _booking_id;

  DELETE FROM public.bookings WHERE id = _booking_id;

  -- the old anchor slot becomes free again; drop it if nothing references it
  IF old_slot_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = old_slot_id) THEN
    UPDATE public.booking_slots SET is_closed = false WHERE id = old_slot_id;
  END IF;

  res := public.resolve_booking_slot_overlaps(new_booking_id, _start, _end, COALESCE(_decisions, '{}'::jsonb), _end_date);

  INSERT INTO public.audit_logs (booking_id, action, details)
  VALUES (new_booking_id, 'rescheduled', jsonb_build_object(
    'from_booking_number', b.booking_number,
    'to_date', _new_date, 'start', _start, 'end', _end
  ));

  RETURN COALESCE(res, '{}'::jsonb) || jsonb_build_object('booking_id', new_booking_id, 'booking_number', new_num);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_booking(uuid, date, time without time zone, time without time zone, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid, date, time without time zone, time without time zone, date, jsonb) TO authenticated;