/**
 * Server-side submission counts for limit/inventory enforcement.
 * Uses service role — public anon cannot read form_submissions (RLS).
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

/** Count completed submissions for a dynamic form (excludes form_partials). */
export async function countFormSubmissions(
  formDefinitionId: string,
): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from("form_submissions")
    .select("*", { count: "exact", head: true })
    .eq("form_definition_id", formDefinitionId);

  if (error) {
    logger.error("countFormSubmissions failed", {
      formDefinitionId,
      error: error.message,
    });
    return 0;
  }
  return count ?? 0;
}

/** Fetch submission payloads for inventory aggregation. */
export async function fetchSubmissionDataRows(
  formDefinitionId: string,
): Promise<Array<{ data: Record<string, unknown> }>> {
  const { data, error } = await getSupabaseAdmin()
    .from("form_submissions")
    .select("data")
    .eq("form_definition_id", formDefinitionId);

  if (error) {
    logger.error("fetchSubmissionDataRows failed", {
      formDefinitionId,
      error: error.message,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    data: (row.data ?? {}) as Record<string, unknown>,
  }));
}