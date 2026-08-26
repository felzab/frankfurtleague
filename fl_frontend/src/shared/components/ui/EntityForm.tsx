"use client";

import { useState, useTransition } from "react";

import { Button, Form } from "@heroui/react";

import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import { formButton, MODAL_FOOTER_ROW } from "./formButtons";
import { runOnSubmit } from "./formSubmit";

import type { FieldErrors } from "@/shared/utils/validation";
import type { Dispatch, ReactNode, SetStateAction } from "react";

/** What the `post*`/`patch*` server actions return, after the caller has folded in its own guard. */
type SubmitResult = { success: boolean; message?: string; error?: string; fieldErrors?: FieldErrors };

/**
 * The create and edit form skeleton, once. The success guard stays at the call site on purpose: create checks
 * `created_id` and edit checks `updated_document`, and folding that in would mean knowing both response shapes.
 */
export function EntityForm<TDraft>({
  initialDraft,
  renderFields,
  onSubmit,
  successMessage,
  onClose,
  marksRequired = false,
}: {
  initialDraft: TDraft;
  renderFields: (draft: TDraft, setDraft: Dispatch<SetStateAction<TDraft>>) => ReactNode;
  onSubmit: (draft: TDraft) => Promise<SubmitResult>;
  successMessage: string;
  onClose: () => void;
  /**
   * The required asterisks, and only a form that creates something sets it. It governs the marks alone: `isRequired`
   * still sits on the fields either way, and is what refuses an emptied one.
   */
  marksRequired?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<TDraft>(initialDraft);
  // The hook's own toast is what keeps the submit from failing in silence: the one below is suppressed
  // whenever `fieldErrors` is non-empty and no field renders the rejected path.
  const { fieldErrors, setFieldErrors, formRef } = useServerFieldErrors();

  const handleSubmit = () => {
    startTransition(async () => {
      const res = await onSubmit(draft);

      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});

        // A field-level rejection already speaks at the field; the toast is for a failure belonging to none.
        if (!hasFieldErrors(res.fieldErrors)) {
          appToast.danger("Speichern fehlgeschlagen", {
            description: res.error || res.message || UNKNOWN_REFUSAL,
          });
        }
        return;
      }

      setFieldErrors({});
      setDraft(initialDraft);
      appToast.success(res.message || successMessage);
      onClose();
    });
  };

  return (
    <Form
      ref={formRef}
      validationErrors={fieldErrors}
      // Read by the unlayered rule in `globals.css` that suppresses HeroUI's required asterisks. Emitted only
      // when on, so an absent attribute already means no marks.
      data-required-marks={marksRequired ? "on" : undefined}
      className="flex h-fit w-full flex-col gap-y-4 rounded-xl shadow-sm"
      onSubmit={runOnSubmit(handleSubmit)}>
      {/* No entrance: this mounts inside a modal already animating in, so its own would read as a double entrance. */}
      <div className="flex w-full flex-col gap-4 px-2">{renderFields(draft, setDraft)}</div>

      {/* The separator reaches the dialog's edges rather than the form's; `MODAL_FOOTER` owns the arithmetic. */}
      <div className={MODAL_FOOTER_ROW}>
        {/* Disabled in flight: pressing it unmounts the modal from under a running transition, whose toast then
            fires against a dead tree — the record is created and nobody is told. */}
        <Button
          type="button"
          variant="secondary"
          isDisabled={isPending}
          className={formButton({ intent: "cancel" })}
          onPress={onClose}>
          Abbrechen
        </Button>
        {/* No icon: a checkmark on a button that has not yet done anything reads as "done" rather than "do it". */}
        <Button
          type="submit"
          variant="primary"
          isDisabled={isPending}
          className={formButton({ intent: "submit" })}>
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
      </div>
    </Form>
  );
}
