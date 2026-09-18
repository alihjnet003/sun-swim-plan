import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Offer {
  id: string;
  title_ar: string;
  title_en: string;
  slots_count: number;
  price_normal: number;
  price_holiday: number;
  exclude_holidays: boolean;
  per_hour: boolean;
  bundle_hours: number;
  free_hours: number;
  is_active: boolean;
  sort_order: number;
  show_in_popup: boolean;
  image_url: string;
}

/** Hours a slot covers; 23:59:59 counts as midnight. */
export function slotHours(s: { start_time: string; end_time: string }): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const start = toMin(s.start_time);
  let end = s.end_time.startsWith("23:59") || s.end_time.startsWith("24:") ? 1440 : toMin(s.end_time);
  if (end <= start) end += 1440;
  return (end - start) / 60;
}

export type OfferDraft = Omit<Offer, "id">;

export const EMPTY_OFFER: OfferDraft = {
  title_ar: "",
  title_en: "",
  slots_count: 2,
  price_normal: 0,
  price_holiday: 0,
  exclude_holidays: false,
  per_hour: false,
  is_active: true,
  sort_order: 0,
  show_in_popup: false,
  image_url: "",
};

/** Holiday sessions: Thursday evening, all Friday, Saturday mornings. */
export function isHolidaySession(date: string, startTime: string): boolean {
  const dow = new Date(date + "T00:00:00").getDay();
  const h = parseInt(startTime.slice(0, 2), 10);
  if (dow === 5) return true;
  if (dow === 4 && h >= 14) return true;
  if (dow === 6 && h < 14) return true;
  return false;
}

export function useOffers(activeOnly = false) {
  return useQuery({
    queryKey: ["offers", activeOnly],
    queryFn: async (): Promise<Offer[]> => {
      let q = supabase
        .from("offers")
        .select("id, title_ar, title_en, slots_count, price_normal, price_holiday, exclude_holidays, per_hour, is_active, sort_order, show_in_popup, image_url")
        .order("sort_order")
        .order("slots_count");
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((o) => ({
        ...o,
        price_normal: Number(o.price_normal),
        price_holiday: Number(o.price_holiday),
      })) as Offer[];
    },
    refetchInterval: 60000,
  });
}

export function useSaveOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (offer: OfferDraft & { id?: string }) => {
      const payload = {
        title_ar: offer.title_ar,
        title_en: offer.title_en,
        slots_count: Math.max(1, Number(offer.slots_count) || 1),
        price_normal: Math.max(0, Number(offer.price_normal) || 0),
        price_holiday: Math.max(0, Number(offer.price_holiday) || 0),
        exclude_holidays: !!offer.exclude_holidays,
        per_hour: !!offer.per_hour,
        is_active: offer.is_active,
        sort_order: Number(offer.sort_order) || 0,
        show_in_popup: !!offer.show_in_popup,
        image_url: offer.image_url ?? "",
      };
      const { error } = offer.id
        ? await supabase.from("offers").update(payload).eq("id", offer.id)
        : await supabase.from("offers").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
}

export function useDeleteOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("offers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
}

/** The active per-hour offer (5 BHD/hour), if any. */
export function hourlyOffer(offers: Offer[]): Offer | null {
  return offers.find((o) => o.is_active && o.per_hour) ?? null;
}

/** Bundle price for the picked sessions, or null when no offer matches. */
export function matchOffer(
  offers: Offer[],
  picked: { date: string; start_time: string; end_time?: string }[],
): { offer: Offer; price: number } | null {
  if (picked.length < 1) return null;
  const holiday = picked.some((s) => isHolidaySession(s.date, s.start_time));

  // Non-holiday time is billed per hour when an hourly offer is active.
  if (!holiday && picked.every((s) => s.end_time)) {
    const h = hourlyOffer(offers);
    if (h) {
      const hours = picked.reduce(
        (sum, s) => sum + slotHours({ start_time: s.start_time, end_time: s.end_time! }),
        0,
      );
      return { offer: h, price: Math.round(h.price_normal * Math.round(hours) * 1000) / 1000 };
    }
  }

  const offer = offers.find(
    (o) => o.is_active && !o.per_hour && o.slots_count === picked.length && !(holiday && o.exclude_holidays),
  );
  if (!offer) return null;
  return { offer, price: holiday ? offer.price_holiday : offer.price_normal };
}

/** The offer the admin picked to show in the public welcome popup. */
export function usePopupOffer() {
  const { data: offers = [], ...rest } = useOffers(true);
  return { offer: offers.find((o) => o.show_in_popup) ?? null, ...rest };
}

export function offerTitle(o: Offer, lang: "ar" | "en") {
  return (lang === "ar" ? o.title_ar : o.title_en) || o.title_ar || o.title_en;
}
