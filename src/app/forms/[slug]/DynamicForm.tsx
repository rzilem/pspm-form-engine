"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { useFormContext } from "react-hook-form";
import {
  FormEngine,
  type FormWizardSubmitGuard,
} from "@/components/forms/FormEngine";
import { DynamicField } from "@/components/forms/DynamicField";
import { Button } from "@/components/ui/Button";
import { SaveAndContinueButton } from "@/components/forms/SaveAndContinue";
import {
  buildSubmissionSchema,
  computeFormTotal,
  resolveListColumns,
  resolveVisibleFieldIds,
  type FieldType,
  type FormDefinition,
} from "@/lib/form-definitions";
import { applyInputMask } from "@/lib/input-mask";
import {
  getVisibleWizardPageIndices,
  getWizardPageValidationFieldIds,
  hasWizardPages,
  splitIntoWizardPages,
  stepWizardPageIndex,
  wizardPageLabel,
  type FormWizardPage,
} from "@/lib/form-wizard";

// Field types compact enough to sit two-per-row when the form is wide.
// Everything else (composites, multi-option, long text, layout, uploads)
// spans the full width to stay readable. Driven by the FORM's own width via
// a container query, so a narrow iframe stays single-column regardless of the
// viewport.
const HALF_WIDTH_TYPES = new Set<FieldType>([
  "text",
  "email",
  "phone",
  "number",
  "date",
  "time",
  "select",
]);

interface DynamicFormProps {
  definition: FormDefinition;
  // Builder live-preview: render exactly as end users see it but never submit.
  preview?: boolean;
  /** Saved partial values from ?resume= token (server-fetched). */
  initialValues?: Record<string, unknown>;
  /** Wizard page index from saved partial. */
  initialPage?: number;
  /** Existing resume token for update-in-place saves + submit cleanup. */
  resumeToken?: string;
  /** Shown when ?resume= was present but invalid/expired. */
  resumeNotice?: string | null;
  /** Per-field per-option remaining inventory (advisory; server re-checks). */
  inventoryRemaining?: Record<string, Record<string, number>>;
}

function notifyEmbedRemeasure() {
  const root = document.getElementById("pspm-embed-root");
  root?.dispatchEvent(new CustomEvent("pspm-form:remeasure"));
}

/** Clears wizard guard ref without lifting state (flat forms). */
function ClearWizardGuard({
  wizardGuardRef,
}: {
  wizardGuardRef: RefObject<FormWizardSubmitGuard | null>;
}) {
  useLayoutEffect(() => {
    wizardGuardRef.current = null;
  });
  return null;
}

function WizardProgress({
  pages,
  visibleIndices,
  currentPageIndex,
}: {
  pages: FormWizardPage[];
  visibleIndices: number[];
  currentPageIndex: number;
}) {
  const stepNumber = visibleIndices.indexOf(currentPageIndex) + 1;
  const totalSteps = visibleIndices.length;
  const progressPct =
    totalSteps > 1 ? Math.round((stepNumber / totalSteps) * 100) : 100;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-navy">
        Step {stepNumber} of {totalSteps}
      </p>
      <nav aria-label="Form progress">
        <ol className="flex items-center gap-2">
          {visibleIndices.map((pageIndex, displayIndex) => {
            const isCurrent = pageIndex === currentPageIndex;
            const isPast =
              visibleIndices.indexOf(currentPageIndex) > displayIndex;

            return (
              <li
                key={pages[pageIndex].breakField?.id ?? `page-${pageIndex}`}
                className="flex items-center gap-2 flex-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0 transition-colors
                      ${
                        isPast
                          ? "bg-brand-green text-white"
                          : isCurrent
                            ? "bg-primary text-white"
                            : "bg-gray-200 text-muted"
                      }`}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {isPast ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      displayIndex + 1
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium truncate
                      ${isCurrent ? "text-primary" : isPast ? "text-foreground" : "text-muted"}
                      ${isCurrent ? "" : "hidden sm:inline"}`}
                  >
                    {wizardPageLabel(pages[pageIndex], pageIndex)}
                  </span>
                </div>
                {displayIndex < visibleIndices.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 rounded-full
                      ${isPast ? "bg-brand-green" : "bg-gray-200"}`}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div
        className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

function WizardNavigation({
  isFirstVisible,
  isLastVisible,
  preview,
  onBack,
  onNext,
  saveSlot,
}: {
  isFirstVisible: boolean;
  isLastVisible: boolean;
  preview: boolean;
  onBack: () => void;
  onNext: () => void;
  saveSlot?: React.ReactNode;
}) {
  const { formState } = useFormContext();

  return (
    <div className="space-y-3 pt-2">
      {saveSlot}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onBack}
          disabled={isFirstVisible}
          className={isFirstVisible ? "invisible" : ""}
        >
          Back
        </Button>

        {isLastVisible ? (
          <Button
            type="submit"
            size="lg"
            loading={formState.isSubmitting}
            disabled={preview}
            className="flex-1 sm:flex-none sm:min-w-[200px]"
          >
            Submit
          </Button>
        ) : (
          <Button type="button" size="md" onClick={onNext}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function renderFieldGrid(
  fields: FormWizardPage["fields"],
  definition: FormDefinition,
  preview: boolean,
  computedTotal: number,
  inventoryRemaining?: Record<string, Record<string, number>>,
) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-5 @2xl:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.id}
            className={HALF_WIDTH_TYPES.has(field.type) ? "" : "@2xl:col-span-2"}
          >
            <DynamicField
              field={field}
              formSlug={definition.slug}
              preview={preview}
              computedTotal={computedTotal}
              inventoryRemaining={inventoryRemaining}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Client-side wrapper around FormEngine that derives a Zod schema and
 * default values from a FormDefinition, then renders one DynamicField per
 * entry in field_schema. The server-side validator at /api/submit
 * recomputes the schema independently — this client copy is purely UX
 * (pre-submit error display).
 */
export function DynamicForm({
  definition,
  preview = false,
  initialValues,
  initialPage,
  resumeToken: initialResumeToken,
  resumeNotice,
  inventoryRemaining,
}: DynamicFormProps) {
  const [resumeToken, setResumeToken] = useState(initialResumeToken);
  const schema = useMemo(
    () => buildSubmissionSchema(definition.field_schema),
    [definition.field_schema],
  );

  const wizardEnabled = useMemo(
    () => hasWizardPages(definition.field_schema),
    [definition.field_schema],
  );

  const pages = useMemo(
    () => splitIntoWizardPages(definition.field_schema),
    [definition.field_schema],
  );

  // Default values shape mirrors the field types so react-hook-form has
  // something to register against on first render. Structural/display fields
  // are skipped (no value).
  const defaultValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of definition.field_schema) {
      if (
        f.type === "section_break" ||
        f.type === "page_break" ||
        f.type === "html" ||
        f.type === "total"
      )
        continue;
      if (f.type === "consent") out[f.id] = false;
      else if (f.type === "list") {
        if (f.required) {
          const emptyRow: Record<string, string> = {};
          for (const c of resolveListColumns(f)) emptyRow[c.id] = "";
          out[f.id] = [emptyRow];
        } else {
          out[f.id] = [];
        }
      } else if (
        f.type === "checkbox_group" ||
        f.type === "file_upload" ||
        f.type === "line_items" ||
        (f.type === "image_choice" && f.multiple)
      )
        out[f.id] = [];
      else if (f.type === "name") out[f.id] = { first: "", last: "" };
      else if (f.type === "address")
        out[f.id] = { street: "", city: "", state: "", zip: "" };
      else if (f.defaultValue !== undefined && f.defaultValue !== "") {
        const dv = f.defaultValue;
        out[f.id] =
          typeof dv === "string" && f.mask
            ? applyInputMask(f.mask, dv)
            : dv;
      }
      else out[f.id] = "";
    }
    if (!initialValues) return out;
    for (const [key, val] of Object.entries(initialValues)) {
      if (val !== undefined) out[key] = val;
    }
    return out;
  }, [definition.field_schema, initialValues]);

  const [currentPageIndex, setCurrentPageIndex] = useState(initialPage ?? 0);

  useEffect(() => {
    notifyEmbedRemeasure();
  }, [currentPageIndex]);

  return (
    <>
      {resumeNotice && (
        <div
          className="mb-4 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          {resumeNotice}
        </div>
      )}
      <FormEngine
        schema={schema}
        formSlug={definition.slug}
        defaultValues={defaultValues}
        confirmationMessage={definition.confirmation_message}
        recaptcha={definition.recaptcha_required}
        preview={preview}
        hideDefaultSubmit={wizardEnabled}
        resumeToken={resumeToken}
        secondaryActions={
          !wizardEnabled && definition.save_resume_enabled
            ? ({ honeypotRef }) => (
                <SaveAndContinueFlatSlot
                  definition={definition}
                  formSlug={definition.slug}
                  currentPage={undefined}
                  resumeToken={resumeToken}
                  onToken={setResumeToken}
                  honeypotRef={honeypotRef}
                  preview={preview}
                />
              )
            : undefined
        }
      >
      {({ watch, wizardGuardRef, honeypotRef }) => {
        const getValues = () => watch() as Record<string, unknown>;
        const getHoneypotValue = () => honeypotRef.current?.value ?? "";

        const saveSlot =
          definition.save_resume_enabled && !preview ? (
            <SaveAndContinueButton
              definition={definition}
              formSlug={definition.slug}
              getValues={getValues}
              currentPage={wizardEnabled ? currentPageIndex : undefined}
              resumeToken={resumeToken}
              onToken={setResumeToken}
              getHoneypotValue={getHoneypotValue}
              preview={preview}
            />
          ) : null;
        const values = watch() as Record<string, unknown>;
        const visible = resolveVisibleFieldIds(
          definition.field_schema,
          values,
        );
        const computedTotal = computeFormTotal(
          definition.field_schema.filter((f) => visible.has(f.id)),
          values,
        );

        if (!wizardEnabled) {
          const visibleFields = definition.field_schema.filter((field) =>
            visible.has(field.id),
          );
          return (
            <>
              <ClearWizardGuard wizardGuardRef={wizardGuardRef} />
              {renderFieldGrid(
                visibleFields,
                definition,
                preview,
                computedTotal,
                inventoryRemaining,
              )}
            </>
          );
        }

        const visiblePageIndices = getVisibleWizardPageIndices(pages, visible);

        return (
          <DynamicFormWizardBody
            pages={pages}
            visiblePageIndices={visiblePageIndices}
            currentPageIndex={currentPageIndex}
            preview={preview}
            definition={definition}
            computedTotal={computedTotal}
            visible={visible}
            onPageChange={setCurrentPageIndex}
            wizardGuardRef={wizardGuardRef}
            saveSlot={saveSlot}
            inventoryRemaining={inventoryRemaining}
          />
        );
      }}
    </FormEngine>
    </>
  );
}

/** Flat forms: save button lives in FormEngine secondaryActions (needs form context). */
function SaveAndContinueFlatSlot({
  definition,
  formSlug,
  currentPage,
  resumeToken,
  onToken,
  honeypotRef,
  preview,
}: {
  definition: FormDefinition;
  formSlug: string;
  currentPage: number | undefined;
  resumeToken: string | undefined;
  onToken: (token: string) => void;
  honeypotRef: RefObject<HTMLInputElement | null>;
  preview?: boolean;
}) {
  const { watch } = useFormContext();
  return (
    <SaveAndContinueButton
      definition={definition}
      formSlug={formSlug}
      getValues={() => watch() as Record<string, unknown>}
      currentPage={currentPage}
      resumeToken={resumeToken}
      onToken={onToken}
      getHoneypotValue={() => honeypotRef.current?.value ?? ""}
      preview={preview}
      className="w-full sm:w-auto"
    />
  );
}

function DynamicFormWizardBody({
  pages,
  visiblePageIndices,
  currentPageIndex,
  preview,
  definition,
  computedTotal,
  visible,
  onPageChange,
  wizardGuardRef,
  saveSlot,
  inventoryRemaining,
}: {
  pages: FormWizardPage[];
  visiblePageIndices: number[];
  currentPageIndex: number;
  preview: boolean;
  definition: FormDefinition;
  computedTotal: number;
  visible: Set<string>;
  onPageChange: (index: number) => void;
  wizardGuardRef: RefObject<FormWizardSubmitGuard | null>;
  saveSlot?: React.ReactNode;
  inventoryRemaining?: Record<string, Record<string, number>>;
}) {
  const { trigger } = useFormContext();

  const activePageIndex = visiblePageIndices.includes(currentPageIndex)
    ? currentPageIndex
    : (visiblePageIndices[0] ?? 0);

  useEffect(() => {
    if (
      visiblePageIndices.length > 0 &&
      !visiblePageIndices.includes(currentPageIndex)
    ) {
      onPageChange(visiblePageIndices[0]);
    }
  }, [currentPageIndex, onPageChange, visiblePageIndices]);

  const currentPage = pages[activePageIndex];
  const currentFields = currentPage.fields.filter((f) => visible.has(f.id));
  const currentPageLabel = wizardPageLabel(currentPage, activePageIndex);
  const posInVisible = visiblePageIndices.indexOf(activePageIndex);
  const isFirstVisible = posInVisible <= 0;
  const isLastVisible =
    posInVisible === visiblePageIndices.length - 1 ||
    visiblePageIndices.length === 0;

  const handleNext = useCallback(async () => {
    const page = pages[activePageIndex];
    const names = getWizardPageValidationFieldIds(page, visible);
    if (names.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ok = await trigger(names as any);
      if (!ok) return;
    }
    const next = stepWizardPageIndex(pages, visible, activePageIndex, 1);
    if (next !== activePageIndex) onPageChange(next);
  }, [activePageIndex, onPageChange, pages, trigger, visible]);

  const handleBack = useCallback(() => {
    const prev = stepWizardPageIndex(pages, visible, activePageIndex, -1);
    if (prev !== activePageIndex) onPageChange(prev);
  }, [activePageIndex, onPageChange, pages, visible]);

  // Sync guard into ref (no parent setState) — FormEngine reads at submit/key time.
  useLayoutEffect(() => {
    wizardGuardRef.current = {
      isLastPage: isLastVisible,
      onAdvance: handleNext,
    };
    return () => {
      wizardGuardRef.current = null;
    };
  }, [handleNext, isLastVisible, wizardGuardRef]);

  return (
    <div className="space-y-6">
      <WizardProgress
        pages={pages}
        visibleIndices={visiblePageIndices}
        currentPageIndex={activePageIndex}
      />

      <div
        key={activePageIndex}
        className="animate-fade-in space-y-6"
        role="group"
        aria-label={`Step ${visiblePageIndices.indexOf(activePageIndex) + 1}: ${currentPageLabel}`}
      >
        <h2 className="text-lg font-semibold text-navy">{currentPageLabel}</h2>
        {renderFieldGrid(
          currentFields,
          definition,
          preview,
          computedTotal,
          inventoryRemaining,
        )}
      </div>

      <WizardNavigation
        isFirstVisible={isFirstVisible}
        isLastVisible={isLastVisible}
        preview={preview}
        onBack={handleBack}
        onNext={handleNext}
        saveSlot={saveSlot}
      />
    </div>
  );
}