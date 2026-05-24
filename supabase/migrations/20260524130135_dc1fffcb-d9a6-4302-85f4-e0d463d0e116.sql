
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_slot_id_fkey;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_slot_id_fkey
  FOREIGN KEY (slot_id) REFERENCES public.booking_slots(id) ON DELETE CASCADE;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_booking_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;

ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS reminders_booking_id_fkey;
ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_booking_id_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;
