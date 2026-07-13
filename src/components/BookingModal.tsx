import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAvailableSlots, useCustomers, useInvalidateAll, type BookingWithRelations, type Slot } from "@/lib/queries";
import { computePaymentStatus, fmtDate, fmtMoney, generateBookingNumber, slotTimeRange, bookingRange, nextDay } from "@/lib/format";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot?: Slot | null;
  booking?: BookingWithRelations | null;
}

// Normalise DB time (HH:MM:SS or HH:MM) → HH:MM for <input type="time">
const toHM = (t?: string | null) => (t ? t.slice(0, 5) : "");
// Normalise HH:MM → HH:MM:00 for Postgres time
const toDbTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

type Conflict = { slot_id: string; start_time: string; end_time: string; coverage: string };

export function BookingModal({ open, onOpenChange, slot, booking }: Props) {
  const { data: customers = [] } = useCustomers();
  const { data: availableSlots = [] } = useAvailableSlots(booking?.slot_id);
  const invalidate = useInvalidateAll();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    customer_id: "",
    new_customer: false,
    full_name: "",
    phone: "",
    whatsapp: "",
    email: "",
    customer_notes: "",
    slot_id: "",
    start_time: "",
    end_time: "",
    booking_status: "new" as "new" | "confirmed" | "completed" | "cancelled",
    subtotal: 0,
    discount: 0,
    deposit_amount: 0,
    paid_amount: 0,
    people_count: 1,
    notes: "",
  });

  // Overlap-resolution dialog state
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "delete" | "shrink">>({});
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);

  useEffect(() => {
    if (booking) {
      setForm({
        customer_id: booking.customer_id,
        new_customer: false,
        full_name: "",
        phone: "",
        whatsapp: "",
        email: "",
        customer_notes: "",
        slot_id: booking.slot_id,
        start_time: toHM(booking.custom_start_time ?? booking.slot?.start_time),
        end_time: toHM(booking.custom_end_time ?? booking.slot?.end_time),
        booking_status: booking.booking_status,
        subtotal: Number(booking.subtotal),
        discount: Number(booking.discount),
        deposit_amount: Number(booking.deposit_amount),
        paid_amount: Number(booking.paid_amount),
        people_count: booking.people_count,
        notes: booking.notes ?? "",
      });
    } else if (slot) {
      setForm((f) => ({
        ...f,
        slot_id: slot.id,
        start_time: toHM(slot.start_time),
        end_time: toHM(slot.end_time),
        subtotal: Number(slot.price),
        customer_id: "",
        new_customer: customers.length === 0,
      }));
    }
  }, [booking, slot, customers.length, open]);

  const total = form.subtotal - form.discount;
  const remaining = Math.max(0, total - form.paid_amount);
  const paymentStatus = computePaymentStatus(form.paid_amount, total);

  const targetSlot =
    availableSlots.find((s) => s.id === form.slot_id) ?? booking?.slot ?? slot ?? null;

  // Called when times differ from the underlying slot; resolves overlaps via RPC.
  async function applyTimeExtension(bookingId: string, extraDecisions?: Record<string, "delete" | "shrink">) {
    const { data, error } = await supabase.rpc("resolve_booking_slot_overlaps", {
      _booking_id: bookingId,
      _start: toDbTime(form.start_time),
      _end: toDbTime(form.end_time),
      _decisions: (extraDecisions ?? {}) as any,
    });
    if (error) throw error;
    const res = data as { ok?: boolean; conflicts?: Conflict[] };
    if (res?.conflicts && res.conflicts.length > 0) {
      const init: Record<string, "delete" | "shrink"> = {};
      res.conflicts.forEach((c) => { init[c.slot_id] = "shrink"; });
      setDecisions(init);
      setConflicts(res.conflicts);
      setPendingBookingId(bookingId);
      return false;
    }
    return true;
  }

  async function handleSave() {
    if (!targetSlot) return;
    if (!form.start_time || !form.end_time || form.end_time <= form.start_time) {
      toast.error("End time must be after start time");
      return;
    }
    setSaving(true);
    try {
      let customerId = form.customer_id;

      if (form.new_customer) {
        if (!form.full_name || !form.phone) {
          toast.error("Customer name and phone are required");
          setSaving(false);
          return;
        }
        const { data: c, error: ce } = await supabase
          .from("customers")
          .insert({
            full_name: form.full_name,
            phone: form.phone,
            whatsapp: form.whatsapp || null,
            email: form.email || null,
            notes: form.customer_notes || null,
          })
          .select()
          .single();
        if (ce) throw ce;
        customerId = c.id;
      }

      if (!customerId) {
        toast.error("Select or create a customer");
        setSaving(false);
        return;
      }

      const payload = {
        customer_id: customerId,
        slot_id: targetSlot.id,
        booking_status: form.booking_status,
        payment_status: paymentStatus,
        subtotal: form.subtotal,
        discount: form.discount,
        deposit_amount: form.deposit_amount,
        paid_amount: form.paid_amount,
        remaining_amount: remaining,
        people_count: form.people_count,
        notes: form.notes || null,
      };

      const slotStart = toHM(targetSlot.start_time);
      const slotEnd = toHM(targetSlot.end_time);
      const timesChanged = form.start_time !== slotStart || form.end_time !== slotEnd;

      let bookingId: string;

      if (booking) {
        const prevPaid = Number(booking.paid_amount);
        const { error } = await supabase.from("bookings").update(payload).eq("id", booking.id);
        if (error) throw error;
        bookingId = booking.id;
        await supabase.from("audit_logs").insert({ booking_id: booking.id, action: "updated", details: payload as any });
        if (form.paid_amount !== prevPaid) {
          const delta = form.paid_amount - prevPaid;
          await supabase.from("payments").insert({
            booking_id: booking.id,
            amount: delta,
            payment_method: "adjustment",
            notes: `Paid amount changed from ${prevPaid.toFixed(2)} to ${form.paid_amount.toFixed(2)}`,
          });
        }
      } else {
        const { data, error } = await supabase
          .from("bookings")
          .insert({ ...payload, booking_number: generateBookingNumber() })
          .select()
          .single();
        if (error) {
          if (error.code === "23505") toast.error("This slot is already booked");
          else throw error;
          setSaving(false);
          return;
        }
        bookingId = data.id;
        await supabase.from("audit_logs").insert({ booking_id: data.id, action: "created", details: payload as any });
        if (form.paid_amount > 0) {
          await supabase.from("payments").insert({
            booking_id: data.id,
            amount: form.paid_amount,
            payment_method: "cash",
            notes: "Initial payment",
          });
        }
      }

      if (timesChanged) {
        const done = await applyTimeExtension(bookingId);
        if (!done) {
          // Conflict dialog is now open; keep modal open until resolved.
          setSaving(false);
          return;
        }
      }

      toast.success(booking ? "Booking updated" : "Booking created");
      invalidate();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function resolveConflicts() {
    if (!pendingBookingId) return;
    setSaving(true);
    try {
      const done = await applyTimeExtension(pendingBookingId, decisions);
      if (done) {
        toast.success("Booking updated");
        setConflicts(null);
        setPendingBookingId(null);
        invalidate();
        onOpenChange(false);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Failed to resolve overlaps");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{booking ? `Edit Booking · ${booking.booking_number}` : "New Booking"}</DialogTitle>
          {targetSlot && (
            <p className="text-sm text-muted-foreground">
              {fmtDate(targetSlot.date)} · {slotTimeRange(targetSlot.start_time, targetSlot.end_time)}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-5">
          {/* Customer */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Customer</h3>
              {!booking && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setForm((f) => ({ ...f, new_customer: !f.new_customer }))}
                >
                  {form.new_customer ? "Pick existing" : "+ New customer"}
                </button>
              )}
            </div>
            {form.new_customer ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Full name *</Label>
                  <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div>
                  <Label>Phone *</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <Label>WhatsApp</Label>
                  <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Notes</Label>
                  <Textarea rows={2} value={form.customer_notes} onChange={(e) => setForm({ ...form, customer_notes: e.target.value })} />
                </div>
              </div>
            ) : (
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })} disabled={!!booking}>
                <SelectTrigger><SelectValue placeholder="Choose customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name} · {c.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          {/* Booking */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Booking</h3>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label>Slot (date &amp; time)</Label>
                <Select value={form.slot_id} onValueChange={(v) => {
                  const s = availableSlots.find((x) => x.id === v);
                  setForm((f) => ({
                    ...f,
                    slot_id: v,
                    subtotal: s ? Number(s.price) : f.subtotal,
                    start_time: s ? toHM(s.start_time) : f.start_time,
                    end_time: s ? toHM(s.end_time) : f.end_time,
                  }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Choose a slot" /></SelectTrigger>
                  <SelectContent>
                    {availableSlots.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {fmtDate(s.date)} · {slotTimeRange(s.start_time, s.end_time)} · {fmtMoney(s.price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start time</Label>
                  <Input type="time" value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div>
                  <Label>End time</Label>
                  <Input type="time" value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Extending the times will automatically adjust or remove other slots on the same day.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>People</Label>
                  <Input type="number" min={1} value={form.people_count}
                    onChange={(e) => setForm({ ...form, people_count: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.booking_status} onValueChange={(v: any) => setForm({ ...form, booking_status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </section>

          {/* Money */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Payment</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label>Base price</Label>
                <Input type="number" min={0} step="0.01" value={form.subtotal}
                  onChange={(e) => setForm({ ...form, subtotal: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Discount</Label>
                <Input type="number" min={0} step="0.01" value={form.discount}
                  onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Deposit</Label>
                <Input type="number" min={0} step="0.01" value={form.deposit_amount}
                  onChange={(e) => setForm({ ...form, deposit_amount: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Paid</Label>
                <Input type="number" min={0} step="0.01" value={form.paid_amount}
                  onChange={(e) => setForm({ ...form, paid_amount: Number(e.target.value) })} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground text-xs">Total</div>
                <div className="font-semibold">{fmtMoney(total)}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground text-xs">Remaining</div>
                <div className="font-semibold">{fmtMoney(remaining)}</div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground text-xs">Payment status</div>
                <div className="font-semibold capitalize">{paymentStatus}</div>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
            {booking ? "Save changes" : "Confirm booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Overlap resolution dialog */}
    <Dialog open={!!conflicts} onOpenChange={(o) => { if (!o) { setConflicts(null); setPendingBookingId(null); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Overlapping slots</DialogTitle>
          <p className="text-sm text-muted-foreground">
            The new booking time overlaps these existing slots. Choose what to do with each.
          </p>
        </DialogHeader>
        <div className="space-y-3">
          {conflicts?.map((c) => (
            <div key={c.slot_id} className="rounded-md border p-3">
              <div className="text-sm font-medium mb-2">
                Slot {c.start_time} – {c.end_time}
              </div>
              <RadioGroup
                value={decisions[c.slot_id] ?? "shrink"}
                onValueChange={(v) => setDecisions((d) => ({ ...d, [c.slot_id]: v as "delete" | "shrink" }))}
                className="flex gap-4"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="shrink" id={`shrink-${c.slot_id}`} />
                  Shrink (keep leftover time)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="delete" id={`delete-${c.slot_id}`} />
                  Delete slot
                </label>
              </RadioGroup>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setConflicts(null); setPendingBookingId(null); }} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={resolveConflicts} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
