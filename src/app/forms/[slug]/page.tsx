import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FormLayout } from "@/components/forms/FormLayout";
import { loadFormDefinition } from "@/lib/form-loader";
import { DynamicForm } from "./DynamicForm";

// Forms can change at any time via the admin UI; never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ slug: string }>;
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

export default async function DynamicFormPage({ params }: PageProps) {
  const { slug } = await params;
  const definition = await loadFormDefinition(slug);

  if (!definition) {
    notFound();
  }

  return (
    <FormLayout title={definition.title} subtitle={definition.description ?? undefined}>
      <DynamicForm definition={definition} />
    </FormLayout>
  );
}
