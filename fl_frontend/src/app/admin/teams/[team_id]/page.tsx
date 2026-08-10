import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { AdminTeamEditView } from "@/features/teams/components/views/AdminTeamEditView";
import { getTeamMemberships } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { buildGruppeOffer } from "@/features/teams/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { TeamSaisonMembership } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The team editor (ADR-0040). One team per URL; WHICH season's membership the editor addresses is
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
  // is selected (the current one when the URL names none, ADR-0002) and what state it is in.
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
  const teamSpiele = membership === null ? [] : (await getSpiele({ saison_id: selectedSaison.id, team_id: teamId, limit: 1 })).spiele;
  const gruppeLocked = selectedSaison.status !== "future" && teamSpiele.length > 0;

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

  return (
    // Keyed by the state the drafts mirror — the match editor's reason: the same route pattern
    // reconciles in place, and a saved team must reopen with its saved values.
    <AdminTeamEditView
      key={JSON.stringify({ team, saison, gruppeLocked })}
      team={team}
      saison={saison}
      gruppeLocked={gruppeLocked}
      gruppeOffer={gruppeOffer}
      today={getGermanTodayStr()}
    />
  );
}
