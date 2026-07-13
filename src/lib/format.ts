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

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

/**
 * Compute the effective start/end for a booking, accounting for optional
 * overnight bookings (end_date > slot.date, or custom_end_time <= custom_start_time).
 */
export function bookingRange(b: {
  slot?: { date: string; start_time: string; end_time: string } | null;
  custom_start_time?: string | null;
  custom_end_time?: string | null;
  end_date?: string | null;
}) {
  const startDate = b.slot?.date ?? "";
  const startTime = (b.custom_start_time ?? b.slot?.start_time ?? "00:00:00").slice(0, 5);
  const endTime   = (b.custom_end_time   ?? b.slot?.end_time   ?? "00:00:00").slice(0, 5);
  const crossesMidnight =
    !!b.end_date && b.end_date !== startDate
      ? true
      : toMin(endTime) <= toMin(startTime);
  const endDate = b.end_date && b.end_date !== startDate
    ? b.end_date
    : crossesMidnight && startDate
      ? nextDay(startDate)
      : startDate;
  const hours = crossesMidnight
    ? (24 * 60 - toMin(startTime) + toMin(endTime)) / 60
    : (toMin(endTime) - toMin(startTime)) / 60;
  return { startDate, startTime, endDate, endTime, crossesMidnight, hours };
}

export function nextDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function bookingTimeRangeLabel(b: Parameters<typeof bookingRange>[0]) {
  const r = bookingRange(b);
  return r.crossesMidnight
    ? `${fmtTime(r.startTime)} – ${fmtTime(r.endTime)} (+1)`
    : `${fmtTime(r.startTime)} – ${fmtTime(r.endTime)}`;
}
