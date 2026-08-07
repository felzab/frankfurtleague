"use client";

import { patchSpieltagAction } from "@/features/spieltage/actions";
import { SpieltagFormFields } from "@/features/spieltage/components/forms/SpieltagFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { FLPatchSpieltagPayload } from "@/features/spieltage/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";

/**
 * Edits one matchday.
 *
 * **No `marksRequired`** (owner, 2026-08-07): on an edit every value is already there, so a column of red
 * stars marks nothing the reader can act on. `isRequired` still sits on the fields, which is what makes
 * the browser refuse an emptied one.
 *
 * `saison_id` is on neither the draft nor the payload. Moving a matchday between seasons would strand its
 * matches, which carry their own and are not rewritten by this endpoint. Its POSITION is on neither
 * either, and for a different reason: the order is derived, so moving a matchday is editing its date
 * (ADR-0064).
 */
export function AdminEditSpieltagForm({ spieltag, onClose }: { spieltag: AdminSpieltagRow; onClose: () => void }) {
  return (
    <EntityForm<FLPatchSpieltagPayload>
      initialDraft={{
        id: spieltag.id,
        beginn: spieltag.beginn,
        ende: spieltag.ende,
        saison_phase: spieltag.saison_phase,
      }}
      renderFields={(draft, setDraft) => (
        <SpieltagFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      onSubmit={async (draft) => {
        const res = await patchSpieltagAction(draft);
        // A patch only counts if the backend echoed the updated document back.
        return { ...res, success: res.success && !!res.spieltag?.updated_document };
      }}
      successMessage="Spieltag gespeichert"
      onClose={onClose}
    />
  );
}
