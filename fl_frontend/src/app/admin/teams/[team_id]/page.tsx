import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { AdminTeamEditView } from "@/features/teams/components/views/AdminTeamEditView";
import { getTeam } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { FLTeam } from "@/features/teams/schemas";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The team editor (ADR-0050, adopted by FB-3). One club per URL, so the list can link straight to
 * it and a reload returns to it. No `generateMetadata` and no `generateStaticParams`, for the
 * reasons the match editor records.
 *
 * **The page itself resolves NOTHING** — the `params` promise is passed down into the `Suspense`
 * boundary and every await happens there, which is what keeps a fallback-params route renderable.
 * The match editor documents the crash that shape prevents.
 */
export default function AdminTeamEditPage(props: NextPageProps<{ team_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminTeamEditContent params={props.params} />
    </Suspense>
  );
}

/**
 * One club's junction state for one season, where "no row" is an expected answer, not a failure —
 * `getTeam` resolves null for exactly that, because the single read's join is strict (I11). A real
 * failure still throws and must not render as an absent membership.
 */
async function readMembership(teamId: string, saisonId: string): Promise<FLTeam | null> {
  return getTeam(teamId, { saison_id: saisonId }).then((res) => res?.team ?? null);
}

async function AdminTeamEditContent({ params }: { params: NextPageProps<{ team_id: string }>["params"] }) {
  await connection();
  const teamId = await resolveTeamId(params);

  // Newest season first, matching how an admin thinks about them at rollover time.
  const saisons = [...(await getSaisons()).saisons].sort((a, b) => b.id.localeCompare(a.id));

  // One read per season: `GET /teams/{team_id}` is the only read that can answer "is this club in
  // that season", and each answer is cached under the `teams` tag, so a junction save refreshes
  // this panel. The season count is small and every read after the first day is a cache hit.
  const perSaison = await Promise.all(saisons.map((saison) => readMembership(teamId, saison.id)));

  // The club fields are season-independent, so ANY successful read carries them. All-null means the
  // club is in no season at all — unreachable through the app (the create enters a season in the
  // same action), so it is treated as not found rather than given a page that could render nothing.
  const team = perSaison.find((entry) => entry !== null);
  if (!team) {
    notFound();
  }

  const memberships: TeamSaisonMembership[] = saisons.map((saison, index) => {
    const entry = perSaison[index];
    return {
      saisonId: saison.id,
      saisonStatus: saison.status,
      membership: entry ? { gruppe: entry.gruppe, disqualifikation: entry.disqualifikation } : null,
    };
  });

  return (
    // Keyed by the state the drafts mirror, for the match editor's reason: the same route pattern
    // reconciles in place, and a saved club must reopen with its saved values.
    <AdminTeamEditView
      key={JSON.stringify({ id: team.id, team: { ...team, statistik: undefined }, memberships })}
      team={team}
      memberships={memberships}
      today={getGermanTodayStr()}
    />
  );
}
