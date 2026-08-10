import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const BLOCKING = new Set(["new", "confirmed", "completed"]);

const VENUE_INFO = `
- الاسم: The Private Pool (استراحة خاصة مع مسبح)
- التفاصيل والصور: https://privatepool.edgeone.app/
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
            return {
              slots: rows.map((s) => {
                const list = Array.isArray(s.bookings) ? s.bookings : s.bookings ? [s.bookings] : [];
                const booked = list.some((b) => b && b.id && BLOCKING.has(b.booking_status ?? "confirmed"));
                return {
                  date: s.date,
                  from: s.start_time.slice(0, 5),
                  to: s.end_time.slice(0, 5),
                  price_bhd: s.price === null ? null : Number(s.price),
                  status: s.is_closed ? "closed" : booked ? "booked" : "available",
                };
              }),
            };
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
