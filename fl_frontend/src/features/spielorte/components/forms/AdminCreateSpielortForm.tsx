"use client";

import { postSpielortAction } from "@/features/spielorte/actions";
import SpielortFormFields from "@/features/spielorte/components/forms/SpielortFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { FLAddress } from "@/shared/schemas";

type SpielortDraft = { name: string; address: FLAddress; default_mietpreis: number };

const EMPTY_DRAFT: SpielortDraft = {
  name: "",
  address: { strasse: "", hausnummer: "", plz: "", stadt: "Frankfurt am Main", stadtteil: "" },
  default_mietpreis: 0,
};

export default function AdminCreateSpielortForm({ onClose }: { onClose: () => void }) {
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
        return { ...res, success: res.success && !!res.created_id };
      }}
      successMessage="Spielort erfolgreich angelegt"
      onClose={onClose}
    />
  );
}
