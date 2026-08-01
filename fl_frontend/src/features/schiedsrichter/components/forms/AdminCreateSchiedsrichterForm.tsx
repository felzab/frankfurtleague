"use client";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import { SchiedsrichterFormFields } from "./SchiedsrichterFormFields";

import type { FLKontakt } from "@/shared/schemas";

type SchiedsrichterDraft = { name: string; schule: string; kontakt: FLKontakt; default_payment: number };

const EMPTY_DRAFT: SchiedsrichterDraft = {
  name: "",
  schule: "",
  default_payment: 0,
  kontakt: { telefon: "", email: "" },
};

export function AdminCreateSchiedsrichterForm({ onClose }: { onClose: () => void }) {
  return (
    <EntityForm<SchiedsrichterDraft>
      initialDraft={EMPTY_DRAFT}
      renderFields={(draft, setDraft) => (
        <SchiedsrichterFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      onSubmit={async (draft) => {
        const res = await postSchiedsrichterAction({
          name: draft.name,
          schule: draft.schule || null,
          default_payment: draft.default_payment,
          kontakt: {
            telefon: draft.kontakt.telefon || null,
            email: draft.kontakt.email || null,
          },
        });
        // A create only counts if the backend actually handed back an id.
        return { ...res, success: res.success && !!res.created_id };
      }}
      successMessage="Schiedsrichter erfolgreich angelegt"
      onClose={onClose}
    />
  );
}
