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
 * The team editor. One team per URL; WHICH season's membership the editor addresses is
 * the sidemenu selector's `?saison_id=` (decided 2026-08-07) — switching the selector switches
 * what the Saison panel shows and writes.
 *
 * No `generateMetadata` and no `generateStaticParams`, for the reasons the match editor records.
 * **The page itself resolves NOTHING** — every await happens inside the `Suspense` boundary, which
 * is what keeps a fallback-params route renderable (the match editor documents the crash).
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

  // One read carries the team's record and every membership; the season list answers which season
  // is selected (the current one when the URL names none) and what state it is in.
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

  // The rule (decided 2026-08-07): the group may move only while the season has not started — no
  // fixture of the team's exists in it yet — or while the season is still `future`.
  // The two phase-scoped reads beside it are the swap control's, asking the endpoint's own
  // questions: `playoffs` is the set `REQ-SWAP-002` counts, `gruppenphase` the one `REQ-SWAP-004` and
  // `REQ-SWAP-005` read. Both are cached public reads on the season's granular tag.
  const [teamSpieleRes, playoffSpieleRes, gruppenSpieleRes] = await Promise.all([
    membership === null ? Promise.resolve(null) : getSpiele({ saison_id: selectedSaison.id, team_id: teamId, limit: 1 }),
    getSpiele({ saison_id: selectedSaison.id, saison_phase: "playoffs" }),
    getSpiele({ saison_id: selectedSaison.id, saison_phase: "gruppenphase" }),
  ]);
  const gruppeLocked = selectedSaison.status !== "future" && (teamSpieleRes?.spiele.length ?? 0) > 0;

  const saison: TeamSaisonMembership = {
    saisonId: selectedSaison.id,
    saisonStatus: selectedSaison.status,
    membership: membership === null ? null : { gruppe: membership.gruppe, disqualifikation: membership.disqualifikation },
  };

  // What the group pickers may offer: the season's own groups with their fill state, counted over
  // the same memberships read (decided 2026-08-07 — a team enters only a group with space).
  const gruppeOffer = buildGruppeOffer(
    selectedSaison.id,
    selectedSaison.rules,
    membershipsRes.teams.map((candidate) => candidate.memberships),
  );

  /**
   * What the swap control on this page stands on, through the derivation the season editor
   * uses — so the two entry points grade a pair identically or one offers what the other refuses.
   *
   * **The club list comes from the memberships read already made, not from a second `getTeams`.** That
   * response carries every club with every junction row, so narrowing it to this season yields exactly
   * the strict join `GET /teams?saison_id=` would — retired clubs included, which an admin picker needs
   * because a retired club still holding a row is one the write path accepts.
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
    // Keyed by the state the drafts mirror — the match editor's reason: the same route pattern
    // reconciles in place, and a saved team must reopen with its saved values.
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
