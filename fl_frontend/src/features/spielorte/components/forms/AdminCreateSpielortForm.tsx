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
 * `onCreated` receives the finished record, for a caller that has to show it before the next server
 * render — the match editor's venue picker selects what it just created, and the picker's own list still
 * comes from the last render.
 *
 * **The record is composed here rather than at that call site**, because composing it means reproducing
 * what `post_spielort` stores: `maps_link` is `f"{name}, {address.to_string}, Deutschland"`
 * (`spielorte/admin_router.py`), and `formatAddressFull` assembles the same parts in the same order.
 * That reproduction belongs beside the action that causes it, not in a form in another slice.
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
        // A create only counts if the backend actually handed back an id.
        const success = res.success && !!res.created_id;

        if (success && res.created_id) {
          onCreated?.({
            id: res.created_id,
            name: draft.name,
            address: draft.address,
            // A plain search string, as the backend stores it — `formatMapsLink` is what wraps one for
            // an href.
            maps_link: `${draft.name}, ${formatAddressFull(draft.address)}`,
            default_mietpreis: draft.default_mietpreis,
            // Just created, so current — and `null` is what current means (ADR-0032).
            inactive_since: null,
          });
        }

        return { ...res, success };
      }}
      marksRequired
      successMessage="Spielort erfolgreich angelegt"
      onClose={onClose}
    />
  );
}
