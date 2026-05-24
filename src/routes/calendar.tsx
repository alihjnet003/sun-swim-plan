import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingModal } from "@/components/BookingModal";
import { useBookingsForMonth, useSlotsForMonth, type BookingWithRelations, type Slot } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { fmtMoney, slotTimeRange } from "@/lib/format";

export const Route = createFileRoute("/calendar")({ component: CalendarPage });

const statusColor: Record<string, string> = {
  new: "bg-warning/25 text-warning-foreground border-warning/40",
  confirmed: "bg-destructive/15 text-destructive border-destructive/30",
  completed: "bg-info/15 text-info border-info/30",
  cancelled: "bg-muted text-muted-foreground border-border line-through",
};

function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const { data: slots = [] } = useSlotsForMonth(y, m);
  const { data: bookings = [] } = useBookingsForMonth(y, m);

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingWithRelations | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const bookingBySlot = useMemo(() => {
    const map = new Map<string, BookingWithRelations>();
    bookings.forEach((b) => { if (b.booking_status !== "cancelled" || true) map.set(b.slot_id, b); });
    return map;
  }, [bookings]);

  const days = useMemo(() => {
    const first = new Date(y, m, 1);
    const startOffset = first.getDay(); // 0=Sun
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
      </div>

      <div className="rounded-xl border bg-card overflow-hidden w-full">
        <div className="grid grid-cols-7 text-[10px] sm:text-xs font-medium border-b bg-muted/50">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
            <div key={d} className="px-1 py-2 text-center min-w-0 truncate"><span className="sm:hidden">{d[0]}</span><span className="hidden sm:inline">{d}</span></div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((c, i) => {
            const key = c.date?.toISOString().slice(0, 10);
            const daySlots = key ? slotsByDate.get(key) ?? [] : [];
            const isToday = key === todayKey;
            return (
              <div key={i} className={cn("min-h-[60px] sm:min-h-[120px] min-w-0 overflow-hidden border-r border-b p-1 sm:p-1.5 text-[10px] sm:text-xs", !c.date && "bg-muted/20")}>
                {c.date && (
                  <>
                    <div className={cn("flex justify-end mb-1 font-medium", isToday && "text-primary")}>
                      <span className={cn("inline-flex size-5 sm:size-6 items-center justify-center rounded-full text-[10px] sm:text-xs", isToday && "bg-primary text-primary-foreground")}>
                        {c.date.getDate()}
                      </span>
                    </div>
                    {/* Mobile: compact dot indicators. Desktop: full slot buttons. */}
                    <div className="sm:hidden flex flex-wrap gap-0.5 justify-center">
                      {daySlots.slice(0, 6).map((s) => {
                        const b = bookingBySlot.get(s.id);
                        const status = s.is_closed ? "cancelled" : b ? b.booking_status : "available";
                        const dotClass = status === "available" ? "bg-success"
                          : status === "new" ? "bg-warning"
                          : status === "confirmed" ? "bg-destructive"
                          : status === "completed" ? "bg-info"
                          : "bg-muted-foreground";
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              if (b) { setSelectedBooking(b); setSelectedSlot(null); }
                              else { setSelectedSlot(s); setSelectedBooking(null); }
                              setModalOpen(true);
                            }}
                            className={cn("size-1.5 rounded-full", dotClass)}
                            aria-label={slotTimeRange(s.start_time, s.end_time)}
                          />
                        );
                      })}
                    </div>
                    <div className="hidden sm:block space-y-1">
                      {daySlots.map((s) => {
                        const b = bookingBySlot.get(s.id);
                        const status = s.is_closed ? "cancelled" : b ? (b.booking_status === "new" ? "new" : b.booking_status) : "available";
                        const klass = status === "available"
                          ? "bg-success/15 text-success border-success/30 hover:bg-success/25"
                          : statusColor[status];
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              if (b) { setSelectedBooking(b); setSelectedSlot(null); }
                              else { setSelectedSlot(s); setSelectedBooking(null); }
                              setModalOpen(true);
                            }}
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
                  </>
                )}
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
