import type { FieldDefinition, FieldType } from "@/lib/form-definitions";

/** Field types that carry no submission value and are not validated on Next. */
export const WIZARD_NON_INPUT_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "section_break",
  "html",
  "total",
  "page_break",
]);

export type FormWizardPage = {
  /** The page_break that starts this page (undefined for the first page). */
  breakField?: FieldDefinition;
  /** Input/display fields on this page (excludes page_break boundaries). */
  fields: FieldDefinition[];
};

/**
 * Split a field schema into wizard pages at each `page_break`. The break field
 * itself is a boundary and is not included in any page's `fields`.
 */
export function splitIntoWizardPages(
  fields: FieldDefinition[],
): FormWizardPage[] {
  const pages: FormWizardPage[] = [{ fields: [] }];
  for (const f of fields) {
    if (f.type === "page_break") {
      pages.push({ breakField: f, fields: [] });
    } else {
      pages[pages.length - 1].fields.push(f);
    }
  }
  return pages;
}

/** True when the schema contains at least one page_break (wizard mode). */
export function hasWizardPages(fields: FieldDefinition[]): boolean {
  return fields.some((f) => f.type === "page_break");
}

/**
 * A page is shown when its starting page_break (if any) is visible and at
 * least one field on the page is visible.
 */
export function isWizardPageVisible(
  page: FormWizardPage,
  visibleFieldIds: ReadonlySet<string>,
): boolean {
  if (page.breakField && !visibleFieldIds.has(page.breakField.id)) return false;
  return page.fields.some((f) => visibleFieldIds.has(f.id));
}

/** Indices of pages that should appear in navigation for the current values. */
export function getVisibleWizardPageIndices(
  pages: FormWizardPage[],
  visibleFieldIds: ReadonlySet<string>,
): number[] {
  return pages
    .map((_, i) => i)
    .filter((i) => isWizardPageVisible(pages[i], visibleFieldIds));
}

/**
 * From a page index, step to the next/previous *visible* page index, skipping
 * pages whose fields are all hidden (or whose page_break is hidden).
 */
export function stepWizardPageIndex(
  pages: FormWizardPage[],
  visibleFieldIds: ReadonlySet<string>,
  fromIndex: number,
  direction: 1 | -1,
): number {
  const visible = getVisibleWizardPageIndices(pages, visibleFieldIds);
  if (visible.length === 0) return fromIndex;
  const pos = visible.indexOf(fromIndex);
  if (pos === -1) {
    return direction === 1 ? visible[0] : visible[visible.length - 1];
  }
  const nextPos = pos + direction;
  if (nextPos < 0 || nextPos >= visible.length) return fromIndex;
  return visible[nextPos];
}

/** Human-readable title for a wizard step (progress bar + heading). */
export function wizardPageLabel(page: FormWizardPage, index: number): string {
  const fromBreak = page.breakField?.label?.trim();
  if (fromBreak) return fromBreak;
  return `Step ${index + 1}`;
}

/** Field ids on a page that should be validated before advancing (visible inputs only). */
export function getWizardPageValidationFieldIds(
  page: FormWizardPage,
  visibleFieldIds: ReadonlySet<string>,
): string[] {
  return page.fields
    .filter(
      (f) => visibleFieldIds.has(f.id) && !WIZARD_NON_INPUT_TYPES.has(f.type),
    )
    .map((f) => f.id);
}