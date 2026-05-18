import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Customer = Database["public"]["Tables"]["customers"]["Row"];
export type Slot = Database["public"]["Tables"]["booking_slots"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];

export type BookingWithRelations = Booking & {
  customer: Customer | null;
  slot: Slot | null;
};

const SELECT_BOOKING = "*, customer:customers(*), slot:booking_slots(*)";

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
