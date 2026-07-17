import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SYSTEM_PROMPT = `You are a booking parser for a private swimming pool in Bahrain. Parse Arabic/English mixed booking messages and return ONLY a valid JSON array. No markdown, no explanation, just raw JSON. Each booking object: {"date":"2026-MM-DD","session":"Night"|"Morning"|"Afternoon"|"Evening"|"Full Day","start_time":"HH:MM","end_time":"HH:MM","customer_name":string|null,"phone":string|null,"total_price":number|null,"paid_amount":number|null,"balance":number|null,"notes":string|null,"status":"confirmed"|"pending"} Rules: night/ليل=20:00-08:00, morning=08:00-12:00, afternoon=14:00-18:00, evening=18:00-22:00, fullday=08:00-23:59. "8am-5pm"=08:00-17:00, "7:30pm-11:30pm"=19:30-23:30, "2pm-6pm"=14:00-18:00, "8pm-12am"=20:00-23:59. Arabic ١٢٣٤٥٦٧٨٩٠=1234567890. "/5" or "5/"=May, "/6" or "6/"=June, "/7"=July, year=2026 unless specified. "paid" or "full paid" with no balance means paid_amount=total_price, balance=0. "Balance: X" means balance=X and paid_amount=total_price-X. Insurance is separate refundable deposit — include in notes as "Insurance: XBD" not in total_price. "منتظر" or "waiting" or "pending" means status=pending; else confirmed.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractJsonArray(text: string): unknown {
  let s = text.replace(/```json|```/gi, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  s = s.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(s);
  } catch (e) {
    const objs: string[] = [];
    let depth = 0, inStr = false, esc = false, cur = "";
    for (let i = 1; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        cur += ch;
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; cur += ch; continue; }
      if (ch === "{") { if (depth === 0) cur = ""; depth++; cur += ch; continue; }
      if (ch === "}") { depth--; cur += ch; if (depth === 0) objs.push(cur); continue; }
      if (depth > 0) cur += ch;
    }
    if (objs.length === 0) throw e;
    return JSON.parse("[" + objs.join(",") + "]");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { message } = await req.json();
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) throw new Error("LOVABLE_API_KEY not set");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "Parse these bookings:\n\n" + message },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let details: unknown = errText;
      try { details = JSON.parse(errText); } catch { /* keep text */ }
      if (res.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly.", details }), {
          status: 429, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      if (res.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to your Lovable workspace.", details }), {
          status: 402, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error", details }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) {
      return new Response(JSON.stringify({ error: "Empty response from model", details: data }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const bookings = extractJsonArray(raw);
    return new Response(JSON.stringify({ bookings }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
