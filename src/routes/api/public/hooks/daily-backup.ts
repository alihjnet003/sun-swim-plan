import { createFileRoute } from "@tanstack/react-router";
import { runDailyBackup } from "@/lib/backup.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Cron-triggered daily backup. Authenticated via a server-only shared secret
// (BACKUP_WEBHOOK_SECRET) — never the publishable/anon key, which is public.
export const Route = createFileRoute("/api/public/hooks/daily-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-backup-secret") ?? request.headers.get("apikey");
        const expected = process.env.BACKUP_WEBHOOK_SECRET;
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Rate-limit: refuse if a successful backup ran within the last hour.
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabaseAdmin
          .from("backups")
          .select("id")
          .eq("status", "success")
          .gte("created_at", oneHourAgo)
          .limit(1);
        if (recent && recent.length > 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "A backup already ran within the last hour." }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }

        try {
          const result = await runDailyBackup();
          return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
