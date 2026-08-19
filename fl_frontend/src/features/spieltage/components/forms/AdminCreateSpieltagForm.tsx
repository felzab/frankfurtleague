"use client";

import { postSpieltagAction } from "@/features/spieltage/actions";
import { SpieltagFormFields } from "@/features/spieltage/components/forms/SpieltagFormFields";
import { buildSpieltagPhaseOffer } from "@/features/spieltage/utils";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { SpieltagCreateDraft } from "@/features/spieltage/types";

/**
 * Creates one matchday in the season the page is showing.
 *
 * **Nothing is preselected, and there is no position to preselect** (ADR-0051). Where the new matchday
 * lands follows from the phase and the date the admin enters, so the form opens empty and the row appears
 * in its place — rather than opening on a guessed number the admin then has to check.
 */
export function AdminCreateSpieltagForm({
  saisonId,
  onClose,
  saisonSpan,
  saisonSchedule,
}: {
  saisonId: string;
  onClose: () => void;
  /** The season's own span, which bounds both date pickers (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  /** The season's derived per-phase match counts, shown beside each phase in the picker. */
  saisonSchedule?: readonly FLSaisonPhaseSchedule[];
}) {
  // Nothing is refused here and that is correct: a new matchday holds no fixtures, so every phase fits.
  // The counts are still shown, because "Finale — 1 Sp." is what tells an admin which phase they mean.
  const phaseOffer = buildSpieltagPhaseOffer(saisonSchedule ?? [], 0);

  return (
    <EntityForm<SpieltagCreateDraft>
      initialDraft={{
        beginn: "",
        ende: "",
        saison_phase: null,
        // The page's own season, resolved against the season list (ADR-0055) before this form mounts —
        // so it is a path no picker here renders and no refusal can name.
        saison_id: saisonId,
      }}
      renderFields={(draft, setDraft) => (
        <SpieltagFormFields
          draft={draft}
          onChange={setDraft}
          saisonSpan={saisonSpan}
          phaseOffer={phaseOffer}
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
