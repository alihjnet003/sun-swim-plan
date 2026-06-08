import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { usePublicHolidays } from "@/hooks/usePublicHolidays";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/public/calendar")({
  component: PublicCalendarPage,
  head: () => ({
    meta: [
      { title: "The Private Pool — التقويم العام" },
      { name: "description", content: "تقويم توفر الجلسات في The Private Pool" },
    ],
  }),
});

interface PublicSlot {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  is_closed: boolean;
  bookings: { id: string }[] | null;
}

type Status = "available" | "booked" | "closed";

function statusOf(s: PublicSlot): Status {
  if (s.is_closed) return "closed";
  if (s.bookings && s.bookings.length > 0) return "booked";
  return "available";
}

function statusLabel(st: Status) {
  if (st === "available") return "متاح ✅";
  if (st === "booked") return "محجوز 🔴";
  return "مغلق ⚫";
}

function dotClass(st: Status) {
  if (st === "available") return "bg-success";
  if (st === "booked") return "bg-destructive";
  return "bg-muted-foreground";
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function toKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function sessionLabel(start: string) {
  const h = parseInt(start.split(":")[0], 10);
  if (h >= 20 || h < 8) return "الجلسة الليلية";
  if (h < 12) return "الجلسة الصباحية";
  if (h < 18) return "الجلسة المسائية";
  return "جلسة المساء";
}

function PublicCalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = toKey(new Date(y, m, 1));
  const last = toKey(new Date(y, m + 1, 0));
  const holidays = usePublicHolidays(y);

  const { data: slots = [], refetch } = useQuery({
    queryKey: ["public-slots", first, last],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_slots")
        .select("id, date, start_time, end_time, is_closed, bookings(id)")
        .gte("date", first)
        .lte("date", last)
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as unknown as PublicSlot[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("public-calendar")
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_slots" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  const byDate = useMemo(() => {
    const map: Record<string, PublicSlot[]> = {};
    slots.forEach((s) => { (map[s.date] ||= []).push(s); });
    return map;
  }, [slots]);

  const cells = useMemo(() => {
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const arr: (Date | null)[] = [];
    for (let i = 0; i < firstDow; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(y, m, d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [y, m]);

  const todayKey = toKey(new Date());
  const selectedSlots = selectedDay ? (byDate[selectedDay] ?? []) : [];

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        <header className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold">The Private Pool 🏊</h1>
          <p className="text-muted-foreground text-sm">استراحة خاصة — التقويم العام</p>
        </header>

        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronRight className="size-4" /></Button>
          <div className="font-semibold w-40 text-center text-sm sm:text-base">
            {cursor.toLocaleDateString("ar", { month: "long", year: "numeric" })}
          </div>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronLeft className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>اليوم</Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-success" /> متاح</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-destructive" /> محجوز</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-muted-foreground" /> مغلق</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-amber-500" /> عطلة</span>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
          {["أحد","إثن","ثلا","أرب","خمي","جمع","سبت"].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="aspect-square" />;
            const key = toKey(d);
            const daySlots = byDate[key] ?? [];
            const holiday = holidays[key];
            const isToday = key === todayKey;
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(key)}
                className={cn(
                  "aspect-square rounded-md border bg-card hover:bg-accent transition p-1 flex flex-col",
                  isToday && "border-primary",
                )}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className={cn("font-medium", isToday && "text-primary")}>{d.getDate()}</span>
                  {holiday && <span className="size-1.5 rounded-full bg-amber-500" />}
                </div>
                <div className="mt-auto flex flex-wrap gap-0.5 justify-center">
                  {daySlots.slice(0, 4).map((s) => (
                    <span key={s.id} className={cn("inline-block size-1.5 rounded-full", dotClass(statusOf(s)))} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <footer className="pt-4 text-center space-y-2 border-t">
          <p className="text-sm text-muted-foreground">للحجز تواصل معنا على واتساب</p>
          <Button asChild className="bg-green-600 hover:bg-green-700 text-white">
            <a href="https://wa.me/97333338208" target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" /> واتساب
            </a>
          </Button>
        </footer>
      </div>

      <Sheet open={!!selectedDay} onOpenChange={(o) => !o && setSelectedDay(null)}>
        <SheetContent side="bottom" dir="rtl">
          <SheetHeader>
            <SheetTitle>
              {selectedDay && new Date(selectedDay).toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-2 mt-4">
            {selectedDay && holidays[selectedDay] && (
              <div className="rounded-md border bg-amber-500/10 border-amber-500/30 px-3 py-2 text-sm">
                🟡 {holidays[selectedDay].localName}
              </div>
            )}
            {selectedSlots.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-4">لا توجد جلسات في هذا اليوم</p>
            )}
            {selectedSlots.map((s) => {
              const st = statusOf(s);
              return (
                <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-block size-2 rounded-full", dotClass(st))} />
                    <span>{sessionLabel(s.start_time)}</span>
                    <span className="text-muted-foreground text-xs">{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</span>
                  </div>
                  <span>{statusLabel(st)}</span>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
