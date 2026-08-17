import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const BLOCKING = new Set(["new", "confirmed", "completed"]);

const VENUE_INFO = `
- الاسم: The Private Pool (استراحة خاصة مع مسبح)

- الموقع على الخرائط: https://maps.app.goo.gl/R2MNAkCgdvFsQqn49?g_st=com.google.maps.preview.copy
- أرقام التواصل والواتساب: 33338208 و 66769202
- الدفع / بنفت بي (BenefitPay): 33338208
- تثبيت الحجز: يتم تثبيت الحجز بعد تحويل مبلغ الحجز عبر بنفت بي على الرقم 33338208 وإرسال صورة التحويل على الواتساب 33338208.
- يمكن للزائر اختيار الفترات المتاحة من التقويم في نفس الصفحة وإرسال طلب حجز، ويتم مراجعته والتأكيد عبر الواتساب.
`.trim();

function localToday() {
  return new Date().toISOString().slice(0, 10);
}

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(body.messages)) {
          return new Response("Messages are required", { status: 400 });
        }
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
        const supabaseKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const gateway = createLovableAiGatewayProvider(key);

        const getAvailability = tool({
          description:
            "Get the pool session slots (availability and price) for a date range. Use it for any question about free dates, times or prices.",
          inputSchema: z.object({
            from_date: z.string().describe("Start date, format YYYY-MM-DD"),
            to_date: z.string().describe("End date, format YYYY-MM-DD"),
          }),
          execute: async ({ from_date, to_date }) => {
            const { data, error } = await supabase
              .from("booking_slots")
              .select("date, start_time, end_time, is_closed, price, bookings(id, booking_status)")
              .gte("date", from_date)
              .lte("date", to_date)
              .order("date")
              .order("start_time");
            if (error) return { error: error.message };
            const rows = (data ?? []) as unknown as {
              date: string;
              start_time: string;
              end_time: string;
              is_closed: boolean;
              price: number | string | null;
              bookings: { id: string; booking_status?: string }[] | null;
            }[];
            const lines = rows.map((s) => {
              const list = Array.isArray(s.bookings) ? s.bookings : s.bookings ? [s.bookings] : [];
              const booked = list.some((b) => b && b.id && BLOCKING.has(b.booking_status ?? "confirmed"));
              const status = s.is_closed ? "closed" : booked ? "booked" : "available";
              const price = s.price === null ? "-" : Number(s.price).toFixed(3);
              return `${s.date} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)} ${status} ${price}`;
            });
            const available = lines.filter((l) => l.includes(" available "));
            const shown = available.slice(0, 40);
            return {
              legend: "date from-to status price_bhd",
              available_count: available.length,
              truncated: available.length > shown.length,
              available: shown,
            };

          },
        });

        const toMin = (t: string) => {
          const [h, m] = t.slice(0, 5).split(":").map(Number);
          return (h || 0) * 60 + (m || 0);
        };

        const createBooking = tool({
          description:
            "Submit a booking request for the customer after they confirmed the exact date, time and their name+phone. The request goes to the staff as 'pending' until approved.",
          inputSchema: z.object({
            date: z.string().describe("Session start date, YYYY-MM-DD"),
            start_time: z.string().describe("Start time HH:MM (24h)"),
            end_time: z.string().describe("End time HH:MM (24h). May be earlier than start for overnight."),
            customer_name: z.string().min(2),
            phone: z.string().min(6),
            whatsapp: z.string().optional(),
            email: z.string().optional(),
            people_count: z.number().int().positive().optional(),
            notes: z.string().optional(),
          }),
          execute: async (input) => {
            const nextDay = (iso: string) => {
              const d = new Date(iso + "T00:00:00Z");
              d.setUTCDate(d.getUTCDate() + 1);
              return d.toISOString().slice(0, 10);
            };
            const start = toMin(input.start_time);
            const end = toMin(input.end_time);
            const overnight = end <= start;
            const endDate = overnight ? nextDay(input.date) : input.date;

            const { data, error } = await supabase
              .from("booking_slots")
              .select("id, date, start_time, end_time, is_closed, bookings(id, booking_status)")
              .gte("date", input.date)
              .lte("date", endDate)
              .order("date")
              .order("start_time");
            if (error) return { ok: false, error: error.message };

            const rows = (data ?? []) as unknown as {
              id: string;
              date: string;
              start_time: string;
              end_time: string;
              is_closed: boolean;
              bookings: { id: string; booking_status?: string }[] | null;
            }[];

            const abs = (d: string, t: string) => (d === input.date ? 0 : 1440) + toMin(t);
            const wantStart = abs(input.date, input.start_time);
            const wantEnd = overnight ? 1440 + end : end;

            const picked = rows
              .filter((s) => {
                if (s.is_closed) return false;
                const list = Array.isArray(s.bookings) ? s.bookings : s.bookings ? [s.bookings] : [];
                if (list.some((b) => b && b.id && BLOCKING.has(b.booking_status ?? "confirmed"))) return false;
                const a = abs(s.date, s.start_time);
                const e = a + (toMin(s.end_time) - toMin(s.start_time) || 1440 - toMin(s.start_time));
                return a >= wantStart && e <= wantEnd;
              })
              .sort((a, b) => abs(a.date, a.start_time) - abs(b.date, b.start_time));

            if (picked.length === 0) {
              return { ok: false, error: "no_matching_free_slots" };
            }
            // must fully cover the window and be consecutive
            let cursor = wantStart;
            for (const s of picked) {
              if (abs(s.date, s.start_time) !== cursor) return { ok: false, error: "slots_not_consecutive" };
              cursor = abs(s.date, s.start_time) + (toMin(s.end_time) - toMin(s.start_time) || 1440 - toMin(s.start_time));
            }
            if (cursor < wantEnd) return { ok: false, error: "window_not_fully_available" };

            const { data: res, error: rpcError } = await supabase.rpc("public_book_consecutive_slots", {
              _slot_ids: picked.map((s) => s.id),
              _customer_name: input.customer_name,
              _phone: input.phone,
              _whatsapp: input.whatsapp ?? input.phone,
              _email: input.email ?? null,
              _people_count: input.people_count ?? 1,
              _notes: input.notes ?? null,
            });
            if (rpcError) return { ok: false, error: rpcError.message };
            return { ok: true, status: "pending_approval", result: res };
          },
        });

        const result = streamText({
          model: gateway("google/gemini-3.6-flash"),
          stopWhen: stepCountIs(50),
          system: `أنت مساعد حجوزات ودود لاستراحة "The Private Pool" في البحرين.
تاريخ اليوم: ${localToday()}. العملة: دينار بحريني (BHD) بثلاث خانات عشرية.

معلومات الاستراحة:
${VENUE_INFO}

قواعد:
- جاوب بنفس لغة السائل (عربي أو إنجليزي)، وبأسلوب مختصر وواضح.
- لمعرفة الفترات المتاحة أو الأسعار استخدم أداة getAvailability دائماً — لا تخمّن أبداً.
- اعرض الفترات كقائمة: التاريخ، الوقت من–إلى، السعر، والحالة.
- لا تكشف أي معلومات عن العملاء أو الحجوزات الخاصة، فقط "متاح / محجوز / مغلق".
- لتثبيت الحجز وجّه العميل للدفع عبر بنفت بي على 33338208 ثم إرسال صورة التحويل على الواتساب.`,
          messages: await convertToModelMessages(body.messages as UIMessage[]),
          tools: { getAvailability },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages as UIMessage[],
        });
      },
    },
  },
});
