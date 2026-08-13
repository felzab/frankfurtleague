"use client";

import { memo, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { Calendar, Globe, Pencil, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateTeamAction } from "@/features/teams/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminTeamRow } from "../../types";

/**
 * Memoised, and load-bearing — see the collection-identity note in `AdminCrudView` and the longer
 * account on `AdminSpielorteTable`: the `items` + render-function form of `Table.Body` is what keeps
 * the rows alive across hidden re-renders, and `memo` is the cheap second layer.
 *
 * **The rows are every club; the Gruppe and Status columns are the selected season's** (decided
 * 2026-08-07). A club not entered in that season shows that instead of season data, and its
 * season-scoped fields are edited by picking the season in the sidemenu first.
 *
 * **Retiring is offered only where the write path would allow it**: a club entered in a running or
 * planned season keeps its trash control present but disabled, with the reason a hover or a tap
 * away, so the rule is discoverable rather than a mystery. The backend refuses the same shape
 * (`REQ-RETIRE-001`), which stays the authoritative check.
 */
export const AdminTeamsTable = memo(function AdminTeamsTable({
  teamsQuery,
  filteredTeams,
  selectedSaisonStatus,
  setDeletingTeam,
}: {
  teamsQuery: string;
  filteredTeams: AdminTeamRow[];
  /** Decides the status column's wording: Laufend, Abgeschlossen or Geplant, the season's own three. */
  selectedSaisonStatus: "past" | "active" | "future";
  setDeletingTeam: (team: AdminTeamRow) => void;
}) {
  const [, startReactivating] = useTransition();

  // The selector's season rides along on every row link, so the editor, the public page and the
  // fixture list open on the season this list is showing. Reading it here is safe: the parent view
  // already subscribes this tree to the router.
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");
  const saisonQuery = selectedFromUrl ? `?saison_id=${encodeURIComponent(selectedFromUrl)}` : "";
  // The same value as a second parameter, for the one row link that carries a facet of its own.
  const saisonParam = selectedFromUrl ? `&saison_id=${encodeURIComponent(selectedFromUrl)}` : "";

  // One press, then a toast either way. No confirmation step: reactivation is undone by the delete
  // control that takes its place.
  const handleReactivate = (team: AdminTeamRow) => {
    startReactivating(async () => {
      const res = await reactivateTeamAction({ id: team.id });
      if (res.success) appToast.success(res.message ?? "Team reaktiviert!");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  // One source for both layouts: the `md+` table's cells and the phone cards render these, so the
  // two presentations cannot disagree about a row's state or its controls.
  const renderStatusBadges = (team: AdminTeamRow) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {team.inactive_since !== null && (
        <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(team.inactive_since ?? "")}</span>
      )}
      {team.selected === null && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Nicht aufgenommen</span>}
      {team.selected?.disqualifikation != null && <span className={`${LABEL_BADGE} bg-danger/15 text-danger-strong`}>Disqualifiziert</span>}
      {team.inactive_since === null && team.selected !== null && team.selected.disqualifikation === null && (
        <>
          {/* The season's own vocabulary, for the reason `AdminSpielerTable` states: „Aktiv“ is the
              filter's word for „nicht stillgelegt“, a different fact about a different subject. */}
          {selectedSaisonStatus === "active" && <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>}
          {selectedSaisonStatus === "past" && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>}
          {selectedSaisonStatus === "future" && <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>}
        </>
      )}
    </div>
  );

  const renderActions = (team: AdminTeamRow) => (
    <RowActions>
      {/* `team` as `buildSpielFacets` declares it, carrying the id its options are keyed by, and it
          reads both sides — so this finds the club's fixtures whichever slot it occupies. */}
      <RowActionLink
        href={`/admin/spielsuche?team=${team.id}${saisonParam}`}
        label="Spiele anzeigen"
        ariaLabel={`Spiele von ${team.name} anzeigen`}>
        <Calendar
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      <RowActionLink
        href={`/dashboard/teams/${team.id}${saisonQuery}`}
        label="Öffentliche Teamseite"
        ariaLabel={`Öffentliche Seite von ${team.name} öffnen`}>
        <Globe
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      <RowActionLink
        href={`/admin/teams/${team.id}${saisonQuery}`}
        label="Bearbeiten"
        ariaLabel={`Team ${team.name} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {team.inactive_since !== null ? (
        <RowActionRestore
          label="Reaktivieren"
          ariaLabel={`Team ${team.name} reaktivieren`}
          onPress={() => handleReactivate(team)}
        />
      ) : (
        <RowActionDelete
          disabledReason={
            team.isRetireable ? null : "Stilllegen ist nur möglich, wenn das Team in keiner laufenden oder geplanten Saison spielt."
          }
          label="Stilllegen"
          ariaLabel={`Team ${team.name} stilllegen`}
          onPress={() => setDeletingTeam(team)}
        />
      )}
    </RowActions>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="fluid-sm text-foreground-muted font-medium">
        {teamsQuery ? "Keine Teams für diese Suche gefunden." : "Es wurden noch keine Teams angelegt."}
      </p>
    </div>
  );

  return (
    <>
      {/* The phone layout: one card per team, no horizontal scrolling anywhere (decided 2026-08-07).
          The table below `md` forced the whole grid sideways; a stacked card holds the same data
          and the same controls at reading width. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredTeams.length === 0 && <div className={`${card()} w-full`}>{emptyState}</div>}
        {filteredTeams.map((team) => (
          <div
            key={team.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4 ${team.inactive_since !== null ? "opacity-80" : ""}`}>
            <div className="flex w-full flex-row items-center gap-3">
              <span className="bg-brand-solid text-brand-solid-foreground fluid-xs inline-flex w-14 shrink-0 items-center justify-center rounded-md py-1.5 font-extrabold tracking-wide shadow-sm">
                {team.shorthand}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="fluid-sm text-foreground truncate font-semibold">{team.name}</span>
                <span className="fluid-xs text-foreground-muted truncate">{team.full_name}</span>
              </div>
            </div>
            {/* Group and status share the row below the identity (decided 2026-08-07). */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {team.selected && <span className="fluid-sm text-foreground shrink-0 font-semibold">Gruppe {team.selected.gruppe}</span>}
              {renderStatusBadges(team)}
            </div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(team)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          <Table.ScrollContainer className="scrollbar-hide">
            <Table.Content aria-label="Tabelle aller Teams">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Team
                </Table.Column>
                {/* The three data columns are PINNED to their content's width with one px-3 inset
                each, so every value sits the same distance from its neighbour and the leftover
                width all goes to the name column (decided 2026-08-07 — auto layout had been handing
                the spare width to Kürzel and Status while Gruppe got none). */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-24 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Kürzel
                </Table.Column>
                {/* Season-scoped columns; WHICH season is the sidemenu selector's, stated by the page
                context rather than repeated per header (decided 2026-08-07). */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-24 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Gruppe
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-40 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Status
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredTeams}
                renderEmptyState={() => emptyState}>
                {(team: AdminTeamRow) => {
                  const isRetired = team.inactive_since !== null;
                  return (
                    <Table.Row
                      id={team.id}
                      className="border-border/50 border-b last:border-b-0">
                      <Table.Cell className="px-6 py-4">
                        <div className={`flex items-center gap-3 ${isRetired ? "opacity-60" : ""}`}>
                          <Persons
                            className="text-brand shrink-0"
                            width={18}
                            height={18}
                          />
                          <div className="flex flex-col gap-0.5">
                            <span className="fluid-sm text-foreground font-semibold">{team.name}</span>
                            <span className="fluid-xs text-foreground-muted">{team.full_name}</span>
                          </div>
                        </div>
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {/* The TeamCard's chip colour, so the Kürzel wears one tint on the admin surface
                        and the public one (decided 2026-08-07). */}
                        {/* Fixed width, sized to the widest pair: WW measures 54.4px at this font with
                        the old px-3 padding, so w-14 holds every combination and the column stops
                        wobbling between rows (decided 2026-08-07). */}
                        <span className="bg-brand-solid text-brand-solid-foreground fluid-xs inline-flex w-14 items-center justify-center rounded-md py-1.5 font-extrabold tracking-wide shadow-sm">
                          {team.shorthand}
                        </span>
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {team.selected ? <span className="fluid-sm text-foreground font-semibold">{team.selected.gruppe}</span> : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">{renderStatusBadges(team)}</Table.Cell>

                      <Table.Cell className="px-6 py-4">{renderActions(team)}</Table.Cell>
                    </Table.Row>
                  );
                }}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </>
  );
});
