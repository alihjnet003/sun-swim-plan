import { useEffect, useState } from "react";
import { Gift, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_LOYALTY, offerText, rewardText, useLoyaltySettings, useUpdateLoyaltySettings,
  type LoyaltyRewardType, type LoyaltySettings,
} from "@/lib/loyalty";

const L = {
  ar: {
    title: "بطاقة الولاء",
    edit: "تعديل العرض",
    off: "برنامج الولاء متوقف حالياً",
    steps: "تقدّمك في البطاقة",
    reward: "المكافأة",
    dialogTitle: "تعديل عرض بطاقة الولاء",
    enabled: "تفعيل برنامج الولاء",
    threshold: "عدد الحجوزات المطلوبة",
    type: "نوع المكافأة",
    typeDiscount: "نسبة تخفيض %",
    typeFree: "حجز مجاني",
    typeCustom: "عرض مخصص",
    percent: "نسبة التخفيض %",
    note: "نص العرض المخصص",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم حفظ العرض",
  },
  en: {
    title: "Loyalty card",
    edit: "Edit offer",
    off: "Loyalty program is currently off",
    steps: "Your progress",
    reward: "Reward",
    dialogTitle: "Edit loyalty offer",
    enabled: "Enable loyalty program",
    threshold: "Bookings required",
    type: "Reward type",
    typeDiscount: "Percentage discount",
    typeFree: "Free booking",
    typeCustom: "Custom offer",
    percent: "Discount %",
    note: "Custom offer text",
    save: "Save",
    cancel: "Cancel",
    saved: "Offer saved",
  },
} as const;

export function LoyaltyOfferCard({
  lang = "en",
  editable = false,
  className,
}: {
  lang?: "ar" | "en";
  editable?: boolean;
  className?: string;
}) {
  const t = L[lang];
  const { data: settings } = useLoyaltySettings();
  const [open, setOpen] = useState(false);
  const s = settings ?? DEFAULT_LOYALTY;

  if (!settings) return null;
  if (!s.loyalty_enabled && !editable) return null;

  return (
    <section
      className={
        "rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 " + (className ?? "")
      }
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="rounded-lg bg-primary/15 text-primary p-2">
          <Gift className="size-5" />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <h2 className="font-semibold">🎟️ {t.title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {s.loyalty_enabled ? offerText(s, lang) : t.off}
          </p>
          {s.loyalty_enabled && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              {Array.from({ length: Math.max(1, Math.min(12, s.loyalty_threshold)) }).map((_, i) => (
                <span
                  key={i}
                  className="size-6 rounded-full border border-primary/40 bg-background text-[11px] flex items-center justify-center text-muted-foreground"
                >
                  {i + 1}
                </span>
              ))}
              <span className="size-6 rounded-full bg-primary text-primary-foreground text-[11px] flex items-center justify-center">
                🎁
              </span>
              <span className="text-xs text-primary font-medium ms-1">{rewardText(s, lang)}</span>
            </div>
          )}
        </div>
        {editable && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <Pencil className="size-3.5" /> {t.edit}
          </Button>
        )}
      </div>

      {editable && <EditDialog open={open} onOpenChange={setOpen} settings={s} lang={lang} />}
    </section>
  );
}

function EditDialog({
  open, onOpenChange, settings, lang,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: LoyaltySettings;
  lang: "ar" | "en";
}) {
  const t = L[lang];
  const update = useUpdateLoyaltySettings();
  const [form, setForm] = useState<LoyaltySettings>(settings);

  useEffect(() => { if (open) setForm(settings); }, [open, settings]);

  const save = async () => {
    try {
      await update.mutateAsync({
        loyalty_enabled: form.loyalty_enabled,
        loyalty_threshold: Math.max(1, Number(form.loyalty_threshold) || 1),
        loyalty_discount_percent: Math.min(100, Math.max(0, Number(form.loyalty_discount_percent) || 0)),
        loyalty_reward_type: form.loyalty_reward_type,
        loyalty_reward_note: form.loyalty_reward_note ?? "",
      });
      toast.success(t.saved);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t.dialogTitle}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="loyalty-enabled">{t.enabled}</Label>
            <Switch
              id="loyalty-enabled"
              checked={form.loyalty_enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, loyalty_enabled: v }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loyalty-threshold">{t.threshold}</Label>
            <Input
              id="loyalty-threshold"
              type="number"
              min={1}
              max={20}
              value={form.loyalty_threshold}
              onChange={(e) => setForm((f) => ({ ...f, loyalty_threshold: Number(e.target.value) }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t.type}</Label>
            <Select
              value={form.loyalty_reward_type}
              onValueChange={(v) => setForm((f) => ({ ...f, loyalty_reward_type: v as LoyaltyRewardType }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="discount">{t.typeDiscount}</SelectItem>
                <SelectItem value="free">{t.typeFree}</SelectItem>
                <SelectItem value="custom">{t.typeCustom}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.loyalty_reward_type === "discount" && (
            <div className="space-y-1.5">
              <Label htmlFor="loyalty-percent">{t.percent}</Label>
              <Input
                id="loyalty-percent"
                type="number"
                min={0}
                max={100}
                value={form.loyalty_discount_percent}
                onChange={(e) => setForm((f) => ({ ...f, loyalty_discount_percent: Number(e.target.value) }))}
              />
            </div>
          )}

          {form.loyalty_reward_type === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="loyalty-note">{t.note}</Label>
              <Textarea
                id="loyalty-note"
                rows={2}
                value={form.loyalty_reward_note}
                onChange={(e) => setForm((f) => ({ ...f, loyalty_reward_note: e.target.value }))}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.cancel}</Button>
          <Button onClick={save} disabled={update.isPending}>{t.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
