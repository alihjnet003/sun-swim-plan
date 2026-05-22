import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateAll } from "@/lib/queries";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

export const Route = createFileRoute("/slots")({ component: SlotsPage });

interface Preset { label: string; start: string; end: string; price: number; enabled: boolean }

const DEFAULT_PRESETS: Preset[] = [
  { label: "Morning", start: "09:00", end: "11:00", price: 8, enabled: true },
  { label: "Afternoon", start: "13:00", end: "15:00", price: 10, enabled: true },
  { label: "Evening", start: "17:00", end: "19:00", price: 12, enabled: true },
];

function SlotsPage() {
  const invalidate = useInvalidateAll();
  const { t } = useT();
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 6]);
  const [presets, setPresets] = useState<Preset[]>(DEFAULT_PRESETS);
  const [busy, setBusy] = useState(false);

  function toggleDay(d: number) {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  }

  function updatePreset(i: number, patch: Partial<Preset>) {
    setPresets((arr) => arr.map((p, j) => j === i ? { ...p, ...patch } : p));
  }
  function removePreset(i: number) {
    setPresets((arr) => arr.filter((_, j) => j !== i));
  }
  function addPreset() {
    setPresets((arr) => [...arr, { label: "Slot", start: "10:00", end: "12:00", price: 10, enabled: true }]);
  }

  async function generate() {
    setBusy(true);
    try {
      const rows: any[] = [];
      const start = new Date(from);
      const end = new Date(to);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (!days.includes(d.getDay())) continue;
        const iso = d.toISOString().slice(0, 10);
        presets.forEach((p) => {
          if (!p.enabled) return;
          rows.push({ date: iso, start_time: p.start, end_time: p.end, price: p.price, label: p.label });
        });
      }
      if (rows.length === 0) { toast.error("No slots to create"); return; }
      let created = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { data, error } = await supabase.from("booking_slots").upsert(chunk, { onConflict: "date,start_time,end_time", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        created += data?.length ?? 0;
      }
      invalidate();
      toast.success(`Created ${created} new slot${created === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(false); }
  }

  async function closeRange() {
    setBusy(true);
    try {
      const { error } = await supabase.from("booking_slots").update({ is_closed: true }).gte("date", from).lte("date", to);
      if (error) throw error;
      invalidate();
      toast.success("Range marked unavailable");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">{t("slots.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("slots.subtitle")}</p>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>{t("slots.from")}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>{t("slots.to")}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        <div>
          <Label className="mb-2 block">{t("slots.days")}</Label>
          <div className="flex flex-wrap gap-2">
            {dayLabels.map((l, i) => (
              <button key={l} type="button" onClick={() => toggleDay(i)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${days.includes(i) ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>{t("slots.presets")}</Label>
            <Button type="button" size="sm" variant="outline" onClick={addPreset}>{t("slots.addPreset")}</Button>
          </div>
          <div className="space-y-2">
            {presets.map((p, i) => (
              <div key={i} className="rounded-md border p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <Checkbox checked={p.enabled} onCheckedChange={(v) => updatePreset(i, { enabled: !!v })} />
                  <Input className="flex-1" value={p.label} onChange={(e) => updatePreset(i, { label: e.target.value })} placeholder={t("slots.label")} />
                  <Button type="button" size="icon" variant="ghost" onClick={() => removePreset(i)} aria-label={t("slots.remove")}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">{t("slots.start")}</Label>
                    <Input type="time" value={p.start} onChange={(e) => updatePreset(i, { start: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">{t("slots.end")}</Label>
                    <Input type="time" value={p.end} onChange={(e) => updatePreset(i, { end: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">{t("slots.price")}</Label>
                    <Input type="number" step="0.001" min={0} value={p.price} onChange={(e) => updatePreset(i, { price: Number(e.target.value) })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={generate} disabled={busy}>
            {busy && <Loader2 className="size-4 me-2 animate-spin" />} {t("slots.generate")}
          </Button>
          <Button variant="outline" onClick={closeRange} disabled={busy}>{t("slots.closeRange")}</Button>
        </div>
      </section>
    </div>
  );
}
