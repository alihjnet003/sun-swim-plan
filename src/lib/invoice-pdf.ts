import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
// @ts-ignore - no bundled types
import { ArabicShaper } from "arabic-persian-reshaper";
import { bookingRange, fmtDate, fmtMoney, fmtTime } from "./format";
import type { BookingWithRelations } from "./queries";

const ARABIC = /[\u0600-\u06FF]/;

/** Shape Arabic letters into their contextual forms and lay them out right-to-left. */
function ar(text: string | null | undefined): string {
  const t = text ?? "";
  if (!ARABIC.test(t)) return t;
  const shaped: string = ArabicShaper.convertArabic(t);
  // Reverse the whole string for RTL, then restore the order of LTR runs
  // (latin words, digits, currency codes) so they stay readable.
  const reversed = Array.from(shaped).reverse().join("");
  return reversed.replace(/[0-9A-Za-z][0-9A-Za-z.,:/-]*/g, (run) =>
    Array.from(run).reverse().join(""),
  );
}

async function registerArabicFont(doc: jsPDF) {
  const { AMIRI_REGULAR_BASE64 } = await import("./fonts/amiri");
  doc.addFileToVFS("Amiri-Regular.ttf", AMIRI_REGULAR_BASE64);
  doc.addFont("Amiri-Regular.ttf", "Amiri", "normal");
  doc.addFont("Amiri-Regular.ttf", "Amiri", "bold");
}

export async function generateInvoicePDF(b: BookingWithRelations, action: "save" | "print" = "save") {
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth();

  const hasArabic = ARABIC.test(
    `${b.customer?.full_name ?? ""} ${b.notes ?? ""} ${b.slot?.label ?? ""}`,
  );
  let FONT = "helvetica";
  if (hasArabic) {
    await registerArabicFont(doc);
    FONT = "Amiri";
  }
  const setFont = (style: "normal" | "bold") => doc.setFont(FONT, style);

  // Header band
  doc.setFillColor(46, 107, 138);
  doc.rect(0, 0, W, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  setFont("bold");
  doc.text("Aqua Pool — Invoice", 14, 20);
  doc.setFontSize(10);
  setFont("normal");
  doc.text("Swimming Pool Booking Management", 14, 27);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(11);

  // Invoice meta
  const top = 44;
  setFont("bold");
  doc.text("Invoice #", 14, top);
  doc.text("Booking #", 14, top + 6);
  doc.text("Issue Date", 14, top + 12);
  setFont("normal");
  doc.text(`INV-${b.booking_number}`, 45, top);
  doc.text(b.booking_number, 45, top + 6);
  doc.text(fmtDate(new Date()), 45, top + 12);

  setFont("bold");
  doc.text("Bill To", W - 90, top);
  setFont("normal");
  doc.text(ar(b.customer?.full_name) || "—", W - 90, top + 6);
  doc.text(b.customer?.phone ?? "", W - 90, top + 12);
  if (b.customer?.email) doc.text(b.customer.email, W - 90, top + 18);

  // Booking details table
  const range = bookingRange(b);
  const timeCell = range.crossesMidnight
    ? `${fmtTime(range.startTime)} – ${fmtTime(range.endTime)} (+1)`
    : `${fmtTime(range.startTime)} – ${fmtTime(range.endTime)}`;
  const dateCell = range.crossesMidnight
    ? `${fmtDate(range.startDate)} → ${fmtDate(range.endDate)}`
    : range.startDate ? fmtDate(range.startDate) : "—";
  autoTable(doc, {
    startY: top + 28,
    head: [["Booking Date", "Time Slot", "Duration", "Guests", "Status"]],
    body: [[
      ar(dateCell),
      timeCell,
      `${range.hours.toFixed(1)}h`,
      String(b.people_count),
      b.booking_status,
    ]],
    styles: { font: FONT },
    headStyles: { fillColor: [46, 107, 138], font: FONT, fontStyle: "bold" },
  });

  // Amounts
  const remaining = Number(b.subtotal) - Number(b.discount) - Number(b.paid_amount);
  autoTable(doc, {
    head: [["Description", "Amount"]],
    body: [
      ["Base booking amount", fmtMoney(b.subtotal)],
      ["Discount", `- ${fmtMoney(b.discount)}`],
      ["Deposit", fmtMoney(b.deposit_amount)],
      ["Paid amount", fmtMoney(b.paid_amount)],
      [{ content: "Remaining balance", styles: { fontStyle: "bold" } }, { content: fmtMoney(remaining), styles: { fontStyle: "bold" } }],
    ],
    styles: { font: FONT },
    headStyles: { fillColor: [46, 107, 138], font: FONT, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" } },
  });

  if (b.notes) {
    const y = (doc as any).lastAutoTable.finalY + 10;
    setFont("bold");
    doc.text("Notes", 14, y);
    setFont("normal");
    const lines = doc.splitTextToSize(b.notes, W - 28) as string[];
    doc.text(lines.map((l) => ar(l)), 14, y + 6);
  }

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Thank you for your booking!", 14, doc.internal.pageSize.getHeight() - 12);

  if (action === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  } else {
    doc.save(`invoice-${b.booking_number}.pdf`);
  }
}
