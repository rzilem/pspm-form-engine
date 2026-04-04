"use client";

import { useState, useCallback } from "react";
import type { UseFormReturn, FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/Button";

interface StepDefinition<T extends FieldValues> {
  label: string;
  /** Field names to validate before proceeding from this step */
  fields: (keyof T)[];
  /** Render the step content */
  render: (form: UseFormReturn<T>) => React.ReactNode;
}

interface StepWizardProps<T extends FieldValues> {
  steps: StepDefinition<T>[];
  form: UseFormReturn<T>;
  submitLabel?: string;
  onSubmit: () => void;
  isSubmitting?: boolean;
}

function StepWizard<T extends FieldValues>({
  steps,
  form,
  submitLabel = "Submit",
  onSubmit,
  isSubmitting = false,
}: StepWizardProps<T>) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const isLastStep = currentStep === steps.length - 1;
  const step = steps[currentStep];

  const handleNext = useCallback(async () => {
    // Validate current step fields
    if (step.fields.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isValid = await form.trigger(step.fields as any);
      if (!isValid) return;
    }

    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  }, [currentStep, form, step.fields, steps.length]);

  const handlePrevious = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleStepSubmit = useCallback(async () => {
    // Validate last step fields before submit
    if (step.fields.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isValid = await form.trigger(step.fields as any);
      if (!isValid) return;
    }

    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    onSubmit();
  }, [currentStep, form, onSubmit, step.fields]);

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <nav aria-label="Form progress">
        <ol className="flex items-center gap-2">
          {steps.map((s, index) => {
            const isCompleted = completedSteps.has(index);
            const isCurrent = index === currentStep;
            const isFuture = index > currentStep && !isCompleted;

            return (
              <li
                key={s.label}
                className="flex items-center gap-2 flex-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Step number / check */}
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0 transition-colors
                      ${
                        isCompleted
                          ? "bg-brand-green text-white"
                          : isCurrent
                            ? "bg-primary text-white"
                            : "bg-gray-200 text-muted"
                      }`}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {isCompleted ? (
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
                      index + 1
                    )}
                  </div>

                  {/* Step label — hide on small screens for non-current */}
                  <span
                    className={`text-xs font-medium truncate
                      ${isCurrent ? "text-primary" : isFuture ? "text-muted" : "text-foreground"}
                      ${isCurrent ? "" : "hidden sm:inline"}`}
                  >
                    {s.label}
                  </span>
                </div>

                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 rounded-full
                      ${isCompleted ? "bg-brand-green" : "bg-gray-200"}`}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step content */}
      <div
        key={currentStep}
        className="animate-fade-in space-y-6"
        role="group"
        aria-label={`Step ${currentStep + 1}: ${step.label}`}
      >
        <h2 className="text-lg font-semibold text-navy">{step.label}</h2>
        {step.render(form)}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={handlePrevious}
          disabled={currentStep === 0}
          className={currentStep === 0 ? "invisible" : ""}
        >
          Previous
        </Button>

        {isLastStep ? (
          <Button
            type="button"
            size="lg"
            loading={isSubmitting}
            onClick={handleStepSubmit}
            className="flex-1 sm:flex-none sm:min-w-[200px]"
          >
            {submitLabel}
          </Button>
        ) : (
          <Button
            type="button"
            size="md"
            onClick={handleNext}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

export { StepWizard };
export type { StepWizardProps, StepDefinition };
