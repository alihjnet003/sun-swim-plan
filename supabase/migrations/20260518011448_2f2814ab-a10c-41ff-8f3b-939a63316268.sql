
-- Enums
CREATE TYPE booking_status AS ENUM ('new','confirmed','completed','cancelled');
CREATE TYPE payment_status AS ENUM ('unpaid','partial','paid');
CREATE TYPE reminder_channel AS ENUM ('email','whatsapp');
CREATE TYPE reminder_status AS ENUM ('sent','pending','failed');

-- Customers
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL,
  whatsapp text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Booking slots (one row per slot per day)
CREATE TABLE public.booking_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  price numeric(10,2) NOT NULL DEFAULT 0,
  label text,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, start_time, end_time)
);
CREATE INDEX idx_slots_date ON public.booking_slots(date);

-- Bookings
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL REFERENCES public.booking_slots(id) ON DELETE RESTRICT,
  booking_status booking_status NOT NULL DEFAULT 'new',
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  discount numeric(10,2) NOT NULL DEFAULT 0,
  deposit_amount numeric(10,2) NOT NULL DEFAULT 0,
  paid_amount numeric(10,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(10,2) NOT NULL DEFAULT 0,
  people_count int NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id)
);
CREATE INDEX idx_bookings_customer ON public.bookings(customer_id);
CREATE INDEX idx_bookings_status ON public.bookings(booking_status);

-- Payments
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  payment_date timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- Reminders
CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  channel reminder_channel NOT NULL,
  status reminder_status NOT NULL DEFAULT 'sent',
  message_body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- Audit logs
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  action text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-update bookings.updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER bookings_touch BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enable RLS, allow open access (admin demo)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','booking_slots','bookings','payments','reminders','audit_logs']
  LOOP
    EXECUTE format('CREATE POLICY "open_all" ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
