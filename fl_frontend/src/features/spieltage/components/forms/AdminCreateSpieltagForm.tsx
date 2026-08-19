"use client";

import { postSpieltagAction } from "@/features/spieltage/actions";
import { SpieltagFormFields } from "@/features/spieltage/components/forms/SpieltagFormFields";
import { buildSpieltagPhaseOffer } from "@/features/spieltage/utils";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { SpieltagCreateDraft } from "@/features/spieltage/types";

/**
 * **Nothing is preselected, and there is no position to preselect**: where the new matchday lands
 * follows from the phase and the date, so the form opens empty and the row appears in its place.
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
  // Nothing is refused here and that is correct: a new matchday holds no fixtures, so every phase
  // fits. The counts still show, because "Finale — 1 Sp." tells an admin which phase they mean.
  const phaseOffer = buildSpieltagPhaseOffer(saisonSchedule ?? [], 0);

  return (
    <EntityForm<SpieltagCreateDraft>
      initialDraft={{
        beginn: "",
        ende: "",
        saison_phase: null,
        // The page's own season, resolved before this form mounts: no picker renders it and no
        // refusal can name it.
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
        // Submitted with `saison_phase` possibly still null: the action's schema turns that into a
        // field error rather than a silently chosen phase.
        const res = await postSpieltagAction(draft);
        return { ...res, success: res.success && !!res.spieltag_id };
      }}
      marksRequired
      successMessage="Spieltag angelegt"
      onClose={onClose}
    />
  );
}
