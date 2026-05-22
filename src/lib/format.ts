export const fmtMoney = (n: number | string | null | undefined) => {
  const v = typeof n === "string" ? parseFloat(n) : n ?? 0;
  const locale = typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar-BH" : "en-BH";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "BHD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(v || 0);
};

export const fmtDate = (d: string | Date) => {
  const locale = typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar-BH" : "en-US";
  return new Date(d).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
};

export const fmtDateLong = (d: string | Date) => {
  const locale = typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar-BH" : "en-US";
  return new Date(d).toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
};

export const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
};

export const slotTimeRange = (start: string, end: string) =>
  `${fmtTime(start)} – ${fmtTime(end)}`;

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function computePaymentStatus(paid: number, total: number): "unpaid" | "partial" | "paid" {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

export function generateBookingNumber() {
  const t = Date.now().toString().slice(-7);
  return `BK-${t}`;
}
