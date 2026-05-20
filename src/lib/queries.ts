import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Customer = Database["public"]["Tables"]["customers"]["Row"];
export type Slot = Database["public"]["Tables"]["booking_slots"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
export type Reminder = Database["public"]["Tables"]["reminders"]["Row"];

export type BookingWithRelations = Booking & {
  customer: Customer | null;
  slot: Slot | null;
};

const SELECT_BOOKING = "*, customer:customers(*), slot:booking_slots(*)";

export function useProfilesMap() {
  return useQuery({
    queryKey: ["profiles", "map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      const map = new Map<string, string>();
      (data ?? []).forEach((p) => map.set(p.id, p.full_name ?? "Unknown user"));
      return map;
    },
  });
}

export function useBookingPayments(bookingId: string | undefined) {
  return useQuery({
    queryKey: ["payments", bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("booking_id", bookingId!)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as Payment[];
    },
  });
}

export function useBookingAuditLog(bookingId: string | undefined) {
  return useQuery({
    queryKey: ["audit", bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("booking_id", bookingId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AuditLog[];
    },
  });
}

export function useBookingReminders(bookingId: string | undefined) {
  return useQuery({
    queryKey: ["reminders", bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reminders")
        .select("*")
        .eq("booking_id", bookingId!)
        .order("sent_at", { ascending: false });
      if (error) throw error;
      return data as Reminder[];
    },
  });
}

export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("full_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useSlotsForMonth(year: number, month: number) {
  const start = new Date(year, month, 1).toISOString().slice(0, 10);
  const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  return useQuery({
    queryKey: ["slots", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_slots")
        .select("*")
        .gte("date", start)
        .lte("date", end)
        .order("date")
        .order("start_time");
      if (error) throw error;
      return data;
    },
  });
}

export function useBookingsForMonth(year: number, month: number) {
  const start = new Date(year, month, 1).toISOString().slice(0, 10);
  const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  return useQuery({
    queryKey: ["bookings", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(SELECT_BOOKING)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as BookingWithRelations[];
      return rows.filter((b) => b.slot && b.slot.date >= start && b.slot.date <= end);
    },
  });
}

export function useAllBookings() {
  return useQuery({
    queryKey: ["bookings", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(SELECT_BOOKING)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BookingWithRelations[];
    },
  });
}

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: ["booking", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(SELECT_BOOKING)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as BookingWithRelations;
    },
  });
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["bookings"] });
    qc.invalidateQueries({ queryKey: ["slots"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["booking"] });
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
    qc.invalidateQueries({ queryKey: ["reminders"] });
  };
}

export function useDeleteBooking() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bookings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
