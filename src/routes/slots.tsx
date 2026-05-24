import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateAll, useSlotsForMonth } from "@/lib/queries";
import { useT } from "@/lib/i18n";
import { fmtDate, fmtMoney, slotTimeRange } from "@/lib/format";
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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Slot list for current month view
  const today = new Date();
  const { data: monthSlots = [], isLoading: loadingSlots } = useSlotsForMonth(today.getFullYear(), today.getMonth());

  const allSelected = monthSlots.length > 0 && selected.size === monthSlots.length;
  const someSelected = selected.size > 0 && !allSelected;

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

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(monthSlots.map((s) => s.id)));
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

  async function deleteAllSlots() {
    setBusy(true);
    try {
      // ON DELETE CASCADE on bookings.slot_id will remove linked bookings.
      const { error } = await supabase.from("booking_slots").delete().not("id", "is", null);
      if (error) throw error;
      setSelected(new Set());
      invalidate();
      toast.success("All slots deleted");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); setConfirmDeleteAll(false); }
  }

  async function deleteSelected() {
    setBusy(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("booking_slots").delete().in("id", ids);
      if (error) throw error;
      toast.success(`Deleted ${ids.length} slot${ids.length === 1 ? "" : "s"}`);
      setSelected(new Set());
      invalidate();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); setConfirmDeleteSelected(false); }
  }

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const sortedSlots = useMemo(
    () => [...monthSlots].sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)),
    [monthSlots]
  );

  return (
    <div className="space-y-6 max-w-4xl">
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

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={generate} disabled={busy}>
            {busy && <Loader2 className="size-4 me-2 animate-spin" />} {t("slots.generate")}
          </Button>
          <Button variant="outline" onClick={closeRange} disabled={busy}>{t("slots.closeRange")}</Button>
          <Button variant="destructive" onClick={() => setConfirmDeleteAll(true)} disabled={busy} className="ms-auto">
            <Trash2 className="size-4 me-2" /> Delete All Slots
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">This month's slots</h2>
            <p className="text-xs text-muted-foreground">{sortedSlots.length} total</p>
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <Button size="sm" variant="destructive" onClick={() => setConfirmDeleteSelected(true)} disabled={busy}>
                <Trash2 className="size-4 me-2" /> Delete Selected
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">Label</th>
                <th className="text-right px-3 py-2">Price</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loadingSlots && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading…</td></tr>}
              {!loadingSlots && sortedSlots.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No slots this month.</td></tr>}
              {sortedSlots.map((s) => (
                <tr key={s.id} className="hover:bg-accent/30">
                  <td className="px-3 py-2">
                    <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleOne(s.id)} aria-label="Select slot" />
                  </td>
                  <td className="px-3 py-2">{fmtDate(s.date)}</td>
                  <td className="px-3 py-2 tabular-nums">{slotTimeRange(s.start_time, s.end_time)}</td>
                  <td className="px-3 py-2">{s.label ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.price)}</td>
                  <td className="px-3 py-2">{s.is_closed ? <span className="text-destructive">Closed</span> : <span className="text-success">Open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AlertDialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ALL slots?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete ALL slots? This will also delete all bookings linked to them. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteAllSlots} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteSelected} onOpenChange={setConfirmDeleteSelected}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} slot{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Any bookings linked to these slots will also be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
