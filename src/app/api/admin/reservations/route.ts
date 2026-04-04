import { getSupabase } from "@/lib/supabase";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { generateConfirmationCode, generateManageToken } from "@/lib/booking";
import { logger } from "@/lib/logger";

/** GET /api/admin/reservations — list/filter reservations */
export async function GET(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const amenity = searchParams.get("amenity");
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
    const format = searchParams.get("format");

    const supabase = getSupabase();

    let query = supabase
      .from("reservations")
      .select("*, amenities(name, slug, community)", { count: "exact" });

    if (amenity) {
      // Join through amenities to filter by slug
      const { data: am } = await supabase.from("amenities").select("id").eq("slug", amenity).single();
      if (am) query = query.eq("amenity_id", am.id);
    }

    if (status) query = query.eq("status", status);
    if (from) query = query.gte("reservation_date", from);
    if (to) query = query.lte("reservation_date", to);
    if (search) {
      query = query.or(`resident_name.ilike.%${search}%,resident_email.ilike.%${search}%,confirmation_code.ilike.%${search}%`);
    }

    query = query.order("reservation_date", { ascending: false });

    // CSV export
    if (format === "csv") {
      const { data } = await query;
      if (!data) return Response.json({ error: "No data" }, { status: 404 });

      const headers = [
        "Confirmation Code", "Date", "Start", "End", "Name", "Email", "Phone",
        "Status", "Amount", "Stripe Status", "Created",
      ];
      const rows = data.map((r) => [
        r.confirmation_code, r.reservation_date, r.start_time, r.end_time,
        r.resident_name, r.resident_email, r.resident_phone ?? "",
        r.status, `$${(r.amount_cents / 100).toFixed(2)}`, r.stripe_status, r.created_at,
      ]);

      const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="reservations-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    // Paginated JSON
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      logger.error("Admin list reservations error", { error: error.message });
      return Response.json({ error: "Failed to fetch reservations" }, { status: 500 });
    }

    return Response.json({
      reservations: data,
      total: count,
      page,
      limit,
      pages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Admin reservations error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/admin/reservations — manual booking */
export async function POST(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const body = (await request.json()) as {
      amenity_slug: string;
      reservation_date: string;
      start_time: string;
      end_time: string;
      resident_name: string;
      resident_email: string;
      resident_phone?: string;
      notes?: string;
      skip_payment?: boolean;
    };

    const supabase = getSupabase();

    // Get amenity
    const { data: amenity } = await supabase
      .from("amenities")
      .select("id, deposit_cents")
      .eq("slug", body.amenity_slug)
      .single();

    if (!amenity) {
      return Response.json({ error: "Amenity not found" }, { status: 404 });
    }

    // Check for conflicts
    const { data: conflicts } = await supabase
      .from("reservations")
      .select("id")
      .eq("amenity_id", amenity.id)
      .eq("reservation_date", body.reservation_date)
      .eq("start_time", body.start_time)
      .not("status", "eq", "cancelled");

    if (conflicts && conflicts.length > 0) {
      return Response.json({ error: "Time slot is already booked" }, { status: 409 });
    }

    const confirmationCode = generateConfirmationCode(body.reservation_date);
    const manageToken = generateManageToken();

    const { data: reservation, error } = await supabase
      .from("reservations")
      .insert({
        amenity_id: amenity.id,
        confirmation_code: confirmationCode,
        reservation_date: body.reservation_date,
        start_time: body.start_time,
        end_time: body.end_time,
        resident_name: body.resident_name,
        resident_email: body.resident_email,
        resident_phone: body.resident_phone ?? null,
        amount_cents: body.skip_payment ? 0 : amenity.deposit_cents,
        stripe_status: body.skip_payment ? "waived" : "pending",
        status: "confirmed",
        manage_token: manageToken,
        special_requests: body.notes ?? null,
      })
      .select("id, confirmation_code")
      .single();

    if (error) {
      logger.error("Admin manual booking failed", { error: error.message });
      return Response.json({ error: "Failed to create booking" }, { status: 500 });
    }

    logger.info("Admin manual booking created", {
      confirmation_code: confirmationCode,
      admin: true,
    });

    return Response.json({ success: true, reservation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Admin POST reservations error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH /api/admin/reservations — update reservation status */
export async function PATCH(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const body = (await request.json()) as {
      id: string;
      status?: string;
      notes?: string;
    };

    if (!body.id) {
      return Response.json({ error: "Missing reservation id" }, { status: 400 });
    }

    const supabase = getSupabase();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.status) {
      updates.status = body.status;
      if (body.status === "cancelled") {
        updates.cancelled_at = new Date().toISOString();
        updates.cancelled_by = "admin";
      }
    }
    if (body.notes) updates.special_requests = body.notes;

    const { error } = await supabase
      .from("reservations")
      .update(updates)
      .eq("id", body.id);

    if (error) {
      logger.error("Admin update reservation failed", { error: error.message });
      return Response.json({ error: "Failed to update" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Admin PATCH error", { error: message });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
