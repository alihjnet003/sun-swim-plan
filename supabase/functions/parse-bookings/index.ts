import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SYSTEM_PROMPT = `You are a booking parser for a private swimming pool in Bahrain. Parse Arabic/English mixed booking messages and return ONLY a valid JSON array. No markdown, no explanation, just raw JSON. Each booking object: {"date":"2026-MM-DD","session":"Night"|"Morning"|"Afternoon"|"Evening"|"Full Day","start_time":"HH:MM","end_time":"HH:MM","customer_name":string|null,"phone":string|null,"total_price":number|null,"paid_amount":number|null,"balance":number|null,"notes":string|null,"status":"confirmed"|"pending"} Rules: night/ليل=20:00-08:00, morning=08:00-12:00, afternoon=14:00-18:00, evening=18:00-22:00, fullday=08:00-23:59. "8-12"=08:00-12:00 "2-6"=14:00-18:00. Arabic ١٢٣٤٥٦٧٨٩٠=1234567890. /5=May /6=June year=2026. paid✅ no balance means paid=total balance=0. منتظر or waiting means pending else confirmed.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractJsonArray(text: string): unknown {
  let s = text.replace(/```json|```/gi, "").trim();
  // Find first '[' and last ']'
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  // Remove trailing commas
  s = s.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(s);
  } catch (e) {
    // Attempt to repair truncation: keep only complete objects
    const objs: string[] = [];
    let depth = 0;
    let inStr = false;
    let esc = false;
    let cur = "";
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
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: "Parse these bookings:\n\n" + message }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message ?? "Anthropic API error", details: data }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const raw = (data.content?.[0]?.text ?? "").trim();
    if (!raw) {
      return new Response(JSON.stringify({ error: "Empty response from model", details: data }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const bookings = extractJsonArray(raw);
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
