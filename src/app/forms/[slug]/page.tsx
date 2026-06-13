import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FormLayout } from "@/components/forms/FormLayout";
import { EmbedAutoHeight } from "@/components/forms/EmbedAutoHeight";
import { loadFormDefinition } from "@/lib/form-loader";
import { loadFormPartial } from "@/lib/form-partials";
import {
  aggregateInventoryUsage,
  computeInventoryRemaining,
  evaluateSubmissionLimit,
  formHasInventory,
} from "@/lib/form-definitions";
import {
  countFormSubmissions,
  fetchSubmissionDataRows,
} from "@/lib/form-submission-stats";
import { FormClosedMessage } from "@/components/forms/FormClosedMessage";
import { DynamicForm } from "./DynamicForm";

// Forms can change at any time via the admin UI; never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string; resume?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const definition = await loadFormDefinition(slug);
  if (!definition) {
    return { title: "Form Not Found | PS Property Management" };
  }
  return {
    title: `${definition.title} | PS Property Management`,
    description: definition.description ?? undefined,
  };
}

export default async function DynamicFormPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { embed, resume } = await searchParams;
  const definition = await loadFormDefinition(slug);

  if (!definition) {
    notFound();
  }

  const entryCount = await countFormSubmissions(definition.id);
  const limitStatus = evaluateSubmissionLimit(
    definition.submission_limit,
    entryCount,
    new Date(),
  );

  let inventoryRemaining:
    | Record<string, Record<string, number>>
    | undefined;
  if (formHasInventory(definition.field_schema)) {
    const rows = await fetchSubmissionDataRows(definition.id);
    const usage = aggregateInventoryUsage(definition.field_schema, rows);
    inventoryRemaining = computeInventoryRemaining(
      definition.field_schema,
      usage,
    );
  }

  let initialValues: Record<string, unknown> | undefined;
  let initialPage: number | undefined;
  let resumeToken: string | undefined;
  let resumeNotice: string | null = null;

  if (resume?.trim() && definition.save_resume_enabled) {
    const partial = await loadFormPartial(slug, resume.trim());
    if (partial) {
      initialValues = partial.data;
      initialPage =
        partial.current_page !== null && partial.current_page >= 0
          ? partial.current_page
          : undefined;
      resumeToken = partial.resume_token;
    } else if (resume.trim()) {
      resumeNotice =
        "We couldn't restore your saved progress — it may have expired. You can start fresh below.";
    }
  }

  const closedBlock = (
    <FormClosedMessage
      title={definition.title}
      description={definition.description}
      message={limitStatus.message}
    />
  );

  // Embed mode (?embed=1): drop the PSPM header/footer chrome so the form
  // sits cleanly inside an iframe on psprop.net, and report height to the
  // host page for auto-resize.
  if (embed === "1") {
    // "full" fills the host container (near-full-width embed); "boxed" keeps a
    // readable centered max-width.
    const embedInner = definition.width === "boxed" ? "mx-auto max-w-3xl" : "w-full";
    return (
      // No min-h-screen in embed mode: the wrapper must size to its content so
      // the iframe can shrink when conditional fields hide or errors clear.
      // EmbedAutoHeight measures this element (not body, which RootLayout pins
      // to min-h-full).
      <main id="pspm-embed-root" className="bg-background px-4 py-6">
        <div className={embedInner}>
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-navy">{definition.title}</h1>
            {definition.description && (
              <p className="mt-1 text-sm text-muted">{definition.description}</p>
            )}
          </div>
          {!limitStatus.open ? (
            closedBlock
          ) : (
            <DynamicForm
              definition={definition}
              initialValues={initialValues}
              initialPage={initialPage}
              resumeToken={resumeToken}
              resumeNotice={resumeNotice}
              inventoryRemaining={inventoryRemaining}
            />
          )}
        </div>
        <EmbedAutoHeight slug={slug} />
      </main>
    );
  }

  return (
    <FormLayout
      title={definition.title}
      subtitle={definition.description ?? undefined}
      contentWidth={definition.width}
    >
      {!limitStatus.open ? (
        closedBlock
      ) : (
        <DynamicForm
          definition={definition}
          initialValues={initialValues}
          initialPage={initialPage}
          resumeToken={resumeToken}
          resumeNotice={resumeNotice}
          inventoryRemaining={inventoryRemaining}
        />
      )}
    </FormLayout>
  );
}
