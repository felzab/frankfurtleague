"use client";

import { patchSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import SchiedsrichterFormFields from "@/features/schiedsrichter/components/forms/SchiedsrichterFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

export default function AdminEditSchiedsrichterForm({
  schiedsrichterData,
  onClose,
}: {
  schiedsrichterData: FLSchiedsrichter;
  onClose: () => void;
}) {
  return (
    <EntityForm<FLSchiedsrichter>
      initialDraft={schiedsrichterData}
      renderFields={(draft, setDraft) => (
        <SchiedsrichterFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      onSubmit={async (draft) => {
        const res = await patchSchiedsrichterAction({
          id: schiedsrichterData.id,
          name: draft.name,
          schule: draft.schule || null,
          default_payment: draft.default_payment,
          kontakt: {
            telefon: draft.kontakt.telefon || null,
            email: draft.kontakt.email || null,
          },
        });
        // An edit only counts if the backend echoed the updated document back.
        return { ...res, success: res.success && !!res.updated_document };
      }}
      successMessage="Schiedsrichter erfolgreich bearbeitet"
      onClose={onClose}
    />
  );
}
