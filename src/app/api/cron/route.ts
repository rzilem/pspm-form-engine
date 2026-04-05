import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { sendBookingReminder } from "@/lib/email";

const CRON_SECRET = process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || "";

/**
 * POST /api/cron — handles scheduled tasks
 * Called by Spark cron or Cloud Scheduler with action param
 * Actions: cleanup-holds, send-reminders, mark-completed
 */
export async function POST(request: Request) {
  try {
    // Simple auth — same admin password
    const authHeader = request.headers.get("authorization");
    if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { action: string };
    const { action } = body;

    const supabase = getSupabaseAdmin();

    switch (action) {
      case "cleanup-holds": {
        // Delete expired slot holds
        const { data, error } = await supabase
          .from("slot_holds")
          .delete()
          .lt("expires_at", new Date().toISOString())
          .select("id");

        const count = data?.length ?? 0;
        if (error) {
          logger.error("Cleanup holds failed", { error: error.message });
          return Response.json({ error: "Cleanup failed" }, { status: 500 });
        }
        logger.info("Cleaned up expired holds", { count });
        return Response.json({ success: true, cleaned: count });
      }

      case "send-reminders": {
        // Find confirmed reservations for tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split("T")[0];

        // Join amenity name and include manage_token in a single query — no N+1
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: upcoming, error } = await (supabase as any)
          .from("reservations")
          .select("id, confirmation_code, manage_token, resident_name, resident_email, reservation_date, start_time, end_time, amenities(name)")
          .eq("reservation_date", tomorrowStr)
          .eq("status", "confirmed");

        if (error) {
          logger.error("Reminder query failed", { error: error.message });
          return Response.json({ error: "Query failed" }, { status: 500 });
        }

        const count = upcoming?.length ?? 0;
        logger.info("Reminder candidates found", { count, date: tomorrowStr });

        // Send reminder emails
        let sent = 0;
        const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
        for (const r of upcoming ?? []) {
          const amenityName = (r.amenities as { name?: string } | null)?.name ?? "Amenity";
          try {
            await sendBookingReminder({
              email: r.resident_email,
              name: r.resident_name,
              confirmationCode: r.confirmation_code,
              amenityName,
              date: r.reservation_date,
              startTime: r.start_time,
              endTime: r.end_time,
              manageUrl: `${baseUrl}/booking/manage/${r.manage_token ?? ""}`,
            });
            sent++;
          } catch (err) {
            logger.error("Reminder email failed", { error: String(err), id: r.id });
          }
        }

        return Response.json({ success: true, reminders_due: count, sent });
      }

      case "mark-completed": {
        // Auto-mark confirmed reservations as completed 24 hours after end time
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];

        const { data, error } = await supabase
          .from("reservations")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("status", "confirmed")
          .lte("reservation_date", yesterdayStr)
          .select("id");

        const count = data?.length ?? 0;
        if (error) {
          logger.error("Mark completed failed", { error: error.message });
          return Response.json({ error: "Update failed" }, { status: 500 });
        }
        logger.info("Auto-completed reservations", { count });
        return Response.json({ success: true, completed: count });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Cron endpoint error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
