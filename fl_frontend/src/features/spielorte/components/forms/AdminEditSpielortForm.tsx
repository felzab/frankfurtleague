"use client";

import { patchSpielortAction } from "@/features/spielorte/actions";
import { SpielortFormFields } from "@/features/spielorte/components/forms/SpielortFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminEditSpielortForm({ ortData, onClose }: { ortData: FLSpielort; onClose: () => void }) {
  return (
    <EntityForm<FLSpielort>
      initialDraft={ortData}
      renderFields={(draft, setDraft) => (
        <SpielortFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      onSubmit={async (draft) => {
        const res = await patchSpielortAction({
          id: ortData.id,
          name: draft.name,
          default_mietpreis: draft.default_mietpreis,
          address: draft.address,
        });
        // An edit only counts if the backend echoed the updated document back.
        return { ...res, success: res.success && !!res.updated_document };
      }}
      successMessage="Spielort erfolgreich bearbeitet"
      onClose={onClose}
    />
  );
}
