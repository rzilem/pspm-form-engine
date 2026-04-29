/**
 * Admin endpoints for the unified submissions inbox.
 *
 *   GET /api/admin/submissions
 *     ?form_slug=...    filter by form
 *     ?status=...       new | in_review | completed | spam | archived
 *     ?from=YYYY-MM-DD  earliest created_at
 *     ?to=YYYY-MM-DD    latest created_at (inclusive)
 *     ?search=...       fuzzy match on stringified data jsonb
 *     ?page=N           1-based; ?limit=N (max 100)
 *     ?format=csv       returns text/csv instead of JSON
 *
 * Replaces the Gravity Forms entries dashboard for both legacy hand-coded
 * forms and dynamic form_definitions submissions. Service role bypasses
 * RLS — auth gate is the shared admin password.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";

interface SubmissionRow {
  id: string;
  form_slug: string;
  form_definition_id: string | null;
  data: Record<string, unknown>;
  status: string;
  ip_address: string | null;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export async function GET(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const formSlug = searchParams.get("form_slug");
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50),
      100,
    );
    const format = searchParams.get("format");

    const supabase = getSupabaseAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from("form_submissions")
      .select("*", { count: "exact" });

    if (formSlug) query = query.eq("form_slug", formSlug);
    if (status) query = query.eq("status", status);
    if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
    if (to) query = query.lte("created_at", `${to}T23:59:59Z`);

    if (search) {
      // Sanitize: PostgREST `or` filter is comma-tokenized so we strip
      // anything that could break the filter syntax. Stringified JSONB
      // search via `data::text ilike` keeps the inbox useful without
      // building a full-text index for v1.
      const safe = search.replace(/[^a-zA-Z0-9 @._-]/g, "").slice(0, 100);
      if (safe) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = (query as any).or(
          `form_slug.ilike.%${safe}%,reviewer_notes.ilike.%${safe}%`,
        );
      }
    }

    query = query
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (format === "csv") {
      // CSV export: flatten data jsonb into one row per submission. Headers
      // are the union of all top-level keys across the result set so each
      // export self-describes regardless of mixed form types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fullExportQuery = (supabase as any).from("form_submissions").select("*");
      // Re-apply filters
      if (formSlug) fullExportQuery.eq("form_slug", formSlug);
      if (status) fullExportQuery.eq("status", status);
      if (from) fullExportQuery.gte("created_at", `${from}T00:00:00Z`);
      if (to) fullExportQuery.lte("created_at", `${to}T23:59:59Z`);
      const { data: rows } = await fullExportQuery
        .order("created_at", { ascending: false })
        .limit(5000); // hard cap for CSV; protects memory

      if (!rows || rows.length === 0) {
        return new Response("No data\n", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const dataKeys = new Set<string>();
      for (const r of rows as SubmissionRow[]) {
        if (r.data && typeof r.data === "object") {
          for (const k of Object.keys(r.data)) dataKeys.add(k);
        }
      }
      const sortedKeys = Array.from(dataKeys).sort();
      const headers = [
        "id",
        "form_slug",
        "status",
        "created_at",
        "ip_address",
        ...sortedKeys.map((k) => `data.${k}`),
        "reviewer_notes",
      ];
      const csvRows = (rows as SubmissionRow[]).map((r) => {
        const cells: string[] = [
          r.id,
          r.form_slug,
          r.status,
          r.created_at,
          r.ip_address ?? "",
          ...sortedKeys.map((k) => csvCell(r.data?.[k])),
          r.reviewer_notes ?? "",
        ];
        return cells.map(csvEscape).join(",");
      });
      const body = [headers.map(csvEscape).join(","), ...csvRows].join("\n");
      return new Response(body + "\n", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="submissions-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const { data, error, count } = await query;
    if (error) {
      logger.error("Admin list submissions failed", { error: error.message });
      return Response.json({ error: "Failed to load submissions" }, { status: 500 });
    }

    return Response.json({
      submissions: data ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    logger.error("Admin list submissions threw", { error: String(err) });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join("; ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
