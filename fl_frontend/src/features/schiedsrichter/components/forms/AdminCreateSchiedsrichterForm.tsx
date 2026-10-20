"use client";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { FLPostSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { versandWarnt } from "@/shared/utils/linkVersand";

import { SchiedsrichterFormFields } from "./SchiedsrichterFormFields";

import type { FLSchiedsrichterAngezeigt, SchiedsrichterDraft } from "@/features/schiedsrichter/types";
import type { LinkVersand } from "@/shared/utils/linkVersand";

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
 * `onCreated` hands back the finished record: the match editor lists what it just created, its picker's
 * list still coming from the last server render.
 */
export function AdminCreateSchiedsrichterForm({
  onClose,
  onCreated,
  successMessage = "Schiedsrichter angelegt",
}: {
  onClose: () => void;
  // The displayed shape rather than the stored one: a record created here carries a validated name,
  // which is what lets a picker that must render a name take it without a null case.
  onCreated?: (created: FLSchiedsrichterAngezeigt) => void;
  /** A clean create's toast title, a literal at each call site for `EntityForm`'s `successMessage` reason. */
  successMessage?: string;
}) {
  return (
    <EntityForm<SchiedsrichterDraft, SchiedsrichterDraft, { versand: LinkVersand }>
      initialDraft={EMPTY_DRAFT}
      renderFields={(draft, setDraft) => (
        <SchiedsrichterFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      schema={FLPostSchiedsrichterPayloadSchema}
      toPayload={toPayload}
      onSubmit={async (payload) => {
        // The block in `EntityForm` has already proved this parses, so the record below reads the PARSED
        // fee rather than the payload's, whose type still carries the empty case.
        const parsed = FLPostSchiedsrichterPayloadSchema.parse(payload);
        const res = await postSchiedsrichterAction(parsed);

        if (!res.success) return res;

        onCreated?.({
          id: res.created_id,
          name: parsed.name,
          schule: parsed.schule,
          kontakt: parsed.kontakt,
          default_payment: parsed.default_payment,
          // Just created, so current — and `null` is what current means.
          inactive_since: null,
        });

        return res;
      }}
      marksRequired
      // The create mails the new referee their confirmation link.
      stepUp
      successMessage={successMessage}
      // Saved whatever the link did: one that did not go out leaves the referee no way to confirm.
      warning={{ title: "Mit Folgen angelegt", when: (saved) => versandWarnt(saved.versand) }}
      onClose={onClose}
    />
  );
}
