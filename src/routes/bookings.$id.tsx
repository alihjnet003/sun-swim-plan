import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, Edit, Mail, MessageSquare, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { BookingModal } from "@/components/BookingModal";
import { useBooking, useDeleteBooking } from "@/lib/queries";
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
  const del = useDeleteBooking();
  const [editing, setEditing] = useState(false);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!b) return <div className="p-6">Booking not found.</div>;

  async function sendReminder(channel: "email" | "whatsapp") {
    if (!b || !b.slot) return;
    const msg = `Hello ${b.customer?.full_name ?? ""}, this is a reminder for your swimming pool booking on ${fmtDateLong(b.slot.date)} during ${slotTimeRange(b.slot.start_time, b.slot.end_time)}. Your remaining balance is ${fmtMoney(b.remaining_amount)}. Thank you.`;
    const { error } = await supabase.from("reminders").insert({ booking_id: b.id, channel, status: "sent", message_body: msg });
    if (error) { toast.error(error.message); return; }

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

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to="/bookings" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 mr-1" /> All bookings
      </Link>

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

        <Card title="Payment">
          <Row label="Base price" value={fmtMoney(b.subtotal)} />
          <Row label="Discount" value={fmtMoney(b.discount)} />
          <Row label="Deposit" value={fmtMoney(b.deposit_amount)} />
          <Row label="Paid" value={fmtMoney(b.paid_amount)} />
          <Row label="Remaining" value={fmtMoney(b.remaining_amount)} highlight />
        </Card>

        <Card title="Quick info">
          <Row label="Created" value={new Date(b.created_at).toLocaleString()} />
          <Row label="Updated" value={new Date(b.updated_at).toLocaleString()} />
        </Card>
      </div>

      <BookingModal open={editing} onOpenChange={setEditing} booking={b} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="px-5 py-3 border-b font-semibold text-sm">{title}</header>
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
