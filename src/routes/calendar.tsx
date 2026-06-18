import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2, Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BookingModal } from "@/components/BookingModal";
import {
  useBookingsForMonth, useSlotsForMonth,
  type BookingWithRelations, type Slot,
  useInvalidateAll,
} from "@/lib/queries";
import { usePublicHolidays } from "@/hooks/usePublicHolidays";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtMoney, slotTimeRange } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/calendar")({ component: CalendarPage });

const statusColor: Record<string, string> = {
  new: "bg-warning/25 text-warning-foreground border-warning/40",
  confirmed: "bg-destructive/15 text-destructive border-destructive/30",
  completed: "bg-info/15 text-info border-info/30",
  cancelled: "bg-muted text-muted-foreground border-border line-through",
};

function dotColor(status: string) {
  switch (status) {
    case "available": return "bg-success";
    case "new":       return "bg-warning";
    case "confirmed": return "bg-destructive";
    case "completed": return "bg-info";
    default:          return "bg-muted-foreground";
  }
}

interface EditForm {
  date: string;
  start_time: string;
  end_time: string;
  label: string;
  price: string;
}

function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const { data: slots = [] } = useSlotsForMonth(y, m);
  const { data: bookings = [] } = useBookingsForMonth(y, m);
  const invalidate = useInvalidateAll();

  const thisYearHolidays = usePublicHolidays(y);
  const nextYearHolidays = usePublicHolidays(y + 1);
  const holidays = useMemo(() => ({ ...thisYearHolidays, ...nextYearHolidays }), [thisYearHolidays, nextYearHolidays]);

  // Booking modal
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingWithRelations | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Mobile bottom sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  // Edit slot dialog
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ date: "", start_time: "", end_time: "", label: "", price: "" });
  const [isSaving, setIsSaving] = useState(false);

  // Delete slot dialog
  const [deletingSlot, setDeletingSlot] = useState<Slot | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const bookingBySlot = useMemo(() => {
    const map = new Map<string, BookingWithRelations>();
    bookings.forEach((b) => { map.set(b.slot_id, b); });
    return map;
  }, [bookings]);

  const days = useMemo(() => {
    const first = new Date(y, m, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: { date: Date | null }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ date: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(y, m, d) });
    while (cells.length % 7) cells.push({ date: null });
    return cells;
  }, [y, m]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    slots.forEach((s) => { const arr = map.get(s.date) ?? []; arr.push(s); map.set(s.date, arr); });
    return map;
  }, [slots]);

  const toLocalKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayKey = toLocalKey(new Date());

  const selectedDaySlots = selectedDayKey ? slotsByDate.get(selectedDayKey) ?? [] : [];
  const selectedDayHoliday = selectedDayKey ? holidays[selectedDayKey] : undefined;
  const selectedDayLabel = selectedDayKey
    ? new Date(selectedDayKey + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";

  // Open booking modal
  const openSlot = (s: Slot) => {
    const b = bookingBySlot.get(s.id);
    if (b) { setSelectedBooking(b); setSelectedSlot(null); }
    else { setSelectedSlot(s); setSelectedBooking(null); }
    setModalOpen(true);
    setSheetOpen(false);
  };

  // Open edit dialog
  const openEditSlot = (s: Slot) => {
    setEditingSlot(s);
    setEditForm({
      date:       s.date,
      start_time: s.start_time,
      end_time:   s.end_time,
      label:      s.label ?? "",
      price:      String(s.price),
    });
    setSheetOpen(false);
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!editingSlot) return;
    const price = parseFloat(editForm.price);
    if (!editForm.date || !editForm.start_time || !editForm.end_time) {
      toast.error("Please fill all required fields");
      return;
    }
    if (isNaN(price) || price < 0) {
      toast.error("Please enter a valid price");
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("booking_slots")
        .update({
          date:       editForm.date,
          start_time: editForm.start_time,
          end_time:   editForm.end_time,
          label:      editForm.label || null,
          price,
        })
        .eq("id", editingSlot.id);
      if (error) throw error;
      toast.success("Slot updated ✓");
      setEditingSlot(null);
      invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update slot");
    } finally {
      setIsSaving(false);
    }
  };

  // Open delete confirm
  const openDeleteConfirm = (s: Slot) => {
    setDeletingSlot(s);
    setSheetOpen(false);
  };

  // Confirm delete
  const handleDeleteSlot = async () => {
    if (!deletingSlot) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("booking_slots")
        .delete()
        .eq("id", deletingSlot.id);
      if (error) throw error;
      toast.success("Slot deleted");
      setDeletingSlot(null);
      invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to delete slot");
    } finally {
      setIsDeleting(false);
    }
  };

  const isOvernight = editForm.start_time && editForm.end_time && editForm.end_time <= editForm.start_time;

  return (
    <div className="space-y-4 w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Monthly Calendar</h1>
          <p className="text-muted-foreground text-xs sm:text-sm">Click a slot to view or create a booking</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 mx-auto sm:mx-0">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeft className="size-4" /></Button>
          <div className="font-semibold w-32 sm:w-44 text-center text-sm sm:text-base">
            {cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </div>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRight className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</Button>
          <ShareButton />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground">
        <Legend color="bg-success/30 border-success/40" label="Available" />
        <Legend color="bg-warning/30 border-warning/40" label="Pending" />
        <Legend color="bg-destructive/20 border-destructive/40" label="Booked" />
        <Legend color="bg-info/20 border-info/40" label="Completed" />
        <Legend color="bg-muted border-border" label="Cancelled" />
        <Legend color="bg-amber-500 border-amber-500" label="Holiday" />
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border bg-card overflow-hidden w-full">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 text-[10px] sm:text-xs font-medium border-b bg-muted/50">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
            <div key={d} className="px-1 py-2 text-center min-w-0 truncate">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((c, i) => {
            const key = c.date ? toLocalKey(c.date) : undefined;
            const daySlots = key ? slotsByDate.get(key) ?? [] : [];
            const isToday = key === todayKey;
            const holiday = key ? holidays[key] : undefined;

            if (!c.date) {
              return <div key={i} className="min-h-[52px] sm:min-h-[120px] border-r border-b bg-muted/20" />;
            }

            return (
              <div
                key={i}
                onClick={() => { setSelectedDayKey(key!); setSheetOpen(true); }}
                className="min-h-[52px] md:min-h-[120px] min-w-0 overflow-hidden border-r border-b p-1 md:p-1.5 text-xs relative cursor-pointer active:bg-muted/40 md:active:bg-transparent md:cursor-default select-none"
              >
                {/* Day number row */}
                <div className={cn("flex items-center justify-between mb-1 font-medium gap-1", isToday && "text-primary")}>
                  {holiday ? (
                    <span className="hidden md:inline text-[10px] text-amber-600 dark:text-amber-400 truncate" title={holiday.localName || holiday.name}>
                      {holiday.localName || holiday.name}
                    </span>
                  ) : <span className="hidden md:inline" />}
                  <span className={cn("inline-flex size-5 md:size-6 items-center justify-center rounded-full text-[11px] md:text-xs ml-auto", isToday && "bg-primary text-primary-foreground")}>
                    {c.date.getDate()}
                  </span>
                </div>

                {/* Holiday dot (mobile) */}
                {holiday && (
                  <span className="md:hidden absolute top-1 left-1 size-1.5 rounded-full bg-amber-500" aria-label={holiday.localName || holiday.name} />
                )}

                {/* Desktop: full slot cards with edit/delete buttons */}
                <div className="hidden md:block space-y-1">
                  {daySlots.map((s) => {
                    const b = bookingBySlot.get(s.id);
                    const status = s.is_closed ? "cancelled" : b ? b.booking_status : "available";
                    const klass = status === "available"
                      ? "bg-success/15 text-success border-success/30 hover:bg-success/25"
                      : statusColor[status];
                    return (
                      <div key={s.id} className="relative group">
                        <button
                          onClick={(e) => { e.stopPropagation(); openSlot(s); }}
                          className={cn("w-full text-left border rounded px-1.5 py-1 transition-colors pr-12", klass)}
                        >
                          <div className="font-medium truncate">
                            {slotTimeRange(s.start_time, s.end_time)}
                          </div>
                          {b ? (
                            <div className="truncate opacity-90">{b.customer?.full_name}</div>
                          ) : (
                            <div className="opacity-75 truncate">{s.label ?? "Available"} · {fmtMoney(s.price)}</div>
                          )}
                        </button>
                        {/* Edit / Delete buttons — appear on hover */}
                        <div className="absolute top-0.5 right-0.5 hidden group-hover:flex gap-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditSlot(s); }}
                            title="Edit slot"
                            className="p-1 rounded bg-background/90 hover:bg-primary/20 text-muted-foreground hover:text-primary border border-border"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openDeleteConfirm(s); }}
                            title="Delete slot"
                            className="p-1 rounded bg-background/90 hover:bg-destructive/20 text-muted-foreground hover:text-destructive border border-border"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Mobile: dots only */}
                <div className="md:hidden absolute bottom-1 left-0 right-0 flex items-center justify-center gap-0.5">
                  {daySlots.slice(0, 4).map((s) => {
                    const b = bookingBySlot.get(s.id);
                    const status = s.is_closed ? "cancelled" : b ? b.booking_status : "available";
                    return <span key={s.id} className={cn("size-1.5 rounded-full", dotColor(status))} />;
                  })}
                  {daySlots.length > 4 && (
                    <span className="text-[8px] text-muted-foreground leading-none ml-0.5">+{daySlots.length - 4}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Booking modal */}
      <BookingModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        slot={selectedSlot}
        booking={selectedBooking}
      />

      {/* Mobile bottom sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl pb-10">
          <SheetHeader>
            <SheetTitle>{selectedDayLabel}</SheetTitle>
            {selectedDayHoliday && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                🎉 {selectedDayHoliday.localName || selectedDayHoliday.name}
              </div>
            )}
          </SheetHeader>
          <div className="mt-4">
            {selectedDaySlots.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No slots available for this day
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDaySlots.map((s) => {
                  const b = bookingBySlot.get(s.id);
                  const status = s.is_closed ? "cancelled" : b ? b.booking_status : "available";
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 border rounded-xl p-3 bg-card">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{s.label ?? "Slot"}</div>
                        <div className="text-xs text-muted-foreground">{slotTimeRange(s.start_time, s.end_time)}</div>
                        <div className="text-xs font-semibold text-primary mt-0.5">{fmtMoney(s.price)}</div>
                        {b?.customer?.full_name && (
                          <div className="text-xs mt-0.5 truncate text-muted-foreground">{b.customer.full_name}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border", statusColor[status] ?? "bg-success/15 text-success border-success/30")}>
                          <span className={cn("size-1.5 rounded-full", dotColor(status))} />
                          {status}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openSlot(s)}
                            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg font-medium"
                          >
                            {status === "available" ? "Book" : "View"}
                          </button>
                          <button
                            onClick={() => openEditSlot(s)}
                            title="Edit"
                            className="p-1.5 rounded-lg bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary border border-border"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => openDeleteConfirm(s)}
                            title="Delete"
                            className="p-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Edit Slot Dialog ── */}
      <Dialog open={!!editingSlot} onOpenChange={(o) => { if (!o) setEditingSlot(null); }}>
        <DialogContent className="sm:max-w-md w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4" /> Edit Slot
            </DialogTitle>
            {editingSlot && (
              <p className="text-xs text-muted-foreground">
                {editingSlot.label ?? "Slot"} · {editingSlot.date}
              </p>
            )}
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Label */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-label">Session Label</Label>
              <Input
                id="edit-label"
                value={editForm.label}
                onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Morning, Night…"
              />
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-date">Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={editForm.date}
                onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-start">Start Time</Label>
                <Input
                  id="edit-start"
                  type="time"
                  value={editForm.start_time}
                  onChange={(e) => setEditForm((f) => ({ ...f, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-end">End Time</Label>
                <Input
                  id="edit-end"
                  type="time"
                  value={editForm.end_time}
                  onChange={(e) => setEditForm((f) => ({ ...f, end_time: e.target.value }))}
                />
              </div>
            </div>
            {isOvernight && (
              <p className="text-xs text-amber-500 flex items-center gap-1">
                🌙 Overnight slot — ends next day
              </p>
            )}

            {/* Price */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-price">Price (BHD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">BHD</span>
                <Input
                  id="edit-price"
                  type="number"
                  min="0"
                  step="0.001"
                  value={editForm.price}
                  onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                  className="pl-14"
                  placeholder="0.000"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-row">
            <Button variant="outline" className="flex-1" onClick={() => setEditingSlot(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleSaveEdit}
              disabled={isSaving || !editForm.date || !editForm.start_time || !editForm.end_time}
            >
              {isSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Slot Confirm ── */}
      <AlertDialog open={!!deletingSlot} onOpenChange={(o) => { if (!o) setDeletingSlot(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-4" /> Delete Slot?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deletingSlot && (
                  <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
                    <p className="font-medium">{deletingSlot.label ?? "Slot"}</p>
                    <p className="text-muted-foreground">📅 {deletingSlot.date}</p>
                    <p className="text-muted-foreground">🕐 {slotTimeRange(deletingSlot.start_time, deletingSlot.end_time)}</p>
                    <p className="font-semibold text-primary">{fmtMoney(deletingSlot.price)}</p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  This will permanently delete the slot and any bookings linked to it. This cannot be undone.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSlot}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting…" : "Delete Slot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("inline-block size-3 rounded border", color)} />
      {label}
    </div>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/public/calendar` : "";

  const legacyCopy = (text: string): boolean => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const markCopied = () => {
    setCopied(true);
    toast.success("تم نسخ الرابط!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    // 1. Web Share API (best on mobile)
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "تقويم الحجوزات", url });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return; // user cancelled
        // fall through to copy
      }
    }
    // 2. Clipboard API
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        markCopied();
        return;
      } catch {
        // fall through
      }
    }
    // 3. Legacy execCommand
    if (legacyCopy(url)) {
      markCopied();
      return;
    }
    // 4. Manual fallback
    setFallbackOpen(true);
  };

  const handleManualCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(markCopied).catch(() => legacyCopy(url) && markCopied());
    } else if (legacyCopy(url)) {
      markCopied();
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleShare} className="gap-2">
        {copied ? <><Check className="size-4 text-success" /> تم النسخ</> : <><Share2 className="size-4" /> مشاركة التقويم</>}
      </Button>
      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>انسخ الرابط</DialogTitle>
          </DialogHeader>
          <Input value={url} readOnly onFocus={(e) => e.currentTarget.select()} dir="ltr" />
          <DialogFooter>
            <Button onClick={handleManualCopy}>نسخ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

