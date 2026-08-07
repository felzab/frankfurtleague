// The "use client" directive is NOT redundant here, unlike on its two sibling views:
// `Table.Body` below takes `renderEmptyState`, a render prop, and a Server Component cannot pass a
// function to a Client Component -- doing so throws "Functions cannot be passed directly to Client
// Components" on every render of /dashboard/saisontabelle. Verified against a probe route, because
// neither tsc nor `next build` can see it: the page is dynamic, so the build never renders it.
"use client";

import { Badge, Table } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { typedObjectEntries } from "@/shared/utils/type";

import { computePlatzByTeamId, computeQualifyingTeamIds } from "../../utils";
import { TeamPopoverMenu } from "../ui/TeamPopoverMenu";

import type { FLGruppen } from "../../schemas";

export function SaisontabelleView({ gruppenData, qualifiersPerGroup }: { gruppenData: FLGruppen; qualifiersPerGroup: number }) {
  if (typedObjectEntries(gruppenData).length === 0) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <EmptyState
          title="Für diese Saison gibt es noch keine Tabelle."
          hint="Sobald Gruppen eingeteilt und Spiele gewertet sind, erscheint hier der Tabellenstand."
        />
      </div>
    );
  }

  return (
    /** Container for all the groups.
        This route had no entrance at all while its four siblings in the same nav each had one, so
        the tables snapped into place where every other page eased in (owner, 2026-08-02). The rise
        goes on the container rather than on each group panel: the panels are a short stack, not a
        collection, and staggering two or three full-width tables reads as the page assembling
        itself rather than arriving. */
    <div className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center px-3 pt-6 sm:px-8`}>
      {
        /** One Table generated for each group */
        typedObjectEntries(gruppenData).map(([gruppe, teamsData]) => {
          /* The teams a bracket slot would seed from if the group ended now. Derived rather than taken
             as row indices: a disqualified team holds no place and a team that has played nothing has
             no placing at all, and both must be passed over here exactly as the seeding passes over
             them — or this page marks one team while the bracket advances another (ADR-0043). */
          const qualifying = computeQualifyingTeamIds({ teams: teamsData, qualifiersPerGroup });

          /* Numbered as a `Platz` is, not as a row index: the count walks past a disqualified team,
             so the ordinal here is the same number the bracket's derived "2. der Gruppe A" names. A
             row the count passes over shows a dash — it holds its place in the table and no place in
             the competition. */
          const platzByTeamId = computePlatzByTeamId(teamsData);

          return (
            <div
              key={gruppe}
              className={`${card()} max-w-page mb-6 flex w-full flex-col items-start p-3 sm:p-6`}>
              <div className="flex flex-col gap-1 pb-6">
                <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">Saisontabelle</span>
                <h2 className="fluid-xl text-foreground font-black tracking-tight">Gruppe {gruppe}</h2>
                {/* Not decoration: a team's own page shows its whole season, playoffs included, so the two
                  pages disagree by design and only this line says why (ADR-0029). */}
                <p className="fluid-xxs text-foreground-muted font-medium">Gewertet werden nur Spiele der Gruppenphase.</p>
                {/* Only once something is actually marked. A group whose matches have not started marks
                    nobody, and a legend for an absent highlight reads as a rendering fault. */}
                {qualifying.size > 0 && (
                  <p className="fluid-xxs text-foreground-muted font-medium">
                    Hervorgehoben {qualifying.size === 1 ? "ist das Team, das" : `sind die ${qualifying.size} Teams, die`} aktuell auf einem
                    Playoff-Platz {qualifying.size === 1 ? "steht" : "stehen"}.
                  </p>
                )}
              </div>

              <Table
                variant="secondary"
                className="h-fit w-full text-left">
                <Table.Content aria-label={`Tabelle: Gruppe ${gruppe}`}>
                  <Table.Header className="fluid-xxs text-foreground-muted font-semibold uppercase">
                    <Table.Column
                      isRowHeader
                      className="fluid-xs w-fit pt-1.5 pb-2 pl-2 font-extrabold lg:px-4">
                      #
                    </Table.Column>
                    <Table.Column className="px-1 lg:w-[25%] lg:px-4">Team</Table.Column>
                    <Table.Column className="w-auto px-1 text-center lg:px-2">Spiele</Table.Column>
                    <Table.Column className="w-auto px-1 text-center lg:px-2">S-U-N</Table.Column>
                    <Table.Column className="w-auto px-1 text-center lg:px-2">Tore</Table.Column>
                    <Table.Column className="w-auto px-1 text-center lg:px-2">
                      <span className="hidden lg:block">Differenz</span>
                      <span className="lg:hidden">Diff.</span>
                    </Table.Column>
                    <Table.Column className="px-1 text-center font-semibold lg:px-2">
                      <span className="hidden lg:block">Punkte</span>
                      <span className="lg:hidden">Pkt.</span>
                    </Table.Column>
                  </Table.Header>

                  <Table.Body
                    renderEmptyState={() => (
                      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                        <p className="fluid-sm text-foreground-muted font-medium">Für diese Gruppe sind noch keine Teams eingeteilt.</p>
                      </div>
                    )}>
                    {teamsData.map((teamData) => (
                      <Table.Row
                        key={teamData.id}
                        className={`border-border hover:bg-muted/40 border-b transition-colors last:border-0 ${
                          qualifying.has(teamData.id) ? "bg-brand/5" : ""
                        }`}>
                        {/** Placement. The playoff marker rides on this cell as a left rule, so it reads
                           as an annotation on the position rather than as a highlight on the club. */}
                        <Table.Cell
                          className={`fluid-xs w-fit py-4 pl-2 font-bold lg:px-4 ${
                            qualifying.has(teamData.id) ? "border-brand border-l-4" : "border-l-4 border-l-transparent"
                          }`}>
                          {/* The colour is never the only carrier. A screen reader gets the same fact the
                            rule and the legend give a sighted reader, in the cell that states the place. */}
                          {qualifying.has(teamData.id) && <span className="sr-only">Playoff-Platz: </span>}
                          {teamData.statistik.anzahl_gespielte_spiele === 0 ? "N/A" : (platzByTeamId.get(teamData.id) ?? "—")}
                        </Table.Cell>

                        {/** Team name */}
                        {/* `overflow-visible` stays — the DQ badge is translated outside this cell on
                          purpose. Truncation therefore has to live on the span below, not here; the
                          a `truncate` on this cell would be inert for the same reason. */}
                        <Table.Cell className="fluid-xs overflow-visible px-1 py-4 lg:min-w-[200px] lg:px-4">
                          <TeamPopoverMenu
                            teamName={teamData.name}
                            teamId={teamData.id}
                            teamIsDisqualified={teamData.is_disqualified}>
                            {/** Desktop view */}
                            <span className="fluid-xs text-foreground hover:text-brand hidden max-w-full min-w-0 truncate font-medium transition-colors lg:block">
                              {`${teamData.name} - ${teamData.shorthand}`}
                            </span>
                            {/** Mobile view */}
                            <span className="fluid-sm text-foreground hover:text-brand block font-medium transition-colors lg:hidden">
                              {teamData.shorthand}
                            </span>
                            {teamData.is_disqualified && (
                              <Badge
                                size="sm"
                                placement="top-right"
                                className="fluid-xxs! bg-danger/10 text-danger-strong translate-x-5 -translate-y-2 rounded-md border-none p-1 font-extrabold uppercase lg:translate-x-6">
                                DQ
                              </Badge>
                            )}
                          </TeamPopoverMenu>
                        </Table.Cell>

                        {/** Games played */}
                        <Table.Cell className="text-foreground-muted px-1 py-4 text-center font-medium lg:px-2">
                          {teamData.statistik.anzahl_gespielte_spiele}
                        </Table.Cell>

                        {/** Wins-Draws-Losses.
                           `-strong`, not the plain accents: these are 13.9px text on a table row, and the
                           fill-grade colours measure 3.02 (success), 1.76 (warning) and 4.43 (danger) there
                           in the light theme. The rule is stated once, next to the tokens in globals.css:
                           plain accent for fills, `-strong` for text. */}
                        <Table.Cell className="fluid-xs px-1 py-4 text-center font-medium lg:px-2">
                          <span className="text-success-strong font-semibold">{teamData.statistik.siege}</span>-
                          <span className="text-warning-strong font-semibold">{teamData.statistik.unentschieden}</span>-
                          <span className="text-danger-strong font-semibold">{teamData.statistik.niederlagen}</span>
                        </Table.Cell>

                        {/** Goals for */}
                        <Table.Cell className="fluid-xs text-foreground-muted px-1 py-4 text-center font-medium lg:px-2">
                          {teamData.statistik.tore_geschossen}
                        </Table.Cell>

                        {/** Goal difference */}
                        <Table.Cell className="fluid-xs px-1 py-4 text-center font-bold lg:px-2">
                          {teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert > 0 ? (
                            <span className="text-success-strong">
                              +{teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}
                            </span>
                          ) : (
                            <span className="text-danger-strong">{teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}</span>
                          )}
                        </Table.Cell>

                        {/** Points */}
                        <Table.Cell className="fluid-sm text-foreground px-1 py-4 text-center font-extrabold lg:px-2">
                          {teamData.statistik.punkte}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table>
            </div>
          );
        })
      }
    </div>
  );
}
