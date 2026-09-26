"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { postSperreAction } from "@/features/sperrliste/actions";
import { SPERRE_DAUER_HINWEIS } from "@/features/sperrliste/constants";
import { FLPostSperrlistePayloadSchema } from "@/features/sperrliste/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { TextField } from "@/shared/components/ui/TextField";

import type { FLPostSperrlistePayload } from "@/features/sperrliste/schemas";

const EMPTY_DRAFT: FLPostSperrlistePayload = { email: "", grund: "" };

/**
 * One mapping, read by the block and by the write alike: judging a shape the action does not send is
 * how a form comes to refuse what the server accepts.
 */
const toPayload = (draft: FLPostSperrlistePayload) => ({ email: draft.email, grund: draft.grund });

/**
 * **No `onCreated` twin to the other create forms**: the row the API answers with holds no address,
 * so nothing this form typed can be reassembled into one.
 */
export function AdminCreateSperreForm({ onClose }: { onClose: () => void }) {
  return (
    <EntityForm<FLPostSperrlistePayload>
      initialDraft={EMPTY_DRAFT}
      renderFields={(draft, setDraft) => (
        <>
          <TextField
            type="email"
            name="email"
            value={draft.email}
            // `value`/`onChange` belong on the field, not the inner `<Input>`: that is RAC's
            // controlled API, and on the input react-aria's field state never sees a value at all.
            onChange={(next) => setDraft({ ...draft, email: next })}>
            {/* „E-Mail“, as every neighbouring admin form labels the field. */}
            <Label className={FIELD_LABEL_CLASSES}>E-Mail</Label>
            {/* A submitted `type=email` value enters the browser's own autofill store, where the
                address of somebody being banned has no business being kept. */}
            <Input
              autoComplete="off"
              placeholder="z.B. name@beispiel.de"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
            {/* Both halves of what pressing save does to the person at this address: it lapses by
                itself, and they are told at once. Neither is undoable from the list afterwards. */}
            <Hint
              mode="field"
              text={SPERRE_DAUER_HINWEIS}
            />
          </TextField>

          <TextField
            name="grund"
            value={draft.grund}
            onChange={(next) => setDraft({ ...draft, grund: next })}>
            <Label className={FIELD_LABEL_CLASSES}>Grund</Label>
            <Input
              placeholder="z.B. falsches Geburtsdatum angegeben"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
            {/* The row is served back, copied into a removal's log image and kept past the person's
                erasure, so a name typed here outlives every record the erasure was meant to end. */}
            <Hint
              mode="field"
              text="Nenne hier keine Person beim Namen. Die Sperre bleibt bestehen, auch wenn die Daten der Person gelöscht werden."
            />
          </TextField>
        </>
      )}
      schema={FLPostSperrlistePayloadSchema}
      toPayload={toPayload}
      onSubmit={(payload) => postSperreAction(payload)}
      marksRequired
      successMessage="Adresse gesperrt"
      onClose={onClose}
    />
  );
}
