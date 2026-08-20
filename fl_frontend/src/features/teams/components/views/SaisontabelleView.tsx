// NOT redundant: `Table.Body` below takes a render prop, and a Server Component cannot pass a
// function to a Client Component. Neither tsc nor `next build` catches it on a dynamic route.
"use client";

import { Badge, Table } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { typedObjectEntries } from "@/shared/utils/type";

import { computePlatzByTeamId, computeQualifyingTeamIds } from "../../utils";
import { TeamPopoverMenu } from "../ui/TeamPopoverMenu";

import type { FLGruppen } from "../../schemas";

/**
 * Annotative and never additive: a forfeit is in both figures, so a `+1` would invite a reader to
 * add it to the tally and reach a total the season never held.
 *
 * `InfoHint`, not `IconTooltip` — `InfoHint.tsx` carries why.
 */
function AbgesagteSpieleHint({ anzahl }: { anzahl: number }) {
  return (
    <InfoHint
      label={anzahl === 1 ? "1 abgesagtes Spiel" : `${anzahl} abgesagte Spiele`}
      trigger={<span className="fluid-xxs bg-danger/10 text-danger-strong rounded-md px-1 py-0.5 font-extrabold">{anzahl}</span>}>
      <p>
        <strong>Abgesagte Spiele</strong>
      </p>
      <p>{anzahl === 1 ? "Ein Spiel dieses Teams wurde abgesagt." : `${anzahl} Spiele dieses Teams wurden abgesagt.`}</p>
      {/* Both directions of the forfeit rule, in the one place a reader meets it: without the first
          a cancellation on a full match count reads as a fault, without the second the number
          invites a subtraction. */}
      <p>
        Ein abgesagtes Spiel kann trotzdem gewertet worden sein. Dann zählt es in dieser Tabelle ganz normal mit. Ohne Wertung zählt es nirgends
        mit, auch nicht als Niederlage.
      </p>
    </InfoHint>
  );
}

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
    /* The group panels ARE the collection, so they cascade as a card grid does. No page rise beside
       it — the leading panel's step is identical, so a rise would make that panel travel twice. */
    <div
      role="list"
      className={`${CARDS_CASCADE} relative flex w-full flex-1 flex-col items-center px-3 pt-6 sm:px-8`}>
      {typedObjectEntries(gruppenData).map(([gruppe, teamsData]) => {
        /* Derived, never row indices: a disqualified team holds no place, one that has played
           nothing has no placing, and the seeding passes over both. */
        const qualifying = computeQualifyingTeamIds({ teams: teamsData, qualifiersPerGroup });

        /* Numbered as a `Platz` is, not as a row index, so the ordinal is what the bracket's
           "2. der Gruppe A" names. A row the count passes over reads `N/A`. */
        const platzByTeamId = computePlatzByTeamId(teamsData);

        return (
          <div
            role="listitem"
            key={gruppe}
            className={`${card()} max-w-page mb-6 flex w-full flex-col items-start p-3 sm:p-6`}>
            <div className="flex flex-col gap-1 pb-6">
              <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">Saisontabelle</span>
              <h2 className="fluid-xl text-foreground font-black tracking-tight">Gruppe {gruppe}</h2>
              {/* Not decoration: a team's own page counts the playoffs too, so the two pages disagree
                  by design and only this line says why. */}
              <p className="fluid-xxs text-foreground-muted font-medium">Gewertet werden nur Spiele der Gruppenphase.</p>
              {/* Only once something is marked: a legend for an absent highlight reads as a fault. */}
              {qualifying.size > 0 && (
                <p className="fluid-xxs text-foreground-muted font-medium">
                  Hervorgehoben {qualifying.size === 1 ? "ist das Team, das" : `sind die ${qualifying.size} Teams, die`} aktuell auf einem
                  KO-Runden-Platz {qualifying.size === 1 ? "steht" : "stehen"}.
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
                      <p className="muted-hint">Für diese Gruppe sind noch keine Teams eingeteilt.</p>
                    </div>
                  )}>
                  {teamsData.map((teamData) => (
                    <Table.Row
                      key={teamData.id}
                      className={`border-border border-b last:border-0 ${qualifying.has(teamData.id) ? "bg-brand/5" : ""}`}>
                      {/* A left rule on this cell, so the marker reads as an annotation on the
                          POSITION rather than as a highlight on the club. */}
                      <Table.Cell
                        className={`fluid-xs w-fit py-4 pl-2 font-bold lg:px-4 ${
                          qualifying.has(teamData.id) ? "border-brand border-l-4" : "border-l-4 border-l-transparent"
                        }`}>
                        {/* Colour is never the only carrier: a screen reader gets the same fact the
                            rule and the legend give, in the cell that states the place. */}
                        {qualifying.has(teamData.id) && <span className="sr-only">KO-Runden-Platz: </span>}
                        {(teamData.statistik.anzahl_gespielte_spiele === 0 ? undefined : platzByTeamId.get(teamData.id)) ?? "N/A"}
                      </Table.Cell>

                      {/* `overflow-visible` stays — the DQ badge is translated outside this cell on
                          purpose, so truncation has to live on the span below rather than here. */}
                      <Table.Cell className="fluid-xs overflow-visible px-1 py-4 lg:min-w-[200px] lg:px-4">
                        <TeamPopoverMenu
                          teamName={teamData.name}
                          teamId={teamData.id}
                          teamIsDisqualified={teamData.disqualifikation !== null}>
                          <span className="fluid-xs text-foreground hover:text-brand hidden max-w-full min-w-0 truncate font-medium transition-colors lg:block">
                            {`${teamData.name} (${teamData.shorthand})`}
                          </span>
                          <span className="fluid-sm text-foreground hover:text-brand block font-medium transition-colors lg:hidden">
                            {teamData.shorthand}
                          </span>
                          {teamData.disqualifikation !== null && (
                            <Badge
                              size="sm"
                              placement="top-right"
                              className="fluid-xxs! bg-danger/10 text-danger-strong translate-x-5 -translate-y-2 rounded-md border-none p-1 font-extrabold uppercase lg:translate-x-6">
                              DQ
                            </Badge>
                          )}
                        </TeamPopoverMenu>
                      </Table.Cell>

                      <Table.Cell className="text-foreground-muted px-1 py-4 text-center font-medium lg:px-2">
                        {/* A flex row, not two inline nodes: a badge on the text baseline would drag
                            the number off the cell's centre. */}
                        <span className="inline-flex items-center justify-center gap-x-1">
                          {teamData.statistik.anzahl_gespielte_spiele}
                          {teamData.statistik.anzahl_abgesagte_spiele > 0 && (
                            <AbgesagteSpieleHint anzahl={teamData.statistik.anzahl_abgesagte_spiele} />
                          )}
                        </span>
                      </Table.Cell>

                      {/* `-strong`, not the plain accents: at this size the fill-grade colours measure
                          3.02 (success), 1.76 (warning) and 4.43 (danger) in the light theme. */}
                      <Table.Cell className="fluid-xs px-1 py-4 text-center font-medium lg:px-2">
                        <span className="text-success-strong font-semibold">{teamData.statistik.siege}</span>-
                        <span className="text-warning-strong font-semibold">{teamData.statistik.unentschieden}</span>-
                        <span className="text-danger-strong font-semibold">{teamData.statistik.niederlagen}</span>
                      </Table.Cell>

                      <Table.Cell className="muted-meta px-1 py-4 text-center lg:px-2">{teamData.statistik.tore_geschossen}</Table.Cell>

                      <Table.Cell className="fluid-xs px-1 py-4 text-center font-bold lg:px-2">
                        {teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert > 0 ? (
                          <span className="text-success-strong">+{teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}</span>
                        ) : (
                          <span className="text-danger-strong">{teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}</span>
                        )}
                      </Table.Cell>

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
      })}
    </div>
  );
}
