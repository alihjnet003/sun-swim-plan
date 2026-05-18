import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtMoney, slotTimeRange } from "./format";
import type { BookingWithRelations } from "./queries";

export function generateInvoicePDF(b: BookingWithRelations, action: "save" | "print" = "save") {
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(46, 107, 138);
  doc.rect(0, 0, W, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Aqua Pool — Invoice", 14, 20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Swimming Pool Booking Management", 14, 27);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(11);

  // Invoice meta
  const top = 44;
  doc.setFont("helvetica", "bold");
  doc.text("Invoice #", 14, top);
  doc.text("Booking #", 14, top + 6);
  doc.text("Issue Date", 14, top + 12);
  doc.setFont("helvetica", "normal");
  doc.text(`INV-${b.booking_number}`, 45, top);
  doc.text(b.booking_number, 45, top + 6);
  doc.text(fmtDate(new Date()), 45, top + 12);

  doc.setFont("helvetica", "bold");
  doc.text("Bill To", W - 90, top);
  doc.setFont("helvetica", "normal");
  doc.text(b.customer?.full_name ?? "—", W - 90, top + 6);
  doc.text(b.customer?.phone ?? "", W - 90, top + 12);
  if (b.customer?.email) doc.text(b.customer.email, W - 90, top + 18);

  // Booking details table
  autoTable(doc, {
    startY: top + 28,
    head: [["Booking Date", "Time Slot", "Guests", "Status"]],
    body: [[
      b.slot ? fmtDate(b.slot.date) : "—",
      b.slot ? slotTimeRange(b.slot.start_time, b.slot.end_time) : "—",
      String(b.people_count),
      b.booking_status,
    ]],
    headStyles: { fillColor: [46, 107, 138] },
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
    headStyles: { fillColor: [46, 107, 138] },
    columnStyles: { 1: { halign: "right" } },
  });

  if (b.notes) {
    const y = (doc as any).lastAutoTable.finalY + 10;
    doc.setFont("helvetica", "bold");
    doc.text("Notes", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(b.notes, W - 28), 14, y + 6);
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
