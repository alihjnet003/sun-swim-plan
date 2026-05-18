import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAllBookings } from "@/lib/queries";
import { fmtMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export const Route = createFileRoute("/reports")({ component: Reports });

function Reports() {
  const { data: bookings = [] } = useAllBookings();

  const stats = useMemo(() => {
    const byMonth = new Map<string, number>();
    const byStatus = new Map<string, number>();
    const byDate = new Map<string, number>();
    let unpaid = 0, deposits = 0;
    bookings.forEach((b) => {
      if (!b.slot) return;
      const month = b.slot.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + Number(b.paid_amount));
      byStatus.set(b.booking_status, (byStatus.get(b.booking_status) ?? 0) + 1);
      byDate.set(b.slot.date, (byDate.get(b.slot.date) ?? 0) + 1);
      unpaid += Number(b.remaining_amount);
      deposits += Number(b.deposit_amount);
    });
    const topDays = [...byDate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { byMonth: [...byMonth.entries()].sort(), byStatus: [...byStatus.entries()], topDays, unpaid, deposits };
  }, [bookings]);

  function exportCSV() {
    const rows = [["booking_number", "customer", "date", "status", "payment", "total", "paid", "remaining"]];
    bookings.forEach((b) => rows.push([
      b.booking_number, b.customer?.full_name ?? "", b.slot?.date ?? "",
      b.booking_status, b.payment_status,
      String(b.subtotal), String(b.paid_amount), String(b.remaining_amount),
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "bookings.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground text-sm">Revenue, balances and booking activity</p>
        </div>
        <Button onClick={exportCSV} variant="outline"><Download className="size-4 mr-2" />Export CSV</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel title="Monthly revenue (paid)">
          <Table rows={stats.byMonth.map(([m, v]) => [m, fmtMoney(v)])} cols={["Month", "Paid"]} />
        </Panel>
        <Panel title="Bookings by status">
          <Table rows={stats.byStatus.map(([s, n]) => [s, String(n)])} cols={["Status", "Count"]} />
        </Panel>
        <Panel title="Top booked days">
          <Table rows={stats.topDays.map(([d, n]) => [d, String(n)])} cols={["Date", "Bookings"]} />
        </Panel>
        <Panel title="Outstanding balances">
          <div className="p-5 grid grid-cols-2 gap-4">
            <Metric label="Unpaid total" value={fmtMoney(stats.unpaid)} />
            <Metric label="Deposits collected" value={fmtMoney(stats.deposits)} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="px-5 py-3 border-b font-semibold text-sm">{title}</header>
      {children}
    </section>
  );
}
function Table({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr>{cols.map((c) => <th key={c} className="text-left px-5 py-2">{c}</th>)}</tr>
      </thead>
      <tbody className="divide-y">
        {rows.length === 0 && <tr><td colSpan={cols.length} className="px-5 py-4 text-muted-foreground">No data.</td></tr>}
        {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-5 py-2 capitalize">{c}</td>)}</tr>)}
      </tbody>
    </table>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold">{value}</div></div>;
}
