"use client";

import { memo, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { Calendar, Globe, Pencil, Persons, TrashBin } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateTeamAction } from "@/features/teams/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminTeamRow } from "../../types";

/**
 * Memoised, and load-bearing — see the collection-identity note in `AdminCrudView` and the longer
 * account on `AdminSpielorteTable`: the `items` + render-function form of `Table.Body` is what keeps
 * the rows alive across hidden re-renders, and `memo` is the cheap second layer.
 *
 * **The rows are every club; the Gruppe and Status columns are the selected season's** (owner,
 * 2026-08-07). A club not entered in that season shows that instead of season data, and its
 * season-scoped fields are edited by picking the season in the sidemenu first.
 *
 * **Retiring is offered only where the write path would allow it**: a club entered in a running or
 * planned season keeps its trash control visually present but inert, with the reason one hover
 * away, so the rule is discoverable rather than a mystery. The backend refuses the same shape
 * (`REQ-RETIRE-001`), which stays the authoritative check.
 */
export const AdminTeamsTable = memo(function AdminTeamsTable({
  teamsQuery,
  filteredTeams,
  selectedSaisonId,
  setDeletingTeam,
}: {
  teamsQuery: string;
  filteredTeams: AdminTeamRow[];
  selectedSaisonId: string;
  setDeletingTeam: (team: AdminTeamRow) => void;
}) {
  const [, startReactivating] = useTransition();

  // The selector's season rides along on every row link, so the editor and the public page open on
  // the season this list is showing. Reading it here is safe: the parent view already subscribes
  // this tree to the router (see the memo note), so no new re-render class is introduced.
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");
  const saisonQuery = selectedFromUrl ? `?saison_id=${encodeURIComponent(selectedFromUrl)}` : "";

  // One press, then a toast either way. No confirmation step: reactivation is undone by the delete
  // control that takes its place.
  const handleReactivate = (team: AdminTeamRow) => {
    startReactivating(async () => {
      const res = await reactivateTeamAction({ id: team.id });
      if (res.success) appToast.success(res.message ?? "Verein reaktiviert!");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  return (
    <Table className={`${card()} h-fit w-full p-0`}>
      <Table.ScrollContainer className="scrollbar-hide">
        <Table.Content aria-label="Tabelle aller Vereine">
          <Table.Header>
            <Table.Column
              isRowHeader
              className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Verein
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Kürzel
            </Table.Column>
            {/* The two season-scoped columns name their season, so "which season am I looking at"
                is answered in the header rather than guessed. */}
            <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Gruppe {selectedSaisonId}
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Status {selectedSaisonId}
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
              Aktionen
            </Table.Column>
          </Table.Header>

          {/* `items` + a render function, not mapped children — see the memo note above. */}
          <Table.Body
            items={filteredTeams}
            renderEmptyState={() => (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="fluid-sm text-foreground-muted font-medium">
                  {teamsQuery ? "Keine Vereine für diese Suche gefunden." : "Es wurden noch keine Vereine angelegt."}
                </p>
              </div>
            )}>
            {(team: AdminTeamRow) => {
              const isRetired = team.inactive_since !== null;

              return (
                <Table.Row
                  id={team.id}
                  className="hover:bg-muted/40 border-border/50 border-b transition-colors last:border-b-0">
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

                  <Table.Cell className="px-6 py-4">
                    {/* The TeamCard's chip colour, so the Kürzel wears one tint on the admin surface
                        and the public one (owner, 2026-08-07). */}
                    <span className="bg-brand/50 text-foreground fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-extrabold tracking-wide shadow-sm">
                      {team.shorthand}
                    </span>
                  </Table.Cell>

                  <Table.Cell className="px-6 py-4">
                    {team.selected ? (
                      <span className="fluid-sm text-foreground font-semibold">{team.selected.gruppe}</span>
                    ) : (
                      <span className="fluid-sm text-foreground-muted">–</span>
                    )}
                  </Table.Cell>

                  <Table.Cell className="px-6 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Club-level and season-level states are independent: retirement belongs to
                          the club (ADR-0032), the rest to the selected season's junction row. */}
                      {isRetired && (
                        <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>
                          Stillgelegt seit {formatSpielDatum(team.inactive_since ?? "")}
                        </span>
                      )}
                      {team.selected === null && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Nicht aufgenommen</span>}
                      {team.selected?.disqualifikation != null && (
                        <span className={`${LABEL_BADGE} bg-danger/15 text-danger-strong`}>Disqualifiziert</span>
                      )}
                      {!isRetired && team.selected !== null && team.selected.disqualifikation === null && (
                        <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Aktiv</span>
                      )}
                    </div>
                  </Table.Cell>

                  <Table.Cell className="px-6 py-4">
                    <RowActions>
                      <RowActionLink
                        href={`/admin/spielsuche?q=${encodeURIComponent(team.name)}`}
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
                        ariaLabel={`Verein ${team.name} bearbeiten`}>
                        {/* The pencil the other tables draw, but as a LINK: the editor is a page. */}
                        <Pencil
                          aria-hidden="true"
                          width={18}
                          height={18}
                        />
                      </RowActionLink>
                      {isRetired ? (
                        <RowActionRestore
                          label="Reaktivieren"
                          ariaLabel={`Verein ${team.name} reaktivieren`}
                          onPress={() => handleReactivate(team)}
                        />
                      ) : team.isRetireable ? (
                        <RowActionDelete
                          label="Stilllegen"
                          ariaLabel={`Verein ${team.name} stilllegen`}
                          onPress={() => setDeletingTeam(team)}
                        />
                      ) : (
                        // Inert rather than hidden, so the rule is discoverable: the hover names why
                        // there is nothing to press. The write path refuses the same shape.
                        <IconTooltip label="Stilllegen ist nur möglich, wenn der Verein in keiner laufenden oder geplanten Saison spielt.">
                          <span
                            aria-label={`Verein ${team.name} kann nicht stillgelegt werden, solange er in einer laufenden oder geplanten Saison spielt`}
                            className="text-foreground-muted/40 flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center rounded-xl">
                            <TrashBin
                              aria-hidden="true"
                              width={18}
                              height={18}
                            />
                          </span>
                        </IconTooltip>
                      )}
                    </RowActions>
                  </Table.Cell>
                </Table.Row>
              );
            }}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
});
