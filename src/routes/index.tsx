import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, CheckCircle2, CircleDollarSign, Clock, TrendingDown, Wallet, AlertTriangle, Plus } from "lucide-react";
import { useState } from "react";
import { StatCard } from "@/components/StatCard";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { BookingModal } from "@/components/BookingModal";
import { Button } from "@/components/ui/button";
import { useBookingsForMonth, useSlotsForMonth } from "@/lib/queries";
import { fmtDate, fmtMoney, slotTimeRange, todayISO } from "@/lib/format";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/")({ component: Dashboard });

function Dashboard() {
  const { t, lang } = useT();
  const [newOpen, setNewOpen] = useState(false);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const { data: bookings = [] } = useBookingsForMonth(y, m);
  const { data: slots = [] } = useSlotsForMonth(y, m);

  const active = bookings.filter((b) => b.booking_status !== "cancelled");
  const confirmed = active.filter((b) => b.booking_status === "confirmed").length;
  const totalPaid = active.reduce((s, b) => s + Number(b.paid_amount), 0);
  const totalUnpaid = active.reduce((s, b) => s + Number(b.remaining_amount), 0);
  const totalDeposit = active.reduce((s, b) => s + Number(b.deposit_amount), 0);
  const bookedSlotIds = new Set(active.map((b) => b.slot_id));
  const available = slots.filter((s) => !s.is_closed && !bookedSlotIds.has(s.id)).length;

  const today = todayISO();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);
  const upcoming = active
    .filter((b) => b.slot && (b.slot.date === today || b.slot.date === tomorrowISO))
    .sort((a, b) => (a.slot!.date + a.slot!.start_time).localeCompare(b.slot!.date + b.slot!.start_time));

  const latest = bookings.slice(0, 6);
  const monthLabel = now.toLocaleDateString(lang === "ar" ? "ar-BH" : "en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("dashboard.overview")} {monthLabel}</p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="gap-2">
          <Plus className="size-4" /> {t("action.newBooking")}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label={t("stat.totalBookings")} value={active.length} icon={CalendarDays} tone="primary" />
        <StatCard label={t("stat.confirmed")} value={confirmed} icon={CheckCircle2} tone="success" />
        <StatCard label={t("stat.available")} value={available} icon={Clock} tone="info" />
        <StatCard label={t("stat.totalPaid")} value={fmtMoney(totalPaid)} icon={Wallet} tone="success" />
        <StatCard label={t("stat.unpaid")} value={fmtMoney(totalUnpaid)} icon={TrendingDown} tone="destructive" />
        <StatCard label={t("stat.deposits")} value={fmtMoney(totalDeposit)} icon={CircleDollarSign} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 rounded-xl border bg-card">
          <header className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold">{t("dashboard.latest")}</h2>
            <Link to="/bookings" className="text-sm text-primary hover:underline">{t("dashboard.viewAll")}</Link>
          </header>
          <div className="divide-y">
            {latest.length === 0 && <div className="p-6 text-sm text-muted-foreground">{t("dashboard.empty")}</div>}
            {latest.map((b) => (
              <Link key={b.id} to="/bookings/$id" params={{ id: b.id }} className="flex items-center gap-3 p-4 hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {b.customer?.full_name ?? "—"}
                    <span className="text-xs text-muted-foreground">· {b.booking_number}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.slot && `${fmtDate(b.slot.date)} · ${slotTimeRange(b.slot.start_time, b.slot.end_time)}`}
                  </div>
                </div>
                <div className="hidden sm:block text-end">
                  <div className="text-sm tabular-nums font-medium">{fmtMoney(b.subtotal)}</div>
                  <div className="text-xs text-muted-foreground">{t("dashboard.remaining")} {fmtMoney(b.remaining_amount)}</div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <BookingStatusBadge status={b.booking_status} />
                  <PaymentStatusBadge status={b.payment_status} />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-card">
          <header className="px-5 py-4 border-b flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning-foreground" />
            <h2 className="font-semibold">{t("dashboard.todayTomorrow")}</h2>
          </header>
          <div className="divide-y">
            {upcoming.length === 0 && <div className="p-6 text-sm text-muted-foreground">{t("dashboard.nothing")}</div>}
            {upcoming.map((b) => (
              <Link key={b.id} to="/bookings/$id" params={{ id: b.id }} className="block p-4 hover:bg-accent/30">
                <div className="text-sm font-medium">{b.customer?.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {b.slot && `${b.slot.date === today ? t("dashboard.today") : t("dashboard.tomorrow")} · ${slotTimeRange(b.slot.start_time, b.slot.end_time)}`}
                </div>
                {Number(b.remaining_amount) > 0 && (
                  <div className="text-xs text-destructive mt-1">{t("dashboard.owes")} {fmtMoney(b.remaining_amount)}</div>
                )}
              </Link>
            ))}
          </div>
        </section>
      </div>

      <BookingModal open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
