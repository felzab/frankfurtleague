import { Suspense } from "react";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { AdminCreateSpielerModal } from "@/features/spieler/components/modals/AdminCreateSpielerModal";
import { AdminSpielerView } from "@/features/spieler/components/views/AdminSpielerView";
import { orderStufen, SPIELER_CRUD_COPY } from "@/features/spieler/constants";
import { getSpielerMemberships } from "@/features/spieler/queries";
import { getTeamMemberships } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminSpielerRow, SpielerCreateSaisonOption, SpielerTeamOption } from "@/features/spieler/types";
import type { FLTeamWithMemberships } from "@/features/teams/schemas";
import type { NextPageProps } from "@/shared/types/types";

/** The teams entered in one season, as the pickers offer them: by name, with their Kürzel. */
function teamsInSaison(teams: FLTeamWithMemberships[], saisonId: string): SpielerTeamOption[] {
  return teams
    .filter((team) => team.memberships.some((membership) => membership.saison_id === saisonId))
    .map((team) => ({ teamId: team.id, name: team.name, shorthand: team.shorthand }));
}

// Not async, so the chrome never waits on the player list — the pattern of the three sibling pages.
// The create modal needs the season and team lists (one form creates the player AND puts them in a
// squad), so it gets its own boundary instead of making the whole page async. `connection()` sits
// with each fetch it guards — ADR-0009 requires only that nothing fetches at build time.
export default function AdminSpielerPage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SPIELER_CRUD_COPY.searchLabel}
          searchPlaceholder={SPIELER_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={
        // The fallback holds the trigger's own height (`formButton` trigger: h-12, lg:h-15), so the
        // header row does not jump when the season-loaded modal streams in.
        <Suspense fallback={<div className="h-12 lg:h-15" />}>
          <CreateSpielerModalLoader searchParams={props.searchParams} />
        </Suspense>
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <SpielerTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

async function CreateSpielerModalLoader({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams);
  const [saisonsRes, teamsRes] = await Promise.all([getSaisons(), getTeamMemberships()]);

  // RUNNING and planned seasons both (owner, 2026-08-07), unlike the club create's planned-only
  // rule: a squad is filled in during its season, so adding a player to one already under way is
  // the ordinary case. `isNachgetragen` is that season's own answer to "did this player arrive
  // late", derived here so the form never has to ask.
  const saisonOptions: SpielerCreateSaisonOption[] = saisonsRes.saisons
    .filter((saison) => saison.status === "active" || saison.status === "future")
    .map((saison) => ({
      saisonId: saison.id,
      isNachgetragen: saison.status === "active",
      teams: teamsInSaison(teamsRes.teams, saison.id),
      // The season's own list, ordered by the league's (`orderStufen`), so two seasons never present
      // the same levels in a different sequence.
      erlaubteStufen: orderStufen(saison.rules.erlaubte_stufen),
    }));

  // The viewed season when it takes players, else the first that does.
  const defaultSaisonId = saisonOptions.find((option) => option.saisonId === requestedSaisonId)?.saisonId ?? saisonOptions[0]?.saisonId ?? null;

  return (
    <AdminCreateSpielerModal
      saisonOptions={saisonOptions}
      defaultSaisonId={defaultSaisonId}
    />
  );
}

/**
 * EVERY player across every season, each row carrying the SELECTED season's squad row. One read:
 * `GET /spieler/memberships` answers the player-centric question the season-scoped reads cannot,
 * `getSaisons` supplies the statuses the status column needs, and `getTeamMemberships` resolves a
 * squad row's `team_id` into the name and Kürzel the list shows. A player in no squad at all is
 * listed too, with nothing season-scoped to show.
 */
async function SpielerTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams);

  const [membershipsRes, saisonsRes, teamsRes] = await Promise.all([getSpielerMemberships(), getSaisons(), getTeamMemberships()]);
  const saisons = saisonsRes.saisons;
  const activeSaisonId = saisons.find((saison) => saison.status === "active")?.id;
  const selectedSaisonId = requestedSaisonId ?? activeSaisonId ?? saisons[0]?.id ?? "";
  const selectedSaisonStatus = saisons.find((saison) => saison.id === selectedSaisonId)?.status ?? "active";

  const teamById = new Map(teamsRes.teams.map((team) => [team.id, team]));

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
              // Normalised to `""` at this boundary, so the editor's controlled input and the list's
              // truthiness check read one shape rather than two.
              nummer: selected.nummer ?? "",
              position: selected.position,
              stufe: selected.stufe,
              is_nachgetragen: selected.is_nachgetragen,
              is_captain: selected.is_captain,
              inactive_since: selected.inactive_since,
              // A team the read cannot resolve is a squad row pointing at a deleted club — null
              // rather than a crash, and the row still lists so the state is visible.
              teamName: team?.name ?? null,
              teamShorthand: team?.shorthand ?? null,
            },
    };
  });

  return (
    <AdminSpielerView
      spieler={rows}
      selectedSaisonId={selectedSaisonId}
      selectedSaisonStatus={selectedSaisonStatus}
    />
  );
}
