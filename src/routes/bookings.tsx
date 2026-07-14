import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { useAllBookings, useProfilesMap } from "@/lib/queries";
import { fmtDate, fmtMoney, slotTimeRange } from "@/lib/format";
import { generateInvoicePDF } from "@/lib/invoice-pdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/bookings")({ component: BookingsList });

function BookingsList() {
  const { data: bookings = [], isLoading } = useAllBookings();
  const { data: profiles } = useProfilesMap();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      if (status !== "all" && b.booking_status !== status) return false;
      if (payment !== "all" && b.payment_status !== payment) return false;
      if (q) {
        const hay = `${b.customer?.full_name ?? ""} ${b.customer?.phone ?? ""} ${b.booking_number}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [bookings, q, status, payment]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Bookings</h1>
        <p className="text-muted-foreground text-sm">All reservations across all months</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by customer, phone, booking #" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={payment} onValueChange={setPayment}>
          <SelectTrigger><SelectValue placeholder="Payment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Booking</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">Date / Slot</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Remaining</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Payment</th>
                <th className="text-left px-4 py-3">Created by</th>
                <th className="text-right px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No bookings match your filters.</td></tr>}
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-accent/30">
                  <td className="px-4 py-3">
                    <Link to="/bookings/$id" params={{ id: b.id }} className="font-medium text-primary hover:underline">{b.booking_number}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{b.customer?.full_name}</div>
                    <div className="text-xs text-muted-foreground">{b.customer?.phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    {b.slot && <>
                      <div>{fmtDate(b.slot.date)}</div>
                      <div className="text-xs text-muted-foreground">{slotTimeRange(b.slot.start_time, b.slot.end_time)}</div>
                    </>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(b.subtotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(b.remaining_amount)}</td>
                  <td className="px-4 py-3"><BookingStatusBadge status={b.booking_status} /></td>
                  <td className="px-4 py-3"><PaymentStatusBadge status={b.payment_status} /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {b.created_by ? profiles?.get(b.created_by) ?? "—" : "—"}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Download invoice PDF"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); generateInvoicePDF(b, "save"); }}
                    >
                      <Download className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
