import { getAvailableSlots } from "@/lib/booking";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const amenity = searchParams.get("amenity");
    const date = searchParams.get("date");

    if (!amenity || !date) {
      return Response.json(
        { error: "Missing required parameters: amenity, date" },
        { status: 400 }
      );
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const result = await getAvailableSlots(amenity, date);

    if (result.error) {
      return Response.json(
        { slots: result.slots, error: result.error },
        { status: 200 } // Still 200 — the error is informational (e.g. "blackout date")
      );
    }

    return Response.json({ slots: result.slots, amenityId: result.amenityId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Availability endpoint error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
