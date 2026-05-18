import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateAll } from "@/lib/queries";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/slots")({ component: SlotsPage });

const PRESETS = [
  { label: "Morning", start: "09:00", end: "11:00", price: 80 },
  { label: "Afternoon", start: "13:00", end: "15:00", price: 100 },
  { label: "Evening", start: "17:00", end: "19:00", price: 120 },
];

function SlotsPage() {
  const invalidate = useInvalidateAll();
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 6]); // Sat–Thu
  const [presets, setPresets] = useState(PRESETS.map(() => true));
  const [busy, setBusy] = useState(false);

  function toggleDay(d: number) {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
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
        PRESETS.forEach((p, i) => {
          if (!presets[i]) return;
          rows.push({ date: iso, start_time: p.start, end_time: p.end, price: p.price, label: p.label });
        });
      }
      if (rows.length === 0) { toast.error("No slots to create"); return; }
      // Insert in chunks, ignore duplicates
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
        <h1 className="text-2xl font-bold">Slot Management</h1>
        <p className="text-muted-foreground text-sm">Bulk-generate recurring slots across a date range</p>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        <div>
          <Label className="mb-2 block">Days of week</Label>
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
          <Label className="mb-2 block">Slot presets</Label>
          <div className="space-y-2">
            {PRESETS.map((p, i) => (
              <label key={p.label} className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/30">
                <Checkbox checked={presets[i]} onCheckedChange={(v) => setPresets((arr) => arr.map((x, j) => j === i ? !!v : x))} />
                <div className="flex-1">
                  <div className="font-medium text-sm">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.start} – {p.end} · ${p.price}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={generate} disabled={busy}>
            {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Generate slots
          </Button>
          <Button variant="outline" onClick={closeRange} disabled={busy}>Close entire range</Button>
        </div>
      </section>
    </div>
  );
}
