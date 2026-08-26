"use client";

import { useTransition } from "react";

import { reactivateTeamAction } from "@/features/teams/actions";
import { AdminTeamEditForm } from "@/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type { FLTeamRecord } from "@/features/teams/schemas";
import type { GruppeOffer, TeamSaisonMembership } from "@/features/teams/types";

/**
 * Every exit routes through the form's discard guard. The header states identity and nothing live;
 * its one control is reactivation, because a retired club's state is club-level, not a form field.
 */
export function AdminTeamEditView({
  team,
  saison,
  gruppeLocked,
  gruppeOffer,
  swap,
  today,
}: {
  team: FLTeamRecord;
  saison: TeamSaisonMembership;
  gruppeLocked: boolean;
  /** The selected season's groups with their fill state, from `buildGruppeOffer`. */
  gruppeOffer: readonly GruppeOffer[];
  /** The selected season's swap state, for the club editor's entry point into it. */
  swap: SaisonGruppenSwapContext;
  today: string;
}) {
  const [isReactivating, startReactivating] = useTransition();

  const isRetired = team.inactive_since !== null;

  const handleReactivate = () => {
    startReactivating(async () => {
      const res = await reactivateTeamAction({ id: team.id });
      if (res.success) appToast.success(res.message ?? "Team reaktiviert!");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminTeamEditForm
        team={team}
        saison={saison}
        today={today}
        gruppeLocked={gruppeLocked}
        gruppeOffer={gruppeOffer}
        swap={swap}
        pageHeader={{
          title: team.name,
          // Retirement outranks the Kürzel: the Kürzel is a field of the form below, the day is nowhere else.
          chip: isRetired ? (
            <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(team.inactive_since)}</span>
          ) : (
            // The TeamCard's chip, so the Kürzel wears one colour everywhere.
            <span className="bg-brand-solid text-brand-solid-foreground flex h-10 w-10 items-center justify-center rounded-xl font-extrabold shadow-sm">
              {team.shorthand}
            </span>
          ),
          reactivate: isRetired ? { isPending: isReactivating, onPress: handleReactivate } : undefined,
        }}
      />
    </div>
  );
}
