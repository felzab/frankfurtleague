"use client";

import { useState, useTransition } from "react";

import { Check } from "@gravity-ui/icons";

import { Button, Form, toast } from "@heroui/react";

import { formButton } from "./formButtons";

import type { Dispatch, ReactNode, SetStateAction } from "react";

/** What the `post*`/`patch*` server actions return, after the caller has folded in its own guard. */
type SubmitResult = { success: boolean; message?: string; error?: string };

/**
 * The create/edit form skeleton, once. `AdminCreate*Form` and `AdminEdit*Form` came in four files
 * that were 76–78% identical (R2 §3.1): the same `useTransition`, the same `<Form action>`, the same
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
}: {
  initialDraft: TDraft;
  renderFields: (draft: TDraft, setDraft: Dispatch<SetStateAction<TDraft>>) => ReactNode;
  onSubmit: (draft: TDraft) => Promise<SubmitResult>;
  successMessage: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<TDraft>(initialDraft);

  const handleSubmit = () => {
    startTransition(async () => {
      const res = await onSubmit(draft);

      if (!res.success) {
        toast.danger(res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.");
        return;
      }

      setDraft(initialDraft);
      toast.success(res.message || successMessage);
      onClose();
    });
  };

  return (
    <Form
      className="flex h-fit w-full flex-col gap-y-4 rounded-xl shadow-sm"
      action={handleSubmit}>
      {/* No entrance animation: this mounts inside a modal that is already animating in, so its own
          fade+slide ran on top of the modal's and read as a double entrance. Motion here is reserved
          for state changes the user triggers (see the inline-create panel swap). */}
      <div className="flex w-full flex-col gap-4 px-2">{renderFields(draft, setDraft)}</div>

      <div className="flex h-fit w-full flex-row items-center justify-evenly gap-3 pt-4">
        {/* `isDisabled={isPending}` on this one is Wave 6's R4-3.4, deliberately not done here. */}
        <Button
          type="button"
          variant="secondary"
          className={formButton({ intent: "cancel" })}
          onPress={onClose}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={isPending}
          className={formButton({ intent: "submit" })}>
          <Check
            className="m-0"
            width={20}
            height={20}
          />
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
      </div>
    </Form>
  );
}
