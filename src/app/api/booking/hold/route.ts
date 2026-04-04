import { getSupabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const HOLD_DURATION_MINUTES = 15;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      amenity_id?: string;
      date?: string;
      start_time?: string;
      end_time?: string;
      session_id?: string;
    };

    const { amenity_id, date, start_time, end_time, session_id } = body;

    if (!amenity_id || !date || !start_time || !end_time || !session_id) {
      return Response.json(
        { error: "Missing required fields: amenity_id, date, start_time, end_time, session_id" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // Clean up expired holds first
    await supabase
      .from("slot_holds")
      .delete()
      .lt("expires_at", new Date().toISOString());

    // Check if slot is already held by someone else
    const { data: existingHolds } = await supabase
      .from("slot_holds")
      .select("id, session_id")
      .eq("amenity_id", amenity_id)
      .eq("reservation_date", date)
      .eq("start_time", start_time)
      .gt("expires_at", new Date().toISOString());

    const heldByOther = (existingHolds ?? []).some(
      (h) => h.session_id !== session_id
    );

    if (heldByOther) {
      return Response.json(
        { error: "This time slot is currently held by another user. Please select a different time." },
        { status: 409 }
      );
    }

    // Check if slot is already booked
    const { data: existingReservations } = await supabase
      .from("reservations")
      .select("id")
      .eq("amenity_id", amenity_id)
      .eq("reservation_date", date)
      .eq("start_time", start_time)
      .not("status", "eq", "cancelled");

    if (existingReservations && existingReservations.length > 0) {
      return Response.json(
        { error: "This time slot is already booked." },
        { status: 409 }
      );
    }

    // Release any existing holds by this session for this amenity+date
    await supabase
      .from("slot_holds")
      .delete()
      .eq("amenity_id", amenity_id)
      .eq("reservation_date", date)
      .eq("session_id", session_id);

    // Create the hold
    const expiresAt = new Date(Date.now() + HOLD_DURATION_MINUTES * 60 * 1000).toISOString();

    const { data: hold, error } = await supabase
      .from("slot_holds")
      .insert({
        amenity_id,
        reservation_date: date,
        start_time,
        end_time,
        session_id,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();

    if (error) {
      logger.error("Failed to create slot hold", { error: error.message });
      return Response.json({ error: "Failed to hold time slot" }, { status: 500 });
    }

    logger.info("Slot hold created", {
      hold_id: hold.id,
      amenity_id,
      date,
      start_time,
      session_id,
    });

    return Response.json({
      hold_id: hold.id,
      expires_at: hold.expires_at,
      hold_duration_minutes: HOLD_DURATION_MINUTES,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Hold endpoint error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const holdId = searchParams.get("id");
    const sessionId = searchParams.get("session_id");

    if (!holdId || !sessionId) {
      return Response.json(
        { error: "Missing required parameters: id, session_id" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const { error } = await supabase
      .from("slot_holds")
      .delete()
      .eq("id", holdId)
      .eq("session_id", sessionId);

    if (error) {
      logger.error("Failed to release slot hold", { error: error.message });
      return Response.json({ error: "Failed to release hold" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Hold delete endpoint error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
