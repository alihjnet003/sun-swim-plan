import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquarePlus, Sparkles, Check, Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateAll } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/import")({ component: ImportPage });

/* ── Types ─────────────────────────────────── */
interface ParsedBooking {
  _id: number;
  date: string;
  session: string;
  start_time: string;
  end_time: string;
  customer_name: string | null;
  phone: string | null;
  total_price: number | null;
  paid_amount: number | null;
  balance: number | null;
  notes: string | null;
  status: "confirmed" | "pending";
}

/* ── AI system prompt ───────────────────────── */
const SYSTEM_PROMPT = `You are a booking parser for a private swimming pool in Bahrain.
Parse Arabic/English mixed booking messages and return ONLY a valid JSON array. No markdown, no explanation, just raw JSON.

Each booking object:
{
  "date": "2026-MM-DD",
  "session": "Night"|"Morning"|"Afternoon"|"Evening"|"Full Day",
  "start_time": "HH:MM",
  "end_time": "HH:MM",
  "customer_name": string|null,
  "phone": string|null,
  "total_price": number|null,
  "paid_amount": number|null,
  "balance": number|null,
  "notes": string|null,
  "status": "confirmed"|"pending"
}

Rules:
- night/ليل: start=20:00 end=08:00
- morning: start=08:00 end=12:00
- afternoon/مساء: start=14:00 end=18:00
- evening: start=18:00 end=22:00
- full day: start=08:00 end=23:59
- explicit times "8-12" → 08:00–12:00, "2-6" → 14:00–18:00
- Arabic numerals: ١=1 ٢=2 ٣=3 ٤=4 ٥=5 ٦=6 ٧=7 ٨=8 ٩=9 ٠=0
- Month: /5=May /6=June etc, year=2026
- "paid ✅" with no balance → paid_amount=total, balance=0
- if balance given and total known → paid_amount = total - balance
- "منتظر" or "waiting" → status=pending, else confirmed`;

/* ── Helpers ────────────────────────────────── */
function sessionDotColor(s: string) {
  switch (s) {
    case "Night":     return "bg-indigo-500";
    case "Morning":   return "bg-amber-400";
    case "Afternoon": return "bg-emerald-500";
    case "Evening":   return "bg-pink-500";
    case "Full Day":  return "bg-cyan-500";
    default:          return "bg-muted-foreground";
  }
}

/* ── Page component ─────────────────────────── */
function ImportPage() {
  const invalidate = useInvalidateAll();

  const [text, setText] = useState("");
  const [bookings, setBookings] = useState<ParsedBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState("");

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [creatingIds, setCreatingIds] = useState<Set<number>>(new Set());
  const [createdIds, setCreatedIds] = useState<Set<number>>(new Set());

  /* ── Parse via Claude API ─────────────────── */
  async function handleParse() {
    if (!text.trim()) return;
    setLoading(true);
    setParseError("");
    setBookings([]);
    setSelected(new Set());
    setCreatedIds(new Set());

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Parse these bookings:\n\n${text}` }],
        }),
      });

      const data = await res.json();
      const raw  = data.content?.[0]?.text ?? "";
      const json = raw.replace(/```json|```/g, "").trim();
      const arr  = JSON.parse(json) as Omit<ParsedBooking, "_id">[];
      const withIds = arr.map((b, i) => ({ ...b, _id: i }));
      setBookings(withIds);
      setSelected(new Set(withIds.map((b) => b._id)));
    } catch {
      setParseError("فشل التحليل — تأكد من الرسالة وحاول مجدداً.");
    } finally {
      setLoading(false);
    }
  }

  function updateField(id: number, field: keyof ParsedBooking, value: unknown) {
    setBookings((bs) => bs.map((b) => b._id === id ? { ...b, [field]: value } : b));
  }

  function toggleSelect(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  /* ── Create bookings in Supabase ──────────── */
  async function createSelected() {
    const ids = [...selected].filter((id) => !createdIds.has(id));
    if (!ids.length) return;

    for (const id of ids) {
      const b = bookings.find((x) => x._id === id);
      if (!b) continue;

      setCreatingIds((s) => new Set([...s, id]));
      try {
        /* 1. Find or create customer */
        let customerId: string | null = null;
        if (b.phone) {
          const { data: existing } = await supabase
            .from("customers")
            .select("id")
            .eq("phone", b.phone)
            .maybeSingle();

          if (existing) {
            customerId = existing.id;
          } else {
            const { data: newCust, error: custErr } = await supabase
              .from("customers")
              .insert({ full_name: b.customer_name ?? b.phone, phone: b.phone })
              .select("id")
              .single();
            if (custErr) throw custErr;
            customerId = newCust.id;
          }
        }

        /* 2. Find or create slot */
        const { data: existingSlot } = await supabase
          .from("booking_slots")
          .select("id")
          .eq("date", b.date)
          .eq("start_time", b.start_time)
          .eq("end_time", b.end_time)
          .maybeSingle();

        let slotId: string;
        if (existingSlot) {
          slotId = existingSlot.id;
        } else {
          const { data: newSlot, error: slotErr } = await supabase
            .from("booking_slots")
            .insert({
              date:       b.date,
              start_time: b.start_time,
              end_time:   b.end_time,
              label:      b.session,
              price:      b.total_price ?? 0,
            })
            .select("id")
            .single();
          if (slotErr) throw slotErr;
          slotId = newSlot.id;
        }

        /* 3. Create booking */
        const { data: newBooking, error: bookErr } = await supabase
          .from("bookings")
          .insert({
            slot_id:        slotId,
            customer_id:    customerId,
            booking_status: b.status === "pending" ? "new" : "confirmed",
            total_amount:   b.total_price ?? 0,
            paid_amount:    b.paid_amount ?? 0,
            notes:          b.notes ?? null,
          })
          .select("id")
          .single();
        if (bookErr) throw bookErr;

        /* 4. Create payment if paid */
        if ((b.paid_amount ?? 0) > 0 && newBooking?.id) {
          await supabase.from("payments").insert({
            booking_id:   newBooking.id,
            amount:       b.paid_amount!,
            payment_date: new Date().toISOString().slice(0, 10),
            method:       "cash",
            notes:        "Imported from message",
          });
        }

        setCreatedIds((s) => new Set([...s, id]));
        toast.success(`✓ حجز ${b.date} (${b.session}) تم إنشاؤه`);
      } catch (e: any) {
        toast.error(`فشل حجز ${b.date}: ${e.message}`);
      } finally {
        setCreatingIds((s) => { const n = new Set(s); n.delete(id); return n; });
      }
    }

    invalidate();
  }

  const pendingSelected = [...selected].filter((id) => !createdIds.has(id)).length;
  const allDone = bookings.length > 0 && createdIds.size === bookings.length;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquarePlus className="size-6 text-primary" />
          استيراد الحجوزات من رسالة
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          الصق رسائل الواتساب وسيحوّلها الذكاء الاصطناعي إلى حجوزات
        </p>
      </div>

      {/* Input section */}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <Label className="text-sm font-semibold">الرسالة</Label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          dir="auto"
          className={cn(
            "w-full rounded-lg border bg-background p-3 text-sm leading-relaxed",
            "resize-y font-[inherit] focus:outline-none focus:ring-2 focus:ring-primary/40",
            "placeholder:text-muted-foreground"
          )}
          placeholder={"الصق رسائل الحجوزات هنا...\n\nمثال:\n28/5 full day balance: 35 BD +973 3630 5004\n29/5 8-12 night من طرف محمد +973 3980 3797"}
        />

        {parseError && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="size-4 shrink-0" /> {parseError}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleParse} disabled={loading || !text.trim()}>
            {loading
              ? <><Loader2 className="size-4 me-2 animate-spin" /> جاري التحليل...</>
              : <><Sparkles className="size-4 me-2" /> تحليل الرسالة</>
            }
          </Button>
        </div>
      </section>

      {/* Results */}
      {bookings.length > 0 && (
        <section className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span><span className="text-foreground font-semibold">{bookings.length}</span> حجز تم تحليله</span>
              {createdIds.size > 0 && <span className="text-success font-medium">✓ {createdIds.size} تم إنشاؤه</span>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelected(new Set(bookings.filter((b) => !createdIds.has(b._id)).map((b) => b._id)))}
                className="text-xs text-primary hover:underline"
              >
                تحديد الكل
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground hover:underline"
              >
                إلغاء الكل
              </button>
              <Button
                onClick={createSelected}
                disabled={pendingSelected === 0}
                className="gap-2"
              >
                <Check className="size-4" />
                إنشاء {pendingSelected > 0 ? `${pendingSelected} ` : ""}حجز
              </Button>
            </div>
          </div>

          {/* Cards */}
          {bookings.map((b) => {
            const isSelected  = selected.has(b._id);
            const isCreated   = createdIds.has(b._id);
            const isCreating  = creatingIds.has(b._id);

            return (
              <div
                key={b._id}
                className={cn(
                  "rounded-xl border bg-card p-4 transition-all",
                  isCreated  ? "border-success/40 bg-success/5 opacity-75" : "",
                  isSelected && !isCreated ? "border-primary/50" : "",
                  !isSelected && !isCreated ? "opacity-60" : "",
                )}
              >
                {/* Card header */}
                <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Checkbox */}
                    {!isCreated && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(b._id)}
                        className="size-4 accent-primary cursor-pointer"
                      />
                    )}
                    {isCreated && !isCreating && <Check className="size-4 text-success" />}
                    {isCreating && <Loader2 className="size-4 animate-spin text-primary" />}

                    {/* Date */}
                    <span className="text-sm font-semibold bg-muted rounded-md px-2.5 py-0.5">
                      📅 {b.date}
                    </span>

                    {/* Session */}
                    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full border bg-muted")}>
                      <span className={cn("size-2 rounded-full", sessionDotColor(b.session))} />
                      {b.session}
                    </span>

                    {/* Status */}
                    {b.status === "pending" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/30">⏳ منتظر</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30">✅ مؤكد</span>
                    )}

                    {/* Fully paid */}
                    {(b.balance === 0 && b.paid_amount! > 0) && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">💰 مدفوع</span>
                    )}
                  </div>

                  {/* Price summary */}
                  <div className="text-right text-sm shrink-0">
                    {b.total_price != null && <div className="font-bold">{b.total_price} BD</div>}
                    {(b.balance ?? 0) > 0 && <div className="text-xs text-warning">متبقي: {b.balance} BD</div>}
                  </div>
                </div>

                {/* Editable fields */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">الاسم</Label>
                    <Input
                      value={b.customer_name ?? ""}
                      onChange={(e) => updateField(b._id, "customer_name", e.target.value || null)}
                      placeholder="—"
                      disabled={isCreated}
                      className="h-8 text-sm"
                      dir="auto"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">الجوال</Label>
                    <Input
                      value={b.phone ?? ""}
                      onChange={(e) => updateField(b._id, "phone", e.target.value || null)}
                      placeholder="—"
                      disabled={isCreated}
                      className="h-8 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">البداية</Label>
                    <Input
                      type="time"
                      value={b.start_time}
                      onChange={(e) => updateField(b._id, "start_time", e.target.value)}
                      disabled={isCreated}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">النهاية</Label>
                    <Input
                      type="time"
                      value={b.end_time}
                      onChange={(e) => updateField(b._id, "end_time", e.target.value)}
                      disabled={isCreated}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">المبلغ (BD)</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={b.total_price ?? ""}
                      onChange={(e) => updateField(b._id, "total_price", parseFloat(e.target.value) || null)}
                      placeholder="—"
                      disabled={isCreated}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">المدفوع (BD)</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={b.paid_amount ?? ""}
                      onChange={(e) => updateField(b._id, "paid_amount", parseFloat(e.target.value) || null)}
                      placeholder="—"
                      disabled={isCreated}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground mb-1 block">ملاحظات</Label>
                    <Input
                      value={b.notes ?? ""}
                      onChange={(e) => updateField(b._id, "notes", e.target.value || null)}
                      placeholder="—"
                      disabled={isCreated}
                      className="h-8 text-sm"
                      dir="auto"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* All done banner */}
          {allDone && (
            <div className="rounded-xl border border-success/40 bg-success/10 p-6 text-center space-y-1">
              <div className="text-3xl">🎉</div>
              <div className="font-semibold text-success">تم إنشاء جميع الحجوزات بنجاح!</div>
              <p className="text-sm text-muted-foreground">يمكنك مراجعتها في صفحة الحجوزات أو التقويم</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
