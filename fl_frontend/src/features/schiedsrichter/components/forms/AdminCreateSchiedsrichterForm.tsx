"use client";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import { SchiedsrichterFormFields } from "./SchiedsrichterFormFields";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLKontakt } from "@/shared/schemas";

type SchiedsrichterDraft = { name: string; schule: string; kontakt: FLKontakt; default_payment: number };

const EMPTY_DRAFT: SchiedsrichterDraft = {
  name: "",
  schule: "",
  default_payment: 0,
  kontakt: { telefon: "", email: "" },
};

/**
 * `onCreated` receives the finished record — see the note on `AdminCreateSpielortForm`, which needs it
 * for the same reason: the match editor selects what it just created, and its picker's list still comes
 * from the last server render.
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
      onSubmit={async (draft) => {
        const kontakt = { telefon: draft.kontakt.telefon || null, email: draft.kontakt.email || null };
        const res = await postSchiedsrichterAction({
          name: draft.name,
          schule: draft.schule || null,
          default_payment: draft.default_payment,
          kontakt,
        });
        // A create only counts if the backend actually handed back an id.
        const success = res.success && !!res.created_id;

        if (success && res.created_id) {
          onCreated?.({
            id: res.created_id,
            name: draft.name,
            schule: draft.schule,
            kontakt,
            default_payment: draft.default_payment,
            // Just created, so current — and `null` is what current means (ADR-0032).
            inactive_since: null,
          });
        }

        return { ...res, success };
      }}
      successMessage="Schiedsrichter erfolgreich angelegt"
      onClose={onClose}
    />
  );
}
