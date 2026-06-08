import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SYSTEM_PROMPT = `You are a booking parser for a private swimming pool in Bahrain. Parse Arabic/English mixed booking messages and return ONLY a valid JSON array. No markdown, no explanation, just raw JSON. Each booking object: {"date":"2026-MM-DD","session":"Night"|"Morning"|"Afternoon"|"Evening"|"Full Day","start_time":"HH:MM","end_time":"HH:MM","customer_name":string|null,"phone":string|null,"total_price":number|null,"paid_amount":number|null,"balance":number|null,"notes":string|null,"status":"confirmed"|"pending"} Rules: night/ليل=20:00-08:00, morning=08:00-12:00, afternoon=14:00-18:00, evening=18:00-22:00, fullday=08:00-23:59. "8-12"=08:00-12:00 "2-6"=14:00-18:00. Arabic ١٢٣٤٥٦٧٨٩٠=1234567890. /5=May /6=June year=2026. paid✅ no balance means paid=total balance=0. منتظر or waiting means pending else confirmed.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { message } = await req.json();
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) throw new Error("ANTHROPIC_API_KEY not set in secrets");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: "Parse these bookings:\n\n" + message }],
      }),
    });
    const data = await res.json();
    const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();
    const bookings = JSON.parse(raw);
    return new Response(JSON.stringify({ bookings }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
