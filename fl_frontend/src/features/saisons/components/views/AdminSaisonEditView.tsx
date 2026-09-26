"use client";

import { useState } from "react";

import { AdminSaisonEditForm } from "@/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm";
import { readShape, startingRedraw } from "@/features/saisons/components/forms/AdminSaisonEditForm/spielplanShape";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";

import type { RedrawDraft } from "@/features/saisons/components/forms/AdminSaisonEditForm/spielplanShape";
import type { FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas";
import type {
  SaisonDraftFields,
  SaisonGruppenSwapContext,
  SaisonReplacementContext,
  SaisonRolloverContext,
  SaisonSpielplanContext,
  SaisonSpieltagBound,
} from "@/features/saisons/types";

type AdminSaisonEditViewProps = {
  saison: { id: string; status: FLSaisonStatus } & Omit<SaisonDraftFields, "rules"> & { rules: FLSaisonRules };
  rollover: SaisonRolloverContext;
  swap: SaisonGruppenSwapContext;
  ersatz: SaisonReplacementContext;
  spielplan: SaisonSpielplanContext;
  hasDrawnSpiele: boolean;
  spieltagBound: SaisonSpieltagBound;
};

/**
 * The body of `/admin/saisons/[saison_id]`. **The header carries no control and states no value**: a
 * season cannot be retired, and the dates and status are shown where they can be changed.
 */
export function AdminSaisonEditView(props: AdminSaisonEditViewProps) {
  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <SaisonRedrawHolder
        // The season and the stored three the redraw's typing starts from, never the whole record: a save moves the
        // record, and keyed by it the typing and the save's pending exit would go with the refresh.
        key={JSON.stringify({ id: props.saison.id, shape: readShape(props.saison.rules) })}
        {...props}
      />
    </div>
  );
}

/** Holds what outlives a save: the redraw's typing, which the save never writes, and the save's exit waiting over it. */
function SaisonRedrawHolder({ saison, rollover, swap, ersatz, spielplan, hasDrawnSpiele, spieltagBound }: AdminSaisonEditViewProps) {
  const [redraw, setRedraw] = useState<RedrawDraft>(() => startingRedraw(saison.rules));
  const [isSaveExitAsked, setSaveExitAsked] = useState(false);

  return (
    <AdminSaisonEditForm
      // Keyed by the state the drafts mirror (`docs/frontend/spec.md :: The editor's subtree is keyed by the fixture's stored state`).
      key={JSON.stringify({ saison, spielplan })}
      saison={saison}
      rollover={rollover}
      swap={swap}
      ersatz={ersatz}
      spielplan={spielplan}
      hasDrawnSpiele={hasDrawnSpiele}
      spieltagBound={spieltagBound}
      pageHeader={{ title: `Saison ${saison.id}` }}
      redraw={redraw}
      onRedrawChange={setRedraw}
      isSaveExitAsked={isSaveExitAsked}
      onSaveExitAskedChange={setSaveExitAsked}
    />
  );
}
