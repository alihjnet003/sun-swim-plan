import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Download, Edit, Mail, MessageSquare, Plus, Printer, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { BookingModal } from "@/components/BookingModal";
import { PaymentDialog } from "@/components/PaymentDialog";
import {
  useBooking,
  useDeleteBooking,
  useBookingPayments,
  useBookingAuditLog,
  useBookingReminders,
  useProfilesMap,
} from "@/lib/queries";
import { fmtDateLong, fmtMoney, slotTimeRange } from "@/lib/format";
import { generateInvoicePDF } from "@/lib/invoice-pdf";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/bookings/$id")({ component: BookingDetails });

function BookingDetails() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: b, isLoading } = useBooking(id);
  const { data: payments = [] } = useBookingPayments(id);
  const { data: audit = [] } = useBookingAuditLog(id);
  const { data: reminders = [] } = useBookingReminders(id);
  const { data: profiles } = useProfilesMap();
  const del = useDeleteBooking();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!b) return <div className="p-6">Booking not found.</div>;

  const userName = (uid: string | null | undefined) =>
    uid ? profiles?.get(uid) ?? uid.slice(0, 8) : "—";

  async function sendReminder(channel: "email" | "whatsapp") {
    if (!b || !b.slot) return;
    const msg = `Hello ${b.customer?.full_name ?? ""}, this is a reminder for your swimming pool booking on ${fmtDateLong(b.slot.date)} during ${slotTimeRange(b.slot.start_time, b.slot.end_time)}. Your remaining balance is ${fmtMoney(b.remaining_amount)}. Thank you.`;
    const { error } = await supabase.from("reminders").insert({ booking_id: b.id, channel, status: "sent", message_body: msg });
    if (error) { toast.error(error.message); return; }
    await supabase.from("audit_logs").insert({ booking_id: b.id, action: `reminder_${channel}`, details: { message: msg } as any });

    if (channel === "whatsapp" && b.customer?.whatsapp) {
      const phone = b.customer.whatsapp.replace(/[^0-9]/g, "");
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
    } else if (channel === "email" && b.customer?.email) {
      window.location.href = `mailto:${b.customer.email}?subject=Booking Reminder&body=${encodeURIComponent(msg)}`;
    }
    toast.success(`Reminder logged (${channel})`);
  }

  async function handleDelete() {
    if (!confirm("Cancel this booking?")) return;
    await del.mutateAsync(b!.id);
    toast.success("Booking removed");
    navigate({ to: "/bookings" });
  }

  async function setStatus(newStatus: "confirmed" | "cancelled") {
    if (!b) return;
    const { error } = await supabase.from("bookings").update({ booking_status: newStatus }).eq("id", b.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("audit_logs").insert({
      booking_id: b.id,
      action: newStatus === "confirmed" ? "public_booking_approved" : "public_booking_rejected",
      details: {} as any,
    });
    toast.success(newStatus === "confirmed" ? "Booking approved" : "Booking rejected");
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Link to="/bookings" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 mr-1" /> All bookings
      </Link>

      {b.booking_status === "pending" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <div className="font-medium">Awaiting approval</div>
            <div className="text-muted-foreground text-xs">Submitted from the public booking link.</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setStatus("confirmed")}><Check className="size-4 mr-1.5" />Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setStatus("cancelled")}><X className="size-4 mr-1.5" />Reject</Button>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Booking {b.booking_number}</h1>
          <div className="flex items-center gap-2 mt-2">
            <BookingStatusBadge status={b.booking_status} />
            <PaymentStatusBadge status={b.payment_status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => sendReminder("email")}><Mail className="size-4 mr-1.5" />Email</Button>
          <Button variant="outline" size="sm" onClick={() => sendReminder("whatsapp")}><MessageSquare className="size-4 mr-1.5" />WhatsApp</Button>
          <Button variant="outline" size="sm" onClick={() => generateInvoicePDF(b, "print")}><Printer className="size-4 mr-1.5" />Print</Button>
          <Button variant="outline" size="sm" onClick={() => generateInvoicePDF(b, "save")}><Download className="size-4 mr-1.5" />PDF</Button>
          <Button size="sm" onClick={() => setEditing(true)}><Edit className="size-4 mr-1.5" />Edit</Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}><Trash2 className="size-4 mr-1.5" />Cancel</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card title="Customer">
          <Row label="Name" value={b.customer?.full_name} />
          <Row label="Phone" value={b.customer?.phone} />
          <Row label="WhatsApp" value={b.customer?.whatsapp ?? "—"} />
          <Row label="Email" value={b.customer?.email ?? "—"} />
          {b.customer?.notes && <Row label="Notes" value={b.customer.notes} />}
        </Card>

        <Card title="Booking">
          <Row label="Date" value={b.slot ? fmtDateLong(b.slot.date) : "—"} />
          <Row label="Time slot" value={b.slot ? slotTimeRange(b.slot.start_time, b.slot.end_time) : "—"} />
          <Row label="Guests" value={String(b.people_count)} />
          {b.notes && <Row label="Notes" value={b.notes} />}
        </Card>

        <Card
          title="Payment summary"
          action={
            <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
              <Plus className="size-4 mr-1.5" />Record payment
            </Button>
          }
        >
          <Row label="Base price" value={fmtMoney(b.subtotal)} />
          <Row label="Discount" value={fmtMoney(b.discount)} />
          <Row label="Deposit" value={fmtMoney(b.deposit_amount)} />
          <Row label="Paid" value={fmtMoney(b.paid_amount)} />
          <Row label="Remaining" value={fmtMoney(b.remaining_amount)} highlight />
        </Card>

        <Card title="Activity">
          <Row label="Created" value={new Date(b.created_at).toLocaleString()} />
          <Row label="Created by" value={userName(b.created_by)} />
          <Row label="Last updated" value={new Date(b.updated_at).toLocaleString()} />
          <Row label="Updated by" value={userName(b.updated_by)} />
        </Card>
      </div>

      <Card title={`Payment history (${payments.length})`}>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="text-left">
                <th className="py-2">Date</th>
                <th>Method</th>
                <th>Notes</th>
                <th>By</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">{new Date(p.payment_date).toLocaleString()}</td>
                  <td className="capitalize">{p.payment_method.replace("_", " ")}</td>
                  <td className="text-muted-foreground">{p.notes ?? "—"}</td>
                  <td className="text-muted-foreground">{userName(p.created_by)}</td>
                  <td className={`text-right tabular-nums font-medium ${Number(p.amount) < 0 ? "text-destructive" : ""}`}>
                    {fmtMoney(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Reminders sent (${reminders.length})`}>
        {reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders sent yet.</p>
        ) : (
          <ul className="divide-y">
            {reminders.map((r) => (
              <li key={r.id} className="py-3 flex items-start gap-3">
                {r.channel === "whatsapp" ? <MessageSquare className="size-4 mt-0.5 text-muted-foreground" /> : <Mail className="size-4 mt-0.5 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium capitalize">{r.channel}</span>
                    <span className="text-muted-foreground text-xs">{new Date(r.sent_at).toLocaleString()} · by {userName(r.created_by)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{r.message_body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Audit log (${audit.length})`}>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-l-2 border-primary/40 pl-3">
                <div>
                  <div className="font-medium capitalize">{a.action.replace(/_/g, " ")}</div>
                  <div className="text-xs text-muted-foreground">by {userName(a.created_by)}</div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <BookingModal open={editing} onOpenChange={setEditing} booking={b} />
      <PaymentDialog open={paying} onOpenChange={setPaying} booking={b} />
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="px-5 py-3 border-b font-semibold text-sm flex items-center justify-between">
        <span>{title}</span>
        {action}
      </header>
      <div className="p-5 space-y-2 text-sm">{children}</div>
    </section>
  );
}
function Row({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? "font-semibold text-destructive" : "font-medium"}>{value}</span>
    </div>
  );
}
