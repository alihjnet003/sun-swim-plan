import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LoyaltyRewardType = "discount" | "free" | "custom";

export interface LoyaltySettings {
  loyalty_enabled: boolean;
  loyalty_threshold: number;
  loyalty_discount_percent: number;
  loyalty_reward_type: LoyaltyRewardType;
  loyalty_reward_note: string;
}

export const DEFAULT_LOYALTY: LoyaltySettings = {
  loyalty_enabled: true,
  loyalty_threshold: 4,
  loyalty_discount_percent: 25,
  loyalty_reward_type: "discount",
  loyalty_reward_note: "",
};

const COLUMNS =
  "loyalty_enabled, loyalty_threshold, loyalty_discount_percent, loyalty_reward_type, loyalty_reward_note";

/** Loyalty offer settings — readable by anyone (public booking page included). */
export function useLoyaltySettings() {
  return useQuery({
    queryKey: ["loyalty-settings"],
    queryFn: async (): Promise<LoyaltySettings> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select(COLUMNS)
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return { ...DEFAULT_LOYALTY, ...(data as Partial<LoyaltySettings> | null) };
    },
    refetchInterval: 60000,
  });
}

export function useUpdateLoyaltySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<LoyaltySettings>) => {
      const { error } = await supabase
        .from("app_settings")
        .update({ ...patch, updated_at: new Date().toISOString() } as never)
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty-settings"] });
      qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
  });
}

/** Human-readable reward, e.g. "25% off" / "خصم 25%". */
export function rewardText(s: LoyaltySettings, lang: "ar" | "en") {
  if (s.loyalty_reward_type === "free") return lang === "ar" ? "حجز مجاني" : "a free booking";
  if (s.loyalty_reward_type === "custom") {
    return s.loyalty_reward_note || (lang === "ar" ? "عرض خاص" : "a special offer");
  }
  const p = Number(s.loyalty_discount_percent);
  return lang === "ar" ? `خصم ${p}%` : `${p}% off`;
}

/** Full offer sentence for the loyalty card. */
export function offerText(s: LoyaltySettings, lang: "ar" | "en") {
  const n = s.loyalty_threshold;
  return lang === "ar"
    ? `احجز ${n} مرات واحصل في المرة ${n + 1} على ${rewardText(s, "ar")}`
    : `Book ${n} times and get ${rewardText(s, "en")} on visit ${n + 1}`;
}
