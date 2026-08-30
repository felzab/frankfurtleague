"use client";

import { useState, useTransition } from "react";

import { Button, Form } from "@heroui/react";

import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import { formButton, MODAL_FOOTER_ROW } from "./formButtons";
import { runOnSubmit } from "./formSubmit";

import type { FieldErrors } from "@/shared/utils/validation";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ZodType } from "zod";

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
  schema,
  toPayload,
  successMessage,
  onClose,
  marksRequired = false,
}: {
  initialDraft: TDraft;
  renderFields: (draft: TDraft, setDraft: Dispatch<SetStateAction<TDraft>>) => ReactNode;
  onSubmit: (draft: TDraft) => Promise<SubmitResult>;
  /** The one the action parses, so the block and the server state the same rules (`docs/frontend/spec.md` I18). */
  schema: ZodType;
  /**
   * Required rather than defaulted to identity: two of the callers assemble a payload that is not the draft, and a
   * silent identity would judge the wrong shape and pass everything.
   */
  toPayload: (draft: TDraft) => unknown;
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
  const { fieldErrors, setSubmitFieldErrors, guardSubmit, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { entity: schema },
  });

  // Retracts a message the moment the value it judged becomes valid, so a corrected field clears as it is
  // typed rather than at the next press.
  useForgiveFixed({ entity: toPayload(draft) });

  const handleSubmit = () => {
    const payload = toPayload(draft);
    // `aria` blocks nothing natively, so without this an empty required field reaches the server unannounced.
    // It RUNS the write: an answer returned here can be dropped at the call site with everything still green.
    guardSubmit({ entity: payload }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    const payload = toPayload(draft);

    startTransition(async () => {
      const res = await onSubmit(draft);

      if (!res.success) {
        setSubmitFieldErrors(res.fieldErrors ?? {}, { entity: payload });

        // A field-level rejection already speaks at the field; the toast is for a failure belonging to none.
        if (!hasFieldErrors(res.fieldErrors)) {
          appToast.danger("Speichern fehlgeschlagen", {
            description: res.error || res.message || UNKNOWN_REFUSAL,
          });
        }
        return;
      }

      setSubmitFieldErrors({}, {});
      setDraft(initialDraft);
      appToast.success(res.message || successMessage);
      onClose();
    });
  };

  return (
    <Form
      // Missing belongs to the submit, not to a blur: `native` commits on every DOM `change`, painting the
      // browser's message the moment an edited field is cleared. `aria` blocks nothing, so `guardSubmit`
      // above is what refuses an emptied field.
      validationBehavior="aria"
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
