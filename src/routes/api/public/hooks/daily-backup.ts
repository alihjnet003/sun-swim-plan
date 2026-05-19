import { createFileRoute } from "@tanstack/react-router";
import { runDailyBackup } from "@/lib/backup.server";

// Cron-triggered daily backup. Public path; secured by the apikey header
// that pg_cron attaches (Supabase publishable key).
export const Route = createFileRoute("/api/public/hooks/daily-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
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
