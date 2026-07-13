# Overnight / Cross-Midnight Bookings

Support bookings that start in the evening and end after midnight the next calendar day (e.g. 8 PM–4 AM). Everything stays on the existing `bookings` + `booking_slots` model — no new tables.

## 1. Database

New migration:

- `ALTER TABLE public.bookings ADD COLUMN end_date DATE NULL;`
  - `NULL` = same-day booking (current behaviour).
  - Set = booking ends on `end_date` at `custom_end_time` (which is a wall-clock time on `end_date`, not on the start date).
- Rewrite `public.resolve_booking_slot_overlaps` to accept an optional `_end_date DATE` and, when the times imply crossing midnight (`_end <= _start` OR `_end_date > start_date`):
  - Persist `end_date` on the booking.
  - Run the same overlap logic twice — once on the start date for slots in `[_start, 24:00)`, once on `end_date` for slots in `[00:00, _end)`.
  - Same rules as today: full coverage → delete; partial → return `conflicts` with `date` included so the UI can label which day; reject if any overlapping slot is already booked by another customer.
- Rewrite `public.public_book_consecutive_slots` to accept an optional trailing set of next-day slots. Validation:
  - Slots on day N must be contiguous up to `24:00`, slots on day N+1 must start at `00:00` and be contiguous.
  - First slot's `date` becomes booking `date` + `custom_start_time`; last slot's `date` becomes `end_date` + `custom_end_time`.
  - Fold all covered slots into the first slot the same way as today (extend times / delete siblings), but for the next-day tail delete those slots outright since the "anchor" slot lives on day N.

Booked-slot uniqueness (`bookings.slot_id` unique) is unchanged — the booking still anchors to one `booking_slots` row on the start date.

## 2. Server helpers / queries

- `src/lib/queries.ts`: extend `BookingWithRelations` typing with `end_date` (auto via regenerated `types.ts` after migration).
- New helper `src/lib/format.ts → bookingRange(b)`:
  - Returns `{ startDate, startTime, endDate, endTime, crossesMidnight, hours }`.
  - `hours` handles wrap-around: if `crossesMidnight`, `hours = (24 - start) + end`.
- Calendars need to mark next-day early slots as blocked. Add `useOvernightBlocks(dateRange)` that fetches bookings whose `end_date` falls in the visible range and returns, per date, the `[00:00, custom_end_time)` window. Both admin `calendar.tsx` and `public.calendar.tsx` use it.

## 3. Admin `BookingModal`

- Keep existing `start_time` / `end_time` inputs. Auto-detect overnight: when `end_time <= start_time`, show badge "ينتهي في اليوم التالي (<next-date>)" and send `end_date = startDate + 1` to the RPC.
- Overlap-resolution dialog: show each conflict with its date so the admin knows whether it's a start-day or next-day slot ("اليوم" vs "اليوم التالي").
- On save, compute total hours using `bookingRange` for the price/summary strip.

## 4. Calendar & public calendar display

- Admin `src/routes/calendar.tsx`: for each rendered day, overlay a read-only "محجوز من اليوم السابق · حتى HH:MM" band at the top when `useOvernightBlocks` reports a wrap-in. Slots inside that window render as booked (non-clickable).
- Public `src/routes/public.calendar.tsx`:
  - Filter out / grey out early-morning slots that overlap a previous-day booking's `end_date` window with label "محجوز · Reserved".
  - When user picks a trailing slot on day N that hits `24:00`, allow continuing into day N+1's first contiguous slots (checkbox flow already exists — extend the "consecutive" check to accept `prev.end_time = '24:00:00' && next.date = prev.date+1 && next.start_time = '00:00:00'`).

## 5. Invoicing / reporting

- `src/lib/invoice-pdf.ts`: replace single-date row with "Date" + optional "End Date", and use `bookingRange(b).hours` for any duration line.
- `src/routes/reports.tsx` (and any duration math elsewhere): swap manual `end - start` for `bookingRange` so overnight bookings count correctly instead of returning a negative span.

## Technical details

- Slot times stay `TIME WITHOUT TIME ZONE`; `24:00:00` is not a valid Postgres time, so the boundary is represented as "end_date > start_date" rather than a literal 24:00 slot. The RPC synthesises the "up-to-midnight" window internally.
- All changes are additive: existing bookings have `end_date = NULL` and behave exactly as before. No RLS changes; both RPCs remain `SECURITY DEFINER` with the existing role checks and public-booking validation.
- No auth or `_authenticated` route changes.

## Files touched

- New: `supabase/migrations/<ts>_overnight_bookings.sql`
- Edited: `src/components/BookingModal.tsx`, `src/routes/calendar.tsx`, `src/routes/public.calendar.tsx`, `src/routes/reports.tsx`, `src/lib/format.ts`, `src/lib/queries.ts`, `src/lib/invoice-pdf.ts`
- Auto-regenerated: `src/integrations/supabase/types.ts`
