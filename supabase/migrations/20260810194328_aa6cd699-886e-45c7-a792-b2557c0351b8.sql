DROP VIEW IF EXISTS public.public_slots;
DROP VIEW IF EXISTS public.public_overnight;
DROP VIEW IF EXISTS public.public_settings;

-- Sessions: only non-sensitive columns readable anonymously
GRANT SELECT (id, date, start_time, end_time, is_closed, price) ON public.booking_slots TO anon;
CREATE POLICY "public read slot availability"
  ON public.booking_slots FOR SELECT TO anon USING (true);

-- Bookings: only availability-related columns readable anonymously
GRANT SELECT (id, slot_id, booking_status, end_date, custom_start_time, custom_end_time)
  ON public.bookings TO anon;
CREATE POLICY "public read booking availability"
  ON public.bookings FOR SELECT TO anon USING (true);

-- Settings: only the public booking switch
GRANT SELECT (id, public_booking_enabled) ON public.app_settings TO anon;
CREATE POLICY "public read booking switch"
  ON public.app_settings FOR SELECT TO anon USING (true);