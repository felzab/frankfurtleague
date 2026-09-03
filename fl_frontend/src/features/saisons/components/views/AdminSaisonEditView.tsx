"use client";

import { AdminSaisonEditForm } from "@/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas";
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
  saison: { id: string; status: FLSaisonStatus } & Omit<SaisonDraftFields, "rules"> & { rules: FLSaisonRules };
  rollover: SaisonRolloverContext;
  swap: SaisonGruppenSwapContext;
  ersatz: SaisonReplacementContext;
  spielplan: SaisonSpielplanContext;
  hasDrawnSpiele: boolean;
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
