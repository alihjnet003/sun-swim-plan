import { useEffect, useState } from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  EMPTY_OFFER, offerTitle, useDeleteOffer, useOffers, useSaveOffer,
  type Offer, type OfferDraft,
} from "@/lib/offers";

const L = {
  ar: {
    title: "العروض",
    subtitle: "خصم تلقائي عند حجز فترات متتالية",
    none: "لا توجد عروض حالياً",
    add: "إضافة عرض",
    edit: "تعديل",
    del: "حذف",
    slots: "فترات متتالية",
    normal: "الأيام العادية",
    holiday: "الإجازات",
    off: "متوقف",
    dialogNew: "عرض جديد",
    dialogEdit: "تعديل العرض",
    titleAr: "اسم العرض (عربي)",
    titleEn: "اسم العرض (إنجليزي)",
    slotsCount: "عدد الفترات المتتالية",
    priceNormal: "سعر العرض — الأيام العادية (د.ب)",
    priceHoliday: "سعر العرض — الإجازات (د.ب)",
    active: "تفعيل العرض",
    popup: "إظهاره في النافذة المنبثقة",
    popupBadge: "في النافذة المنبثقة",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم حفظ العرض",
    deleted: "تم حذف العرض",
    confirmDel: "حذف هذا العرض؟",
  },
  en: {
    title: "Offers",
    subtitle: "Applied automatically for consecutive sessions",
    none: "No offers yet",
    add: "Add offer",
    edit: "Edit",
    del: "Delete",
    slots: "consecutive sessions",
    normal: "Normal days",
    holiday: "Holidays",
    off: "Off",
    dialogNew: "New offer",
    dialogEdit: "Edit offer",
    titleAr: "Offer name (Arabic)",
    titleEn: "Offer name (English)",
    slotsCount: "Consecutive sessions",
    priceNormal: "Offer price — normal days (BHD)",
    priceHoliday: "Offer price — holidays (BHD)",
    active: "Offer active",
    popup: "Show in welcome popup",
    popupBadge: "In popup",
    save: "Save",
    cancel: "Cancel",
    saved: "Offer saved",
    deleted: "Offer deleted",
    confirmDel: "Delete this offer?",
  },
} as const;

export function OffersSection({
  lang = "en",
  editable = false,
  className,
}: {
  lang?: "ar" | "en";
  editable?: boolean;
  className?: string;
}) {
  const t = L[lang];
  const { data: offers = [] } = useOffers(!editable);
  const del = useDeleteOffer();
  const [editing, setEditing] = useState<(OfferDraft & { id?: string }) | null>(null);

  if (!editable && offers.length === 0) return null;

  return (
    <section className={"rounded-xl border bg-card p-4 sm:p-5 " + (className ?? "")}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 p-2">
          <Sparkles className="size-5" />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <h2 className="font-semibold">🔥 {t.title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t.subtitle}</p>
        </div>
        {editable && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing({ ...EMPTY_OFFER })}>
            <Plus className="size-3.5" /> {t.add}
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {offers.length === 0 && <p className="text-sm text-muted-foreground">{t.none}</p>}
        {offers.map((o) => (
          <div key={o.id} className="rounded-lg border bg-background px-3 py-2.5 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                {offerTitle(o, lang)}
                {o.show_in_popup && (
                  <span className="text-[10px] rounded-full bg-primary/10 text-primary px-1.5 py-0.5">{t.popupBadge}</span>
                )}
                {!o.is_active && (
                  <span className="text-[10px] rounded-full border px-1.5 py-0.5 text-muted-foreground">{t.off}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {o.slots_count} {t.slots}
              </div>
              <div className="text-xs mt-1 flex gap-3 flex-wrap">
                <span>{t.normal}: <b>{o.price_normal.toFixed(3)} BHD</b></span>
                <span>{t.holiday}: <b>{o.price_holiday.toFixed(3)} BHD</b></span>
              </div>
            </div>
            {editable && (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing({ ...o })}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  onClick={async () => {
                    if (!window.confirm(t.confirmDel)) return;
                    try { await del.mutateAsync(o.id); toast.success(t.deleted); }
                    catch (e: any) { toast.error(e.message ?? "Error"); }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <OfferDialog
          lang={lang}
          value={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function OfferDialog({
  lang, value, onClose,
}: {
  lang: "ar" | "en";
  value: (OfferDraft & { id?: string }) | null;
  onClose: () => void;
}) {
  const t = L[lang];
  const save = useSaveOffer();
  const [form, setForm] = useState<OfferDraft & { id?: string }>(value ?? EMPTY_OFFER);

  useEffect(() => { if (value) setForm(value); }, [value]);

  const submit = async () => {
    try {
      await save.mutateAsync(form);
      toast.success(t.saved);
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    }
  };

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{form.id ? t.dialogEdit : t.dialogNew}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t.titleAr}</Label>
            <Input value={form.title_ar} onChange={(e) => setForm({ ...form, title_ar: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t.titleEn}</Label>
            <Input value={form.title_en} onChange={(e) => setForm({ ...form, title_en: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t.slotsCount}</Label>
            <Input type="number" min={2} max={12} value={form.slots_count}
              onChange={(e) => setForm({ ...form, slots_count: Number(e.target.value) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t.priceNormal}</Label>
              <Input type="number" min={0} step="0.001" value={form.price_normal}
                onChange={(e) => setForm({ ...form, price_normal: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t.priceHoliday}</Label>
              <Input type="number" min={0} step="0.001" value={form.price_holiday}
                onChange={(e) => setForm({ ...form, price_holiday: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="offer-active">{t.active}</Label>
            <Switch id="offer-active" checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="offer-popup">{t.popup}</Label>
            <Switch id="offer-popup" checked={form.show_in_popup}
              onCheckedChange={(v) => setForm({ ...form, show_in_popup: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.cancel}</Button>
          <Button onClick={submit} disabled={save.isPending}>{t.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
