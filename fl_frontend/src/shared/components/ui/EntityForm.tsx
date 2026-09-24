"use client";

import { useState, useTransition } from "react";

import { Button } from "@heroui/react/button";

import { Form } from "@/shared/components/ui/Form";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { formButton, MODAL_FOOTER_ROW_CLASSES } from "./formButtons";
import { runOnSubmit } from "./formSubmit";

import type { ActionResult } from "@/shared/types/types";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ZodType } from "zod";

/**
 * The create and edit form skeleton, once. A call site guarding its own result does so to narrow a
 * payload field, never because this form reads one: what it answers is `ActionResult` and nothing more.
 */
export function EntityForm<TDraft, TPayload = TDraft>({
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
  /**
   * Handed the payload the block judged, never the draft: a payload step that normalises would otherwise judge
   * one value and send another. Answers the action's own result, the caller's guard on its created record folded in.
   */
  onSubmit: (payload: TPayload) => Promise<ActionResult>;
  /**
   * The one the action parses, so the block and the server state the same rules (`docs/frontend/spec.md` I18).
   * Parameterised: unparameterised it takes any schema, and a caller's own action then applies other rules.
   */
  schema: ZodType<TPayload>;
  /**
   * Required rather than defaulted to identity: a caller whose payload is not the draft would have the wrong shape
   * judged, and a silent identity passes everything.
   */
  toPayload: (draft: TDraft) => TPayload;
  /**
   * The title the create raises, and the action's own sentence stands beside it: this literal is
   * what `docs/frontend/spec.md :: I42`'s register reads, having no way to reach a server's words.
   */
  successMessage: string;
  onClose: () => void;
  /**
   * The required asterisks, and only a form that creates something sets it. It governs the marks alone: `isRequired`
   * still sits on the fields either way, and is what refuses an emptied one.
   */
  marksRequired?: boolean;
}) {
  const [isPending, startSaving] = useTransition();
  const [draft, setDraft] = useState<TDraft>(initialDraft);
  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { entity: schema },
  });

  // Retracts a message the moment the value it judged becomes valid, so a corrected field clears as it is
  // typed rather than at the next press.
  useForgiveFixed({ entity: toPayload(draft) });

  const handleSubmit = () => {
    const payload = toPayload(draft);
    // The block keeping an incomplete draft off the wire; it RUNS the write (`docs/frontend/spec.md :: I71`).
    guardSubmit({ entity: payload }, () => {
      writeAfterBlock(payload);
    });
  };

  const writeAfterBlock = (payload: TPayload) => {
    startSaving(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await onSubmit(payload).catch(unansweredAction);

      // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
      // so bare it commits before the pending state lifts.
      startSaving(() => {
        if (!res.success) {
          // The hook owns the press's one toast: none where a field shows the refusal.
          reportSubmitFailure(res, { entity: payload });
          return;
        }

        setSubmitFieldErrors({}, {});
        setDraft(initialDraft);
        // The server's sentence as the body (`docs/frontend/spec.md` §1.12), and never a second copy of
        // the title: an action with nothing to add sends the title's own words.
        appToast.success(successMessage, { description: res.message === successMessage ? undefined : res.message });
        onClose();
      });
    });
  };

  return (
    <Form
      ref={formRef}
      validationErrors={fieldErrors}
      // Read by the unlayered rule in `globals.css` that suppresses HeroUI's required asterisks. Emitted only
      // when on, so an absent attribute already means no marks.
      data-required-marks={marksRequired ? "on" : undefined}
      className="flex h-fit w-full flex-col gap-y-6 rounded-xl shadow-sm"
      onSubmit={runOnSubmit(handleSubmit)}>
      {/* No entrance: this mounts inside a modal already animating in, so its own would read as a double entrance. */}
      <div className="flex w-full flex-col gap-4 px-2">{renderFields(draft, setDraft)}</div>

      {/* The separator reaches the dialog's edges rather than the form's; `MODAL_FOOTER_CLASSES` owns the arithmetic. The
          action first and the way back second, as in every dialog footer (`docs/frontend/spec.md` §1.19). */}
      <div className={MODAL_FOOTER_ROW_CLASSES}>
        {/* No icon: a checkmark on a button that has not yet done anything reads as "done" rather than "do it". */}
        <Button
          type="submit"
          variant="primary"
          isPending={isPending}
          className={formButton({ intent: "submit" })}>
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
        {/* Held in flight: pressing it unmounts the modal from under a running transition, whose toast then
            fires against a dead tree — the record is created and nobody is told. */}
        <Button
          type="button"
          variant="secondary"
          isPending={isPending}
          className={formButton({ intent: "cancel" })}
          onPress={onClose}>
          Abbrechen
        </Button>
      </div>
    </Form>
  );
}
