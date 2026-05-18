import { cn } from "@/lib/utils";

const bookingStyles: Record<string, string> = {
  available: "bg-success/15 text-success border-success/30",
  new: "bg-warning/20 text-warning-foreground border-warning/40",
  confirmed: "bg-destructive/15 text-destructive border-destructive/30",
  completed: "bg-info/15 text-info border-info/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const paymentStyles: Record<string, string> = {
  unpaid: "bg-destructive/15 text-destructive border-destructive/30",
  partial: "bg-warning/20 text-warning-foreground border-warning/40",
  paid: "bg-success/15 text-success border-success/30",
};

export function BookingStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border capitalize", bookingStyles[status] ?? bookingStyles.available)}>
      {status}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const label = status === "partial" ? "Partially Paid" : status === "paid" ? "Fully Paid" : "Unpaid";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border", paymentStyles[status] ?? paymentStyles.unpaid)}>
      {label}
    </span>
  );
}
