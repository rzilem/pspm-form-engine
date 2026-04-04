import { getSupabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("amenities")
      .select(`
        id, slug, name, community, description, deposit_cents,
        max_capacity, location, rules_url, settings,
        availability_rules (day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes, max_bookings_per_day)
      `)
      .eq("is_active", true)
      .order("name");

    if (error) {
      logger.error("Failed to fetch amenities", { error: error.message });
      return Response.json({ error: "Failed to fetch amenities" }, { status: 500 });
    }

    return Response.json({ amenities: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Amenities endpoint error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
