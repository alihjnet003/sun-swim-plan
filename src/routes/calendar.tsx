import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BookingModal } from "@/components/BookingModal";
import { useBookingsForMonth, useSlotsForMonth, type BookingWithRelations, type Slot } from "@/lib/queries";
import { usePublicHolidays } from "@/hooks/usePublicHolidays";
import { cn } from "@/lib/utils";
import { fmtMoney, slotTimeRange } from "@/lib/format";

export const Route = createFileRoute("/calendar")({ component: CalendarPage });

const statusColor: Record<string, string> = {
  new: "bg-warning/25 text-warning-foreground border-warning/40",
  confirmed: "bg-destructive/15 text-destructive border-destructive/30",
  completed: "bg-info/15 text-info border-info/30",
  cancelled: "bg-muted text-muted-foreground border-border line-through",
};

function dotColor(status: string) {
  switch (status) {
    case "available":
      return "bg-success";
    case "new":
      return "bg-warning";
    case "confirmed":
      return "bg-destructive";
    case "completed":
      return "bg-info";
    default:
      return "bg-muted-foreground";
  }
}

function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const { data: slots = [] } = useSlotsForMonth(y, m);
  const { data: bookings = [] } = useBookingsForMonth(y, m);


  const thisYearHolidays = usePublicHolidays(y);
  const nextYearHolidays = usePublicHolidays(y + 1);
  const holidays = useMemo(() => ({ ...thisYearHolidays, ...nextYearHolidays }), [thisYearHolidays, nextYearHolidays]);

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingWithRelations | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const bookingBySlot = useMemo(() => {
    const map = new Map<string, BookingWithRelations>();
    bookings.forEach((b) => { map.set(b.slot_id, b); });
    return map;
  }, [bookings]);

  const days = useMemo(() => {
    const first = new Date(y, m, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: { date: Date | null }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ date: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(y, m, d) });
    while (cells.length % 7) cells.push({ date: null });
    return cells;
  }, [y, m]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    slots.forEach((s) => { const arr = map.get(s.date) ?? []; arr.push(s); map.set(s.date, arr); });
    return map;
  }, [slots]);

  const toLocalKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayKey = toLocalKey(new Date());

  const selectedDaySlots = selectedDayKey ? slotsByDate.get(selectedDayKey) ?? [] : [];
  const selectedDayHoliday = selectedDayKey ? holidays[selectedDayKey] : undefined;
  const selectedDayLabel = selectedDayKey
    ? new Date(selectedDayKey + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";

  const openSlot = (s: Slot) => {
    const b = bookingBySlot.get(s.id);
    if (b) { setSelectedBooking(b); setSelectedSlot(null); }
    else { setSelectedSlot(s); setSelectedBooking(null); }
    setModalOpen(true);
    setSheetOpen(false);
  };

  return (
    <div className="space-y-4 w-full overflow-x-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Monthly Calendar</h1>
          <p className="text-muted-foreground text-xs sm:text-sm">Click a slot to view or create a booking</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 mx-auto sm:mx-0">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeft className="size-4" /></Button>
          <div className="font-semibold w-32 sm:w-44 text-center text-sm sm:text-base">{cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRight className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground">
        <Legend color="bg-success/30 border-success/40" label="Available" />
        <Legend color="bg-warning/30 border-warning/40" label="Pending" />
        <Legend color="bg-destructive/20 border-destructive/40" label="Booked" />
        <Legend color="bg-info/20 border-info/40" label="Completed" />
        <Legend color="bg-muted border-border" label="Cancelled" />
        <Legend color="bg-amber-500 border-amber-500" label="Holiday" />
      </div>

      <div className="rounded-xl border bg-card overflow-hidden w-full">
        <div className="grid grid-cols-7 text-[10px] sm:text-xs font-medium border-b bg-muted/50">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
            <div key={d} className="px-1 py-2 text-center min-w-0 truncate">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((c, i) => {
            const key = c.date ? toLocalKey(c.date) : undefined;
            const daySlots = key ? slotsByDate.get(key) ?? [] : [];
            const isToday = key === todayKey;
            const holiday = key ? holidays[key] : undefined;

            if (!c.date) {
              return <div key={i} className="min-h-[52px] sm:min-h-[120px] border-r border-b bg-muted/20" />;
            }

            return (
              <div
                key={i}
                onClick={() => { setSelectedDayKey(key!); setSheetOpen(true); }}
                className="min-h-[52px] md:min-h-[120px] min-w-0 overflow-hidden border-r border-b p-1 md:p-1.5 text-xs relative cursor-pointer active:bg-muted/40 md:active:bg-transparent md:cursor-default select-none"
              >
                <div className={cn("flex items-center justify-between mb-1 font-medium gap-1", isToday && "text-primary")}>
                  {holiday ? (
                    <span className="hidden md:inline text-[10px] text-amber-600 dark:text-amber-400 truncate" title={holiday.localName || holiday.name}>
                      {holiday.localName || holiday.name}
                    </span>
                  ) : <span className="hidden md:inline" />}
                  <span className={cn("inline-flex size-5 md:size-6 items-center justify-center rounded-full text-[11px] md:text-xs ml-auto", isToday && "bg-primary text-primary-foreground")}>
                    {c.date.getDate()}
                  </span>
                </div>

                {holiday && (
                  <span className="md:hidden absolute top-1 left-1 size-1.5 rounded-full bg-amber-500" aria-label={holiday.localName || holiday.name} />
                )}

                {/* Desktop: full slot cards */}
                <div className="hidden md:block space-y-1">
                  {daySlots.map((s) => {
                    const b = bookingBySlot.get(s.id);
                    const status = s.is_closed ? "cancelled" : b ? b.booking_status : "available";
                    const klass = status === "available"
                      ? "bg-success/15 text-success border-success/30 hover:bg-success/25"
                      : statusColor[status];
                    return (
                      <button
                        key={s.id}
                        onClick={(e) => { e.stopPropagation(); openSlot(s); }}
                        className={cn("w-full text-left border rounded px-1.5 py-1 transition-colors", klass)}
                      >
                        <div className="font-medium truncate">
                          {slotTimeRange(s.start_time, s.end_time)}
                        </div>
                        {b ? (
                          <div className="truncate opacity-90">{b.customer?.full_name}</div>
                        ) : (
                          <div className="opacity-75 truncate">{s.label ?? "Available"} · {fmtMoney(s.price)}</div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Mobile: dots only */}
                <div className="md:hidden absolute bottom-1 left-0 right-0 flex items-center justify-center gap-0.5">
                  {daySlots.slice(0, 4).map((s) => {
                    const b = bookingBySlot.get(s.id);
                    const status = s.is_closed ? "cancelled" : b ? b.booking_status : "available";
                    return <span key={s.id} className={cn("size-1.5 rounded-full", dotColor(status))} />;
                  })}
                  {daySlots.length > 4 && (
                    <span className="text-[8px] text-muted-foreground leading-none ml-0.5">+{daySlots.length - 4}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <BookingModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        slot={selectedSlot}
        booking={selectedBooking}
      />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedDayLabel}</SheetTitle>
            {selectedDayHoliday && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {selectedDayHoliday.localName || selectedDayHoliday.name}
              </div>
            )}
          </SheetHeader>
          <div className="mt-4">
            {selectedDaySlots.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No slots available for this day
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDaySlots.map((s) => {
                  const b = bookingBySlot.get(s.id);
                  const status = s.is_closed ? "cancelled" : b ? b.booking_status : "available";
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 border rounded-lg p-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{s.label ?? "Slot"}</div>
                        <div className="text-xs text-muted-foreground">
                          {slotTimeRange(s.start_time, s.end_time)}
                        </div>
                        <div className="text-xs text-muted-foreground">{fmtMoney(s.price)}</div>
                        {b?.customer?.full_name && (
                          <div className="text-xs mt-0.5 truncate">{b.customer.full_name}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border", statusColor[status] ?? "bg-success/15 text-success border-success/30")}>
                          <span className={cn("size-1.5 rounded-full", dotColor(status))} />
                          {status}
                        </span>
                        <button
                          onClick={() => openSlot(s)}
                          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg font-medium"
                        >
                          {status === "available" ? "Book" : "View"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("inline-block size-3 rounded border", color)} />
      {label}
    </div>
  );
}
