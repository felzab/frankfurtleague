"use client";

import { postSpielortAction } from "@/features/spielorte/actions";
import { SpielortFormFields } from "@/features/spielorte/components/forms/SpielortFormFields";
import { FLPostSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { formatAddressFull } from "@/shared/utils/format";

import type { FLSpielort } from "@/features/spielorte/schemas";
import type { SpielortDraft } from "@/features/spielorte/types";

/**
 * One mapping, read by the block and by the write alike: judging a shape the action does not send is how a form
 * comes to refuse what the server accepts.
 */
const toPayload = (draft: SpielortDraft) => ({
  name: draft.name,
  default_mietpreis: draft.default_mietpreis,
  address: draft.address,
});

const EMPTY_DRAFT: SpielortDraft = {
  name: "",
  address: { strasse: "", hausnummer: "", plz: "", stadt: "Frankfurt am Main", stadtteil: "" },
  // Empty, not 0: a venue nobody set a rent for has no rent entered, and the schema asks for one by name.
  default_mietpreis: null,
};

/**
 * `onCreated` hands back the finished record: the match editor's picker selects what it just
 * created, and its list still comes from the last server render. Composed here and not at the call
 * site, because it reproduces what `post_spielort` stores.
 */
export function AdminCreateSpielortForm({ onClose, onCreated }: { onClose: () => void; onCreated?: (created: FLSpielort) => void }) {
  return (
    <EntityForm<SpielortDraft>
      initialDraft={EMPTY_DRAFT}
      renderFields={(draft, setDraft) => (
        <SpielortFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      schema={FLPostSpielortPayloadSchema}
      toPayload={toPayload}
      onSubmit={async (draft) => {
        // The block in `EntityForm` has already proved this parses, so the record below reads the PARSED
        // rent rather than the draft's, which still carries the empty case.
        const payload = FLPostSpielortPayloadSchema.parse(toPayload(draft));
        const res = await postSpielortAction(payload);
        const success = res.success && !!res.created_id;

        if (success && res.created_id) {
          onCreated?.({
            id: res.created_id,
            name: draft.name,
            address: draft.address,
            // A plain search string, as the backend stores it; `formatMapsLink` wraps one for an href.
            maps_link: `${draft.name}, ${formatAddressFull(draft.address)}`,
            default_mietpreis: payload.default_mietpreis,
            // Just created, so current — and `null` is what current means.
            inactive_since: null,
          });
        }

        return { ...res, success };
      }}
      marksRequired
      successMessage="Spielort angelegt"
      onClose={onClose}
    />
  );
}
