/**
 * Admin per-submission endpoints: GET single + PATCH status/notes.
 *
 * No DELETE — we never want to lose submission history. Use status='spam'
 * or status='archived' to hide entries from the inbox view instead.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateSchema = z.object({
  status: z.enum(["new", "in_review", "completed", "spam", "archived"]).optional(),
  reviewer_notes: z.string().max(5000).nullable().optional(),
  reviewed_by: z.string().max(200).nullable().optional(),
});

export async function GET(request: Request, ctx: RouteContext) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("Admin get submission failed", { id, error: error.message });
    return Response.json({ error: "Failed to load submission" }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });

  // Pull the linked form_definition title (if any) so the detail view
  // doesn't have to round-trip a second query.
  let formTitle: string | null = null;
  if (data.form_definition_id) {
    const { data: def } = await supabase
      .from("form_definitions")
      .select("title")
      .eq("id", data.form_definition_id)
      .maybeSingle();
    formTitle = def?.title ?? null;
  }

  return Response.json({ ...data, form_title: formTitle });
}

export async function PATCH(request: Request, ctx: RouteContext) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    const body: unknown = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid input",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const update: Record<string, unknown> = { ...parsed.data };
    // Auto-stamp reviewed_at when status moves out of 'new' or notes change
    if (parsed.data.status && parsed.data.status !== "new") {
      update.reviewed_at = new Date().toISOString();
    } else if (parsed.data.reviewer_notes !== undefined) {
      update.reviewed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("form_submissions")
      .update(update)
      .eq("id", id)
      .select("id, status, reviewer_notes, reviewed_at, reviewed_by")
      .single();

    if (error) {
      logger.error("Admin update submission failed", { id, error: error.message });
      return Response.json({ error: "Failed to update" }, { status: 500 });
    }
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(data);
  } catch (err) {
    logger.error("Admin update submission threw", { id, error: String(err) });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
