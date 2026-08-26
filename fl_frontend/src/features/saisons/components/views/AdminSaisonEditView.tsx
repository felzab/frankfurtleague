"use client";

import { AdminSaisonEditForm } from "@/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type {
  SaisonDraftFields,
  SaisonGruppenSwapContext,
  SaisonReplacementContext,
  SaisonRolloverContext,
  SaisonSpielplanContext,
  SaisonSpieltagBound,
} from "@/features/saisons/types";

/**
 * The body of `/admin/saisons/[saison_id]`. **The header carries no control and states no value**: a
 * season cannot be retired, and the dates and status are shown where they can be changed.
 */
export function AdminSaisonEditView({
  saison,
  rollover,
  swap,
  ersatz,
  spielplan,
  hasDrawnSpiele,
  spieltagBound,
}: {
  saison: { id: string; status: FLSaisonStatus } & SaisonDraftFields;
  rollover: SaisonRolloverContext;
  /** This season's clubs and their groups, plus the knockout count that closes the swap. */
  swap: SaisonGruppenSwapContext;
  /** This season's junction rows, and the league's clubs that could take one of them over. */
  ersatz: SaisonReplacementContext;
  /** The season's draw watermark and its matchday count, which decide whether a draw is still offered. */
  spielplan: SaisonSpielplanContext;
  /** Whether the season holds fixtures, which is what freezes the rules they were drawn from. */
  hasDrawnSpiele: boolean;
  /** The span the dated matchdays already occupy, which the date pickers may not shrink past. */
  spieltagBound: SaisonSpieltagBound;
}) {
  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSaisonEditForm
        saison={saison}
        rollover={rollover}
        swap={swap}
        ersatz={ersatz}
        spielplan={spielplan}
        hasDrawnSpiele={hasDrawnSpiele}
        spieltagBound={spieltagBound}
        pageHeader={{ title: `Saison ${saison.id}` }}
      />
    </div>
  );
}
