
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='booking_slots' AND policyname='public read slots') THEN
    CREATE POLICY "public read slots" ON public.booking_slots FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bookings' AND policyname='public read bookings existence') THEN
    CREATE POLICY "public read bookings existence" ON public.bookings FOR SELECT TO anon USING (true);
  END IF;
END $$;

GRANT SELECT ON public.booking_slots TO anon;
GRANT SELECT ON public.bookings TO anon;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='booking_slots') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_slots;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bookings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
  END IF;
END $$;
