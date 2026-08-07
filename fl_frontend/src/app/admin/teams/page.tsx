import { Suspense } from "react";
import { connection } from "next/server";

import { getCurrentSaison, getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { AdminCreateTeamModal } from "@/features/teams/components/modals/AdminCreateTeamModal";
import { AdminTeamsView } from "@/features/teams/components/views/AdminTeamsView";
import { getTeams } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminTeamRow } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the team list — the pattern of the two sibling pages.
// The create modal needs the season list (one form creates the club AND enters it into a season),
// so it gets its own boundary instead of making the whole page async. `connection()` sits with each
// fetch it guards — ADR-0009 requires only that nothing fetches at build time.
export default function AdminTeamsPage(props: NextPageProps) {
  return (
    <AdminCrudShell
      createModal={
        // The fallback holds the trigger's own height (`formButton` trigger: h-12, lg:h-15), so the
        // header row does not jump when the season-loaded modal streams in.
        <Suspense fallback={<div className="h-12 lg:h-15" />}>
          <CreateTeamModalLoader searchParams={props.searchParams} />
        </Suspense>
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <TeamsTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

async function CreateTeamModalLoader({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams);
  const [saisonsRes, currentSaisonRes] = await Promise.all([getSaisons(), getCurrentSaison()]);

  return (
    <AdminCreateTeamModal
      saisons={saisonsRes.saisons}
      // The create defaults to the season being VIEWED — at rollover time that is the future season
      // the admin has just switched to, which is exactly where a new club belongs.
      currentSaisonId={requestedSaisonId ?? currentSaisonRes.saison.id}
    />
  );
}

/**
 * EVERY club across every season, each row carrying the SELECTED season's junction data (owner,
 * 2026-08-07). The API's team reads are strictly season-scoped (I11), so the union is composed here
 * from one cached read per season — the club document is season-independent, so any read's copy of
 * the identity fields is current. A club in no season at all stays invisible, which the create
 * makes unreachable by entering a season in the same action.
 *
 * The per-season sweep also answers the retire guard's question with no extra read: a club entered
 * in an `active` or `future` season may not be retired (the write path refuses it too,
 * `REQ-RETIRE-001`).
 */
async function TeamsTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams);

  const saisons = (await getSaisons()).saisons;
  const selectedSaisonId = requestedSaisonId ?? saisons.find((saison) => saison.status === "active")?.id;

  const perSaison = await Promise.all(
    saisons.map(async (saison) => ({
      saison,
      // `include_inactive`, so a retired club holding its shorthand stays visible and reactivatable.
      res: await getTeams({ saison_id: saison.id, include_inactive: true }),
    })),
  );

  const rows = new Map<string, AdminTeamRow>();
  for (const { saison, res } of perSaison) {
    if (res.format !== "list") {
      throw new Error("Expected a list, got something else");
    }
    for (const team of res.teams) {
      const row = rows.get(team.id) ?? {
        id: team.id,
        name: team.name,
        full_name: team.full_name,
        shorthand: team.shorthand,
        inactive_since: team.inactive_since,
        selected: null,
        isRetireable: true,
      };
      if (saison.id === selectedSaisonId) {
        row.selected = { gruppe: team.gruppe, disqualifikation: team.disqualifikation };
      }
      if (saison.status === "active" || saison.status === "future") {
        row.isRetireable = false;
      }
      rows.set(team.id, row);
    }
  }

  const sortedRows = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <AdminTeamsView
      teams={sortedRows}
      selectedSaisonId={selectedSaisonId ?? ""}
    />
  );
}
