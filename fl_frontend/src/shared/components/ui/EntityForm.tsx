"use client";

import { useState, useTransition } from "react";

import { Button, Form } from "@heroui/react";

import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";

import { formButton, MODAL_FOOTER } from "./formButtons";

import type { FieldErrors } from "@/shared/utils/validation";
import type { Dispatch, ReactNode, SetStateAction } from "react";

/** What the `post*`/`patch*` server actions return, after the caller has folded in its own guard. */
type SubmitResult = { success: boolean; message?: string; error?: string; fieldErrors?: FieldErrors };

/**
 * The create/edit form skeleton, once. `AdminCreate*Form` and `AdminEdit*Form` came in four files
 * that were 76–78% identical: the same `useTransition`, the same `<Form action>`, the same
 * draft state, the same toast handling and the same button pair. Only the initial draft, the server
 * action, its success guard and the success string ever differed.
 *
 * The guard stays at the call site on purpose — create checks `created_id` and edit checks
 * `updated_document`, and folding that in here would mean this component knowing about both
 * response shapes.
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
   * Render the required asterisks. **Only a form that CREATES something sets it** (owner,
   * 2026-08-07): on a create every required field is genuinely a question, while on an edit every
   * value is already there and a column of red stars marks nothing the reader can act on.
   *
   * It governs the marks alone. `isRequired` still sits on the fields either way, because it is what
   * makes the browser refuse an emptied one — with its own message, in the browser's language.
   */
  marksRequired?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<TDraft>(initialDraft);
  // Fires when the server rejected a path no field renders — without it the submit would fail in
  // complete silence, because the toast below is suppressed whenever `fieldErrors` is non-empty.
  // The description names the situation rather than the error: there is no field to look at, so
  // "check the highlighted field" would send the reader hunting for one that does not exist.
  const { fieldErrors, setFieldErrors, formRef } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Bitte lade die Seite neu.",
    }),
  );

  const handleSubmit = () => {
    startTransition(async () => {
      const res = await onSubmit(draft);

      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});

        // A field-level rejection already says which field and why, at the field. The toast is for
        // the failures that belong to no field — a network error, a 500, a denied session.
        if (!hasFieldErrors(res.fieldErrors)) {
          appToast.danger("Speichern fehlgeschlagen", {
            description: res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.",
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
      // Read by the unlayered rule in `globals.css` that suppresses HeroUI's required asterisks.
      // On the form rather than per field, because the rule is about what KIND of form this is, and
      // emitted only when ON — that rule is an opt-in, so an absent attribute already means "no
      // marks" and every editor gets the right behaviour without carrying anything.
      data-required-marks={marksRequired ? "on" : undefined}
      className="flex h-fit w-full flex-col gap-y-4 rounded-xl shadow-sm"
      action={handleSubmit}>
      {/* No entrance animation: this mounts inside a modal that is already animating in, so its own
          fade+slide ran on top of the modal's and read as a double entrance. Motion here is reserved
          for state changes the user triggers (see the inline-create panel swap). */}
      <div className="flex w-full flex-col gap-4 px-2">{renderFields(draft, setDraft)}</div>

      {/* The separator reaches the DIALOG's edges, not the form's — see `MODAL_FOOTER`, which owns
          the arithmetic against `ModalShell`'s padding. */}
      <div className={MODAL_FOOTER}>
        <div className="flex w-full flex-row items-center justify-evenly gap-3">
          {/* Disabled while the mutation is in flight: pressing it unmounted the modal out
              from under a running transition, whose `toast.success` and draft reset then fired against
              a dead tree — so the record was created and the user was never told. */}
          <Button
            type="button"
            variant="secondary"
            isDisabled={isPending}
            className={formButton({ intent: "cancel" })}
            onPress={onClose}>
            Abbrechen
          </Button>
          {/* No icon (owner, 2026-08-07). A checkmark on a button that has not yet done anything
              reads as "done" rather than "do it", and the label already says which action this is. */}
          <Button
            type="submit"
            variant="primary"
            isDisabled={isPending}
            className={formButton({ intent: "submit" })}>
            {isPending ? "Speichert..." : "Speichern"}
          </Button>
        </div>
      </div>
    </Form>
  );
}
