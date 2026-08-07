import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { AdminTeamEditView } from "@/features/teams/components/views/AdminTeamEditView";
import { getTeam } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { TeamSaisonMembership } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The club editor (ADR-0050, adopted by FB-3). One club per URL; WHICH season's membership the
 * editor addresses is the sidemenu selector's `?saison_id=` (owner, 2026-08-07) — switching the
 * selector switches what the Saison panel shows and writes.
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

  // One list read answers both "which season is selected" (the current one when the URL names none
  // — the same default every backend read applies, ADR-0002) and that season's status.
  const saisons = (await getSaisons()).saisons;
  const selectedSaison = requestedSaisonId
    ? saisons.find((saison) => saison.id === requestedSaisonId)
    : saisons.find((saison) => saison.status === "active");
  if (!selectedSaison) {
    notFound();
  }

  // `null` is "not in this season" — the read's join is strict (I11) and the query converts the 404.
  const selectedTeam = (await getTeam(teamId, { saison_id: selectedSaison.id }))?.team ?? null;

  // The club's identity fields are season-independent, so ANY season's read carries them. Probed
  // only when the selected season has no row — newest first, so the freshest record wins.
  let team = selectedTeam;
  if (team === null) {
    const otherSaisons = [...saisons].filter((saison) => saison.id !== selectedSaison.id).sort((a, b) => b.id.localeCompare(a.id));
    for (const saison of otherSaisons) {
      team = (await getTeam(teamId, { saison_id: saison.id }))?.team ?? null;
      if (team !== null) break;
    }
  }
  if (team === null) {
    // In NO season at all — unreachable through the app (the create enters a season in the same
    // action), so it is not-found rather than a page that could render nothing.
    notFound();
  }

  // The owner's rule (2026-08-07): the group may move only while the season has not started — no
  // fixture of the club's exists in it yet — or while the season is still `future`.
  const teamSpiele = selectedTeam === null ? [] : (await getSpiele({ saison_id: selectedSaison.id, team_id: teamId, limit: 1 })).spiele;
  const gruppeLocked = selectedSaison.status !== "future" && teamSpiele.length > 0;

  const saison: TeamSaisonMembership = {
    saisonId: selectedSaison.id,
    saisonStatus: selectedSaison.status,
    membership: selectedTeam === null ? null : { gruppe: selectedTeam.gruppe, disqualifikation: selectedTeam.disqualifikation },
  };

  return (
    // Keyed by the state the drafts mirror — the match editor's reason: the same route pattern
    // reconciles in place, and a saved club must reopen with its saved values.
    <AdminTeamEditView
      key={JSON.stringify({ team: { ...team, statistik: undefined }, saison, gruppeLocked })}
      team={team}
      saison={saison}
      gruppeLocked={gruppeLocked}
      today={getGermanTodayStr()}
    />
  );
}
