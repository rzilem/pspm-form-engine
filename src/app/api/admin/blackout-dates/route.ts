import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";

/** GET /api/admin/blackout-dates — list blackout dates */
export async function GET(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const amenitySlug = searchParams.get("amenity");

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("blackout_dates")
      .select("*, amenities(name, slug)")
      .order("date", { ascending: true });

    if (amenitySlug) {
      const { data: am } = await supabase.from("amenities").select("id").eq("slug", amenitySlug).single();
      if (am) query = query.eq("amenity_id", am.id);
    }

    const { data, error } = await query;

    if (error) {
      logger.error("Admin list blackout dates error", { error: error.message });
      return Response.json({ error: "Failed to fetch blackout dates" }, { status: 500 });
    }

    return Response.json({ blackout_dates: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Admin blackout dates GET error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/admin/blackout-dates — add blackout date */
export async function POST(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const body = (await request.json()) as {
      amenity_slug: string;
      date: string;
      reason?: string;
    };

    if (!body.amenity_slug || !body.date) {
      return Response.json({ error: "Missing amenity_slug or date" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: amenity } = await supabase
      .from("amenities")
      .select("id")
      .eq("slug", body.amenity_slug)
      .single();

    if (!amenity) {
      return Response.json({ error: "Amenity not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("blackout_dates")
      .insert({
        amenity_id: amenity.id,
        date: body.date,
        reason: body.reason ?? null,
        created_by: "admin",
      })
      .select("id, date, reason")
      .single();

    if (error) {
      if (error.code === "23505") {
        return Response.json({ error: "Blackout date already exists" }, { status: 409 });
      }
      logger.error("Admin add blackout date error", { error: error.message });
      return Response.json({ error: "Failed to add blackout date" }, { status: 500 });
    }

    return Response.json({ success: true, blackout_date: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Admin blackout dates POST error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE /api/admin/blackout-dates — remove blackout date */
export async function DELETE(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("blackout_dates")
      .delete()
      .eq("id", id);

    if (error) {
      logger.error("Admin delete blackout date error", { error: error.message });
      return Response.json({ error: "Failed to remove blackout date" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Admin blackout dates DELETE error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
