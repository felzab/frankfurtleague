"use client";

import { useState } from "react";

import { reactivateTeamAction } from "@/features/teams/actions";
import { AdminTeamEditForm } from "@/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm";
import { AdminDeleteTeamModal } from "@/features/teams/components/modals/AdminDeleteTeamModal";
import { TEAM_NICHT_STILLLEGBAR } from "@/features/teams/constants";
import { BRAND_TILE_CLASSES } from "@/shared/components/ui/brandTile";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { useReactivation } from "@/shared/hooks/useReactivation";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import type { TeamEinladungState } from "@/features/einladungen/types";
import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type { FLTeamRecord } from "@/features/teams/schemas";
import type { GruppeOffer, TeamSaisonMembership } from "@/features/teams/types";

/**
 * Every exit routes through the form's discard guard. The header states identity and nothing live; its one control is
 * the retirement or its return, because a club's retirement is club-level, not a form field.
 */
export function AdminTeamEditView({
  team,
  saison,
  gruppeLocked,
  gruppeOffer,
  swap,
  einladung,
  isRetireable,
  today,
}: {
  team: FLTeamRecord;
  saison: TeamSaisonMembership;
  gruppeLocked: boolean;
  /** The selected season's groups with their fill state, from `buildGruppeOffer`. */
  gruppeOffer: readonly GruppeOffer[];
  /** The selected season's swap state, for the club editor's entry point into it. */
  swap: SaisonGruppenSwapContext;
  /** `null` where the club holds no junction row for the season, which is where the page issues no read. */
  einladung: TeamEinladungState | null;
  /** Over EVERY season the club is in, never the selected one alone: `fl_frontend/src/features/teams/utils.ts :: isRetireable`. */
  isRetireable: boolean;
  today: string;
}) {
  const { isReactivating, reactivate } = useReactivation({ action: reactivateTeamAction, noun: "Team" });
  // The landing read as the dialog opens, which takes the focus off the pressed control.
  const [retiring, setRetiring] = useState<{ landed: () => void } | null>(null);

  const isRetired = team.inactive_since !== null;

  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminTeamEditForm
        team={team}
        saison={saison}
        today={today}
        gruppeLocked={gruppeLocked}
        gruppeOffer={gruppeOffer}
        swap={swap}
        einladung={einladung}
        pageHeader={{
          title: team.name,
          // Retirement outranks the Kürzel: the Kürzel is a field of the form below, the day is nowhere else.
          chip: isRetired ? (
            <RetiredBadge since={team.inactive_since} />
          ) : (
            // The TeamCard's own square, so the Kürzel wears one colour everywhere.
            <span className={`${DISPLAY_HEADING_CLASSES} ${BRAND_TILE_CLASSES}`}>{team.shorthand}</span>
          ),
          stilllegung: {
            isRetired,
            reactivate: { isPending: isReactivating, onPress: () => reactivate({ id: team.id }) },
            retire: {
              onPress: (pressed) => setRetiring(focusAfterWrite(pressed)),
              disabledReason: isRetireable ? null : TEAM_NICHT_STILLLEGBAR,
            },
          },
        }}
      />
      <AdminDeleteTeamModal
        teamData={team}
        isOpen={retiring !== null}
        onClose={() => setRetiring(null)}
        onRetired={() => retiring?.landed()}
      />
    </div>
  );
}
