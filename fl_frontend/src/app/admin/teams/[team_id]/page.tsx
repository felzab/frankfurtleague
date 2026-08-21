import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { buildGruppenSwapContext } from "@/features/saisons/utils";
import { getSpiele } from "@/features/spiele/queries";
import { AdminTeamEditView } from "@/features/teams/components/views/AdminTeamEditView";
import { getTeamMemberships } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { buildGruppeOffer } from "@/features/teams/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The team editor. One club per URL; WHICH season's membership it addresses is the sidemenu
 * selector's `?saison_id=`. It resolves nothing itself — see the match editor.
 */
export default function AdminTeamEditPage(props: NextPageProps<{ team_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminTeamEditContent
        params={props.params}
        searchParams={props.searchParams}
      />
    </Suspense>
  );
}

async function AdminTeamEditContent({
  params,
  searchParams,
}: {
  params: NextPageProps<{ team_id: string }>["params"];
  searchParams: NextPageProps["searchParams"];
}) {
  await connection();
  const teamId = await resolveTeamId(params);
  const requestedSaisonId = await resolveSaisonId(searchParams);

  // One read carries the record and every membership; the season list answers which season is
  // selected and its state.
  const [membershipsRes, saisonsRes] = await Promise.all([getTeamMemberships(), getSaisons()]);
  const saisons = saisonsRes.saisons;
  const selectedSaison = requestedSaisonId
    ? saisons.find((saison) => saison.id === requestedSaisonId)
    : saisons.find((saison) => saison.status === "active");
  if (!selectedSaison) {
    notFound();
  }

  const team = membershipsRes.teams.find((candidate) => candidate.id === teamId);
  if (!team) {
    notFound();
  }

  const membership = team.memberships.find((candidate) => candidate.saison_id === selectedSaison.id) ?? null;

  // The first read is the group lock's, counted over the club's own fixtures as `patch_saison_team`
  // counts them; the other two are the swap control's: `REQ-SWAP-002`, `REQ-SWAP-004`, `REQ-SWAP-005`.
  const [teamSpieleRes, playoffSpieleRes, gruppenSpieleRes] = await Promise.all([
    membership === null ? Promise.resolve(null) : getSpiele({ saison_id: selectedSaison.id, team_id: teamId, limit: 1 }),
    getSpiele({ saison_id: selectedSaison.id, saison_phase: "playoffs" }),
    getSpiele({ saison_id: selectedSaison.id, saison_phase: "gruppenphase" }),
  ]);
  // Whatever the season's status, because a `future` season is drawn before it is activated, so a
  // drawn one is the ordinary pre-activation state rather than an unreachable one (`REQ-ENTER-004`).
  const gruppeLocked = (teamSpieleRes?.spiele.length ?? 0) > 0;

  const saison: TeamSaisonMembership = {
    saisonId: selectedSaison.id,
    saisonStatus: selectedSaison.status,
    membership: membership === null ? null : { gruppe: membership.gruppe, austritt: membership.austritt },
  };

  // The season's groups with their fill state, counted over the same memberships read: a club
  // enters only a group with space.
  const gruppeOffer = buildGruppeOffer(
    selectedSaison.id,
    selectedSaison.rules,
    membershipsRes.teams.map((candidate) => candidate.memberships),
  );

  /**
   * Through the derivation the season editor uses, so both entry points grade a pair identically.
   * The club list is narrowed out of the memberships read already made, not a second `getTeams`.
   */
  const swap: SaisonGruppenSwapContext = buildGruppenSwapContext({
    teams: membershipsRes.teams.flatMap((candidate) => {
      const row = candidate.memberships.find((entry) => entry.saison_id === selectedSaison.id);
      return row === undefined ? [] : [{ id: candidate.id, name: candidate.name, gruppe: row.gruppe }];
    }),
    gruppenSpiele: gruppenSpieleRes.spiele,
    playoffSpiele: playoffSpieleRes.spiele,
  });

  return (
    // Keyed by the state the drafts mirror, for the match editor's reason.
    <AdminTeamEditView
      key={JSON.stringify({ team, saison, gruppeLocked })}
      team={team}
      saison={saison}
      gruppeLocked={gruppeLocked}
      gruppeOffer={gruppeOffer}
      swap={swap}
      today={getGermanTodayStr()}
    />
  );
}
