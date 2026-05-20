import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateAll, type BookingWithRelations } from "@/lib/queries";
import { computePaymentStatus, fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithRelations;
}

export function PaymentDialog({ open, onOpenChange, booking }: Props) {
  const invalidate = useInvalidateAll();
  const remaining = Number(booking.remaining_amount);
  const [amount, setAmount] = useState<number>(remaining);
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!amount || amount <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    setSaving(true);
    try {
      const { error: pe } = await supabase.from("payments").insert({
        booking_id: booking.id,
        amount,
        payment_method: method,
        notes: notes || null,
      });
      if (pe) throw pe;

      const newPaid = Number(booking.paid_amount) + amount;
      const total = Number(booking.subtotal) - Number(booking.discount);
      const newRemaining = Math.max(0, total - newPaid);
      const newStatus = computePaymentStatus(newPaid, total);

      const { error: be } = await supabase
        .from("bookings")
        .update({
          paid_amount: newPaid,
          remaining_amount: newRemaining,
          payment_status: newStatus,
        })
        .eq("id", booking.id);
      if (be) throw be;

      await supabase.from("audit_logs").insert({
        booking_id: booking.id,
        action: "payment_recorded",
        details: { amount, method, notes } as any,
      });

      toast.success(`Payment of ${fmtMoney(amount)} recorded`);
      invalidate();
      onOpenChange(false);
      setNotes("");
    } catch (e: any) {
      toast.error(e.message ?? "Could not save payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Remaining balance: <span className="font-medium text-foreground">{fmtMoney(remaining)}</span>
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Amount</Label>
            <Input type="number" min={0} step="0.01" value={amount}
              onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
