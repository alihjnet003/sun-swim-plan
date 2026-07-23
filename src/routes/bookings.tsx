import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { useAllBookings, useInvalidateAll, useProfilesMap } from "@/lib/queries";
import { fmtDate, fmtMoney, slotTimeRange } from "@/lib/format";
import { generateInvoicePDF } from "@/lib/invoice-pdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/bookings")({ component: BookingsList });

function BookingsList() {
  const { data: bookings = [], isLoading } = useAllBookings();
  const { data: profiles } = useProfilesMap();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");
  const [publicEnabled, setPublicEnabled] = useState<boolean | null>(null);
  const [savingSetting, setSavingSetting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  async function decide(e: React.MouseEvent, id: string, next: "confirmed" | "cancelled") {
    e.preventDefault();
    e.stopPropagation();
    setActingId(id);
    const { error } = await supabase.from("bookings").update({ booking_status: next }).eq("id", id);
    if (!error) {
      await supabase.from("audit_logs").insert({
        booking_id: id,
        action: next === "confirmed" ? "public_booking_approved" : "public_booking_rejected",
        details: {} as any,
      });
    }
    setActingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(next === "confirmed" ? "Booking approved" : "Booking rejected");
    invalidate();
  }

  useEffect(() => {
    supabase.from("app_settings").select("public_booking_enabled").eq("id", 1).maybeSingle()
      .then(({ data }) => setPublicEnabled(data?.public_booking_enabled ?? true));
  }, []);

  async function togglePublicBooking(next: boolean) {
    setSavingSetting(true);
    const prev = publicEnabled;
    setPublicEnabled(next);
    const { error } = await supabase.from("app_settings").update({ public_booking_enabled: next, updated_at: new Date().toISOString() }).eq("id", 1);
    setSavingSetting(false);
    if (error) {
      setPublicEnabled(prev);
      toast.error(error.message);
    } else {
      toast.success(next ? "Public booking enabled" : "Public booking disabled");
    }
  }

  const pendingCount = bookings.filter((b) => b.booking_status === "pending").length;

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Bookings</h1>
          <p className="text-muted-foreground text-sm">All reservations across all months</p>
        </div>
        {isAdmin && publicEnabled !== null && (
          <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2">
            <Switch
              id="public-booking-toggle"
              checked={publicEnabled}
              onCheckedChange={togglePublicBooking}
              disabled={savingSetting}
            />
            <Label htmlFor="public-booking-toggle" className="text-sm cursor-pointer">
              Public booking link
              <span className="block text-xs text-muted-foreground">
                {publicEnabled ? "Enabled — customers can book online" : "Disabled — link is read-only"}
              </span>
            </Label>
          </div>
        )}
      </div>

      {pendingCount > 0 && (
        <button
          onClick={() => setStatus("pending")}
          className="w-full text-left rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm hover:bg-amber-500/15 transition"
        >
          <span className="font-medium">{pendingCount}</span> booking{pendingCount === 1 ? "" : "s"} awaiting approval from the public link — click to review.
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by customer, phone, booking #" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending approval</SelectItem>
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
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No bookings match your filters.</td></tr>}
              {filtered.map((b) => (
                <tr
                  key={b.id}
                  className="hover:bg-accent/30 cursor-pointer"
                  onClick={() => navigate({ to: "/bookings/$id", params: { id: b.id } })}
                >
                  <td className="px-4 py-3">
                    <Link to="/bookings/$id" params={{ id: b.id }} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{b.booking_number}</Link>
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
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {b.booking_status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 px-2"
                            disabled={actingId === b.id}
                            onClick={(e) => decide(e, b.id, "confirmed")}
                            title="Approve"
                          >
                            <Check className="size-4" />
                            <span className="hidden sm:inline ml-1">Approve</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            disabled={actingId === b.id}
                            onClick={(e) => decide(e, b.id, "cancelled")}
                            title="Reject"
                          >
                            <X className="size-4" />
                            <span className="hidden sm:inline ml-1">Reject</span>
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Download invoice PDF"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); generateInvoicePDF(b, "save"); }}
                      >
                        <Download className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="View details"
                        onClick={(e) => { e.stopPropagation(); navigate({ to: "/bookings/$id", params: { id: b.id } }); }}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
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
