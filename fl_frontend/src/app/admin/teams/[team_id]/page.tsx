import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { EinladungLinkHolder } from "@/features/einladungen/components/EinladungLinkHolder";
import { getEinladung } from "@/features/einladungen/queries";
import { getAdminSaisons } from "@/features/saisons/queries";
import { resolveSaisonId, selectSaison } from "@/features/saisons/resolvers";
import { buildGruppenSwapContext } from "@/features/saisons/utils";
import { getAdminSpiele } from "@/features/spiele/queries";
import { AdminTeamEditView } from "@/features/teams/components/views/AdminTeamEditView";
import { getTeamMemberships } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { buildGruppeOffer } from "@/features/teams/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { TeamEinladungState } from "@/features/einladungen/types";
import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The team editor. One club per URL; WHICH season's membership it addresses is the sidemenu
 * selector's `?saison_id=`. It resolves nothing itself (`docs/frontend/spec.md :: I22`).
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
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");

  const [membershipsRes, saisonsRes] = await Promise.all([getTeamMemberships(), getAdminSaisons()]);
  const selectedSaison = selectSaison(saisonsRes.saisons, requestedSaisonId);
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
  /* The invite's state joins the group rather than waiting behind it: nothing here depends on
     another's answer, and read after them it would add its own round trip to the page's wait. */
  const [teamSpieleRes, playoffSpieleRes, gruppenSpieleRes, einladungRes] = await Promise.all([
    membership === null ? Promise.resolve(null) : getAdminSpiele({ saison_id: selectedSaison.id, team_id: teamId, limit: 1 }),
    getAdminSpiele({ saison_id: selectedSaison.id, saison_phase: "playoffs" }),
    getAdminSpiele({ saison_id: selectedSaison.id, saison_phase: "gruppenphase" }),
    // Asked only for a club that holds the season's junction row: the endpoint answers
    // `REQ-EINLADUNG-001` for one that does not, and a page cannot render a refusal it asked for.
    membership === null ? Promise.resolve(null) : getEinladung(teamId, selectedSaison.id),
  ]);
  // Whatever the season's status, because a `future` season is drawn before it is activated, so a
  // drawn one is the ordinary pre-activation state rather than an unreachable one (`REQ-ENTER-004`).
  const gruppeLocked = (teamSpieleRes?.spiele.length ?? 0) > 0;

  const einladung: TeamEinladungState | null =
    einladungRes === null ? null : { einladung: einladungRes.einladung, laeuft: einladungRes.laeuft };

  const saison: TeamSaisonMembership = {
    saisonId: selectedSaison.id,
    saisonStatus: selectedSaison.status,
    membership:
      membership === null
        ? null
        : {
            gruppe: membership.gruppe,
            austritt: membership.austritt,
            trikot_farbe: membership.trikot_farbe,
            kontakte: membership.kontakte,
            kontakte_stand: membership.kontakte_stand,
          },
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
   * The club list is narrowed out of the memberships read already made, not a second `getAdminTeams`.
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
    // OUTSIDE the key, which is the whole of what it is for: a save on any panel re-keys the view
    // below, and the minted link is the one value on this page no read can serve back.
    <EinladungLinkHolder scope={`${teamId}:${selectedSaison.id}`}>
      {/* Keyed by the state the drafts mirror (`docs/frontend/spec.md :: The editor's subtree is keyed by the fixture's stored state`). */}
      <AdminTeamEditView
        key={JSON.stringify({ team, saison, gruppeLocked })}
        team={team}
        saison={saison}
        gruppeLocked={gruppeLocked}
        gruppeOffer={gruppeOffer}
        swap={swap}
        einladung={einladung}
        today={getGermanTodayStr()}
      />
    </EinladungLinkHolder>
  );
}
