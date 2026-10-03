import { Suspense } from "react";
import { connection } from "next/server";

import { resolveAdminSaison } from "@/features/saisons/resolvers";
import { AdminSpielerView } from "@/features/spieler/components/views/AdminSpielerView";
import { SPIELER_CRUD_COPY } from "@/features/spieler/constants";
import { getSpielerMemberships } from "@/features/spieler/queries";
import { countLiveSquadRows, squadIsFull } from "@/features/spieler/utils";
import { getTeamMemberships } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminSpielerRow, SpielerTeamOption } from "@/features/spieler/types";
import type { FLTeamWithMemberships } from "@/features/teams/schemas";
import type { NextPageProps } from "@/shared/types/types";

function teamsInSaison(teams: FLTeamWithMemberships[], saisonId: string): SpielerTeamOption[] {
  return teams
    .filter((team) => team.memberships.some((membership) => membership.saison_id === saisonId))
    .map((team) => ({ teamId: team.id, name: team.name, shorthand: team.shorthand }));
}

// Not async, so the chrome never waits on the list.
export default function AdminSpielerPage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SPIELER_CRUD_COPY.searchLabel}
          searchPlaceholder={SPIELER_CRUD_COPY.searchPlaceholder}
          // This shell passes no `createModal`, so the bar has no trigger to join: it keeps its own
          // right edge and the row's full width.
          attachEnd={false}
        />
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <SpielerTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

/**
 * EVERY player across every season, each row carrying the SELECTED season's squad row
 * (`fl_frontend/src/features/spieler/queries.ts :: getSpielerMemberships`); a player in no squad is listed too.
 */
async function SpielerTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();

  const [membershipsRes, selectedSaison, teamsRes] = await Promise.all([
    getSpielerMemberships(),
    resolveAdminSaison(searchParams),
    getTeamMemberships(),
  ]);
  const selectedSaisonId = selectedSaison?.id ?? "";

  const teamById = new Map(teamsRes.teams.map((team) => [team.id, team]));

  // Folded here and never in the table, which is handed a searched and faceted list: a count taken
  // there would shrink as the admin types. No writer is named, the control it answers rendering on
  // a retired row alone.
  const liveSquadRows = countLiveSquadRows({ spieler: membershipsRes.spieler, saisonId: selectedSaisonId, exceptSpielerId: null });
  // Absent where an id names no season, which `squadIsFull` reads as unknown and refuses nothing.
  const maxKadergroesse = selectedSaison?.rules.max_kadergroesse ?? null;

  const saisonTeams: SpielerTeamOption[] = teamsInSaison(teamsRes.teams, selectedSaisonId).map((team) => ({
    ...team,
    isSquadFull: squadIsFull(liveSquadRows[team.teamId], maxKadergroesse),
  }));

  const rows: AdminSpielerRow[] = membershipsRes.spieler.map((spieler) => {
    const selected = spieler.memberships.find((membership) => membership.saison_id === selectedSaisonId) ?? null;
    const team = selected === null ? undefined : teamById.get(selected.team_id);

    return {
      id: spieler.id,
      vorname: spieler.vorname,
      nachname: spieler.nachname,
      fullName: spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`,
      inactive_since: spieler.inactive_since,
      selected:
        selected === null
          ? null
          : {
              team_id: selected.team_id,
              // Normalised to `""` here, so the controlled input and the list's truthiness check read one shape.
              nummer: selected.nummer ?? "",
              position: selected.position,
              stufe: selected.stufe,
              ist_nachnominiert: selected.ist_nachnominiert,
              rolle: selected.rolle,
              inactive_since: selected.inactive_since,
              // An unresolvable team is a squad row pointing at a deleted club: null, not a crash, so the row
              // still lists and the state is visible.
              teamName: team?.name ?? null,
              teamShorthand: team?.shorthand ?? null,
            },
    };
  });

  return (
    <AdminSpielerView
      spieler={rows}
      // The facet's options and both gates on the row reactivate read this: a filter naming
      // another season's club narrows to nothing, and a wider list would offer a reactivate
      // `REQ-SQUAD-001` refuses.
      teams={saisonTeams}
      selectedSaisonId={selectedSaisonId}
    />
  );
}
