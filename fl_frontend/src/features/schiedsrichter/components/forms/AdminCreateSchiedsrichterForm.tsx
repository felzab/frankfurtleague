"use client";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { FLPostSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import { SchiedsrichterFormFields } from "./SchiedsrichterFormFields";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { SchiedsrichterDraft } from "@/features/schiedsrichter/types";

/**
 * One mapping, read by the block and by the write alike: judging a shape the action does not send is how a form
 * comes to refuse what the server accepts.
 */
const toPayload = (draft: SchiedsrichterDraft) => ({
  name: draft.name,
  schule: draft.schule || null,
  default_payment: draft.default_payment,
  kontakt: { telefon: draft.kontakt.telefon || null, email: draft.kontakt.email || null },
});

const EMPTY_DRAFT: SchiedsrichterDraft = {
  name: "",
  schule: "",
  // Empty, not 0: a referee nobody set a fee for has no fee entered, and the schema asks for one by name.
  default_payment: null,
  kontakt: { telefon: "", email: "" },
};

/**
 * `onCreated` hands back the finished record: the match editor selects what it just created, and
 * its picker's list still comes from the last server render.
 */
export function AdminCreateSchiedsrichterForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (created: FLSchiedsrichter) => void;
}) {
  return (
    <EntityForm<SchiedsrichterDraft>
      initialDraft={EMPTY_DRAFT}
      renderFields={(draft, setDraft) => (
        <SchiedsrichterFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      schema={FLPostSchiedsrichterPayloadSchema}
      toPayload={toPayload}
      onSubmit={async (draft) => {
        // The block in `EntityForm` has already proved this parses, so the record below reads the PARSED
        // fee rather than the draft's, which still carries the empty case.
        const payload = FLPostSchiedsrichterPayloadSchema.parse(toPayload(draft));
        const res = await postSchiedsrichterAction(payload);
        const success = res.success && !!res.created_id;

        if (success && res.created_id) {
          onCreated?.({
            id: res.created_id,
            name: draft.name,
            schule: draft.schule,
            kontakt: payload.kontakt,
            default_payment: payload.default_payment,
            // Just created, so current — and `null` is what current means.
            inactive_since: null,
          });
        }

        return { ...res, success };
      }}
      marksRequired
      successMessage="Schiedsrichter angelegt"
      onClose={onClose}
    />
  );
}
