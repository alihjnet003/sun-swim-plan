// Server-only helper. Generates an .xlsx of all core tables and uploads to the
// private "backups" storage bucket, logging metadata in public.backups.
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TABLES = ["customers", "booking_slots", "bookings", "payments", "reminders", "audit_logs", "user_roles", "profiles"] as const;

export async function runDailyBackup() {
  const rowCounts: Record<string, number> = {};
  const wb = XLSX.utils.book_new();

  for (const table of TABLES) {
    const { data, error } = await supabaseAdmin.from(table).select("*");
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    const rows = data ?? [];
    rowCounts[table] = rows.length;
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows.map((r) => normalize(r as Record<string, unknown>)))
      : XLSX.utils.aoa_to_sheet([["(no rows)"]]);
    XLSX.utils.book_append_sheet(wb, ws, table.slice(0, 31));
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:T]/g, "-").replace(/\..+/, "");
  const filename = `aqua-backup-${stamp}.xlsx`;
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${filename}`;

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const bytes = new Uint8Array(buf);

  const { error: upErr } = await supabaseAdmin.storage.from("backups").upload(path, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (upErr) {
    await supabaseAdmin.from("backups").insert({
      filename, storage_path: path, row_counts: rowCounts, status: "failed", error_message: upErr.message,
    });
    throw new Error(upErr.message);
  }

  const { error: logErr } = await supabaseAdmin.from("backups").insert({
    filename, storage_path: path, row_counts: rowCounts, file_size_bytes: bytes.byteLength, status: "success",
  });
  if (logErr) throw new Error(logErr.message);

  return { filename, path, size: bytes.byteLength, row_counts: rowCounts };
}

function normalize(r: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v && typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}
