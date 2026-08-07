"use client";

import { postSpieltagAction } from "@/features/spieltage/actions";
import { SpieltagFormFields } from "@/features/spieltage/components/forms/SpieltagFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { SpieltagCreateDraft } from "@/features/spieltage/types";

/**
 * Creates one matchday in the season the page is showing.
 *
 * **Nothing is preselected, and there is no position to preselect** (ADR-0064). Where the new matchday
 * lands follows from the phase and the date the admin enters, so the form opens empty and the row appears
 * in its place — rather than opening on a guessed number the admin then has to check.
 */
export function AdminCreateSpieltagForm({ saisonId, onClose }: { saisonId: string; onClose: () => void }) {
  return (
    <EntityForm<SpieltagCreateDraft>
      initialDraft={{
        beginn: "",
        ende: "",
        saison_phase: null,
        saison_id: saisonId,
      }}
      renderFields={(draft, setDraft) => (
        <SpieltagFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      onSubmit={async (draft) => {
        // Submitted with `saison_phase` possibly still null: the action's schema refuses that with a
        // field message, so an untouched picker is a field error rather than a silently chosen phase.
        const res = await postSpieltagAction(draft);
        // A create only counts if the backend echoed the new id back.
        return { ...res, success: res.success && !!res.spieltag_id };
      }}
      marksRequired
      successMessage="Spieltag angelegt"
      onClose={onClose}
    />
  );
}
