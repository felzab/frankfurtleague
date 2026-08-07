"use client";

import { postSpieltagAction } from "@/features/spieltage/actions";
import { SpieltagFormFields } from "@/features/spieltage/components/forms/SpieltagFormFields";
import { EntityForm } from "@/shared/components/ui/EntityForm";

import type { SpieltagCreateDraft } from "@/features/spieltage/types";

/**
 * Creates one matchday in the season the page is showing.
 *
 * **`order_val` is preselected and the rest is not.** The form opens on the next free position after the
 * season's current last matchday, because laying out a season means adding matchdays in sequence and a
 * default of 0 would collide on the second one. Everything else starts empty: a phase the form guessed
 * would be the one field nobody re-reads.
 */
export function AdminCreateSpieltagForm({
  saisonId,
  nextOrderVal,
  orderValInUse,
  onClose,
}: {
  saisonId: string;
  /** One past the season's current highest `order_val`, or 0 for a season with no matchdays yet. */
  nextOrderVal: number;
  orderValInUse: readonly number[];
  onClose: () => void;
}) {
  return (
    <EntityForm<SpieltagCreateDraft>
      initialDraft={{
        name: "",
        beginn: "",
        ende: "",
        anzahl_spiele: 1,
        order_val: nextOrderVal,
        saison_phase: null,
        saison_id: saisonId,
      }}
      renderFields={(draft, setDraft) => (
        <SpieltagFormFields
          draft={draft}
          onChange={setDraft}
          orderValInUse={orderValInUse}
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
