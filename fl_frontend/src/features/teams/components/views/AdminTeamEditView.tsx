"use client";

import { reactivateTeamAction } from "@/features/teams/actions";
import { AdminTeamEditForm } from "@/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm";
import { BRAND_TILE } from "@/shared/components/ui/brandTile";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
/**
 * Every exit routes through the form's discard guard. The header states identity and nothing live;
 * its one control is reactivation, because a retired club's state is club-level, not a form field.
 */
import { useReactivation } from "@/shared/hooks/useReactivation";

import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type { FLTeamRecord } from "@/features/teams/schemas";
import type { GruppeOffer, TeamSaisonMembership } from "@/features/teams/types";

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
  const { isReactivating, reactivate } = useReactivation({ action: reactivateTeamAction, noun: "Team" });

  const isRetired = team.inactive_since !== null;

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
            <RetiredBadge since={team.inactive_since} />
          ) : (
            // The TeamCard's own square, so the Kürzel wears one colour everywhere.
            <span className={`${DISPLAY_HEADING} ${BRAND_TILE}`}>{team.shorthand}</span>
          ),
          reactivate: isRetired ? { isPending: isReactivating, onPress: () => reactivate({ id: team.id }) } : undefined,
        }}
      />
    </div>
  );
}
