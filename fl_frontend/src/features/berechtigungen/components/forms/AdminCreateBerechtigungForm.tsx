"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { postBerechtigungAction } from "@/features/berechtigungen/actions";
import { ZUGANG_BEANTRAGT, ZUGANG_ERTEILT } from "@/features/berechtigungen/constants";
import { FLPostBerechtigungPayloadSchema } from "@/features/berechtigungen/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { TextField } from "@/shared/components/ui/TextField";

import type { FLPostGrantPayload } from "@/core/generated/client/types";

const EMPTY_DRAFT: FLPostGrantPayload = { email: "" };

/** One mapping, read by the block and by the write alike. */
const toPayload = (draft: FLPostGrantPayload) => ({ email: draft.email });

/**
 * **No `onCreated`**: the grant takes effect on the person's next request and the list refreshes
 * under the spine, so nothing typed here is carried anywhere else.
 */
export function AdminCreateBerechtigungForm({ onClose }: { onClose: () => void }) {
  return (
    <EntityForm<FLPostGrantPayload, FLPostGrantPayload, { beantragt: boolean }>
      initialDraft={EMPTY_DRAFT}
      renderFields={(draft, setDraft) => (
        <TextField
          type="email"
          name="email"
          value={draft.email}
          onChange={(next) => setDraft({ ...draft, email: next })}>
          {/* „E-Mail“, as every neighbouring admin form labels the field. */}
          <Label className={FIELD_LABEL_CLASSES}>E-Mail</Label>
          <Input
            autoComplete="off"
            placeholder="z.B. name@beispiel.de"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>
      )}
      schema={FLPostBerechtigungPayloadSchema}
      toPayload={toPayload}
      onSubmit={(payload) => postBerechtigungAction(payload)}
      marksRequired
      // The action's own window: a grant outlives the session making it.
      stepUp="enrolment"
      // Saved as a request rather than the grant, a save that stood like any other: the title must not say a grant was
      // made that waits on another administrator. The tier panel titles its promotion's request the same way.
      successMessage={(saved) => (saved.beantragt ? ZUGANG_BEANTRAGT : ZUGANG_ERTEILT)}
      onClose={onClose}
    />
  );
}
