-- 1. Public-safe views (owner-executed, expose only non-sensitive columns)
CREATE OR REPLACE VIEW public.public_slots AS
SELECT
  s.id,
  s.date,
  s.start_time,
  s.end_time,
  s.is_closed,
  s.price,
  EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.slot_id = s.id
       AND b.booking_status IN ('new','confirmed','completed')
  ) AS is_booked
FROM public.booking_slots s;

CREATE OR REPLACE VIEW public.public_overnight AS
SELECT b.id, b.end_date, b.custom_end_time AS end_time
FROM public.bookings b
WHERE b.end_date IS NOT NULL;

CREATE OR REPLACE VIEW public.public_settings AS
SELECT a.public_booking_enabled
FROM public.app_settings a
WHERE a.id = 1;

GRANT SELECT ON public.public_slots, public.public_overnight, public.public_settings TO anon, authenticated;

-- 2. Remove blanket anonymous table access
DROP POLICY IF EXISTS "public read bookings existence" ON public.bookings;
DROP POLICY IF EXISTS "public read slots" ON public.booking_slots;
DROP POLICY IF EXISTS "app_settings readable by everyone" ON public.app_settings;

CREATE POLICY "app_settings readable by signed-in users"
  ON public.app_settings FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.bookings FROM anon;
REVOKE ALL ON public.booking_slots FROM anon;
REVOKE ALL ON public.app_settings FROM anon;

-- 3. Lock down SECURITY DEFINER functions from anonymous callers
REVOKE ALL ON FUNCTION public.auto_close_past_slots() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.booking_span(uuid, time, time, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff_or_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_booking_slot_overlaps(uuid, time, time, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_booking_slot_overlaps(uuid, time, time, jsonb, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_book_consecutive_slots(uuid[], text, text, text, text, integer, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.booking_span(uuid, time, time, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_close_past_slots() TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_booking_slot_overlaps(uuid, time, time, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_booking_slot_overlaps(uuid, time, time, jsonb, date) TO authenticated, service_role;
-- the public booking request flow must stay callable from the shared link
GRANT EXECUTE ON FUNCTION public.public_book_consecutive_slots(uuid[], text, text, text, text, integer, text) TO anon, authenticated, service_role;