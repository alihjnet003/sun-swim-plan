import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateAll, type BookingWithRelations } from "@/lib/queries";
import { fmtDate, nextDay } from "@/lib/format";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Conflict = { slot_id: string; date?: string; start_time: string; end_time: string; coverage: string };

const toHM = (t?: string | null) => (t ? t.slice(0, 5) : "");
const toDbTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingWithRelations;
  onRescheduled?: (newBookingId: string) => void;
}

export function RescheduleDialog({ open, onOpenChange, booking, onRescheduled }: Props) {
  const invalidate = useInvalidateAll();
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "delete" | "shrink">>({});
  const [newBookingId, setNewBookingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(booking.slot?.date ?? "");
    setStart(toHM(booking.custom_start_time ?? booking.slot?.start_time));
    setEnd(toHM(booking.custom_end_time ?? booking.slot?.end_time));
    setConflicts(null);
    setDecisions({});
    setNewBookingId(null);
  }, [open, booking]);

  const isOvernight = !!(start && end && end <= start);
  const endDateIso = isOvernight && date ? nextDay(date) : null;

  function finish(id: string | null) {
    invalidate();
    toast.success("تم تغيير الحجز — Booking rescheduled");
    setConflicts(null);
    onOpenChange(false);
    if (id) onRescheduled?.(id);
  }

  async function submit() {
    if (!date || !start || !end) {
      toast.error("التاريخ ووقت البداية والنهاية مطلوبة");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("reschedule_booking", {
        _booking_id: booking.id,
        _new_date: date,
        _start: toDbTime(start),
        _end: toDbTime(end),
        _end_date: endDateIso,
        _decisions: {} as any,
      } as any);
      if (error) throw error;
      const res = data as { booking_id?: string; conflicts?: Conflict[] };
      setNewBookingId(res?.booking_id ?? null);
      if (res?.conflicts && res.conflicts.length > 0) {
        const init: Record<string, "delete" | "shrink"> = {};
        res.conflicts.forEach((c) => { init[c.slot_id] = "shrink"; });
        setDecisions(init);
        setConflicts(res.conflicts);
        return;
      }
      finish(res?.booking_id ?? null);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر تغيير الحجز");
    } finally {
      setSaving(false);
    }
  }

  // The new booking already exists at this point — only the leftover partial
  // overlaps still need a decision.
  async function applyDecisions() {
    if (!newBookingId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("resolve_booking_slot_overlaps", {
        _booking_id: newBookingId,
        _start: toDbTime(start),
        _end: toDbTime(end),
        _decisions: decisions as any,
        _end_date: endDateIso,
      } as any);
      if (error) throw error;
      const res = data as { conflicts?: Conflict[] };
      if (res?.conflicts && res.conflicts.length > 0) {
        setConflicts(res.conflicts);
        return;
      }
      finish(newBookingId);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر حل التداخل");
    } finally {
      setSaving(false);
    }
  }


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تغيير موعد الحجز · Reschedule</DialogTitle>
            <DialogDescription>
              سيتم إلغاء الحجز القديم وإنشاء حجز جديد بنفس العميل والمبالغ، وتحرير الفترة القديمة.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>التاريخ الجديد · New date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>من · Start</Label>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <Label>إلى · End</Label>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            {isOvernight && endDateIso && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                🌙 ينتهي في اليوم التالي — Ends next day ({fmtDate(endDateIso)})
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              الفترات المتداخلة مع الموعد الجديد سيتم تعديلها أو حذفها تلقائياً.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
            <Button onClick={() => submit()} disabled={saving}>
              {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              تغيير الحجز
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!conflicts} onOpenChange={(o) => !o && setConflicts(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>فترات متداخلة · Overlapping slots</DialogTitle>
            <DialogDescription>اختر ماذا نفعل بكل فترة متداخلة جزئياً.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(conflicts ?? []).map((c) => (
              <div key={c.slot_id} className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2">
                  {c.date ? `${fmtDate(c.date)} · ` : ""}{c.start_time} – {c.end_time}
                </div>
                <RadioGroup
                  value={decisions[c.slot_id] ?? "shrink"}
                  onValueChange={(v: any) => setDecisions((d) => ({ ...d, [c.slot_id]: v }))}
                  className="flex gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="shrink" id={`s-${c.slot_id}`} />
                    <Label htmlFor={`s-${c.slot_id}`} className="text-sm">تقليص</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="delete" id={`d-${c.slot_id}`} />
                    <Label htmlFor={`d-${c.slot_id}`} className="text-sm">حذف</Label>
                  </div>
                </RadioGroup>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflicts(null)} disabled={saving}>رجوع</Button>
            <Button onClick={() => submit(decisions)} disabled={saving}>
              {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              تطبيق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
