"use client";

import { postSpielortAction } from "@/features/spielorte/actions";
import { SpielortFormFields } from "@/features/spielorte/components/forms/SpielortFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { formatAddressFull } from "@/shared/utils/format";

import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLAddress } from "@/shared/schemas";

type SpielortDraft = { name: string; address: FLAddress; default_mietpreis: number };

const EMPTY_DRAFT: SpielortDraft = {
  name: "",
  address: { strasse: "", hausnummer: "", plz: "", stadt: "Frankfurt am Main", stadtteil: "" },
  default_mietpreis: 0,
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
      onSubmit={async (draft) => {
        const res = await postSpielortAction({
          name: draft.name,
          default_mietpreis: draft.default_mietpreis,
          address: draft.address,
        });
        const success = res.success && !!res.created_id;

        if (success && res.created_id) {
          onCreated?.({
            id: res.created_id,
            name: draft.name,
            address: draft.address,
            // A plain search string, as the backend stores it; `formatMapsLink` wraps one for an href.
            maps_link: `${draft.name}, ${formatAddressFull(draft.address)}`,
            default_mietpreis: draft.default_mietpreis,
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
