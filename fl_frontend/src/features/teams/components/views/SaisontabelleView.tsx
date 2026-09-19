// NOT redundant: `Table.Body` below takes a render prop, and a Server Component cannot pass a
// function to a Client Component. Neither tsc nor `next build` catches it on a dynamic route.
"use client";

import { Badge, Table } from "@heroui/react";

import { PILL_SOLID } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { Hint } from "@/shared/components/ui/Hint";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { SeasonEmptyState } from "@/shared/components/ui/SeasonEmptyState";
import { typedObjectEntries } from "@/shared/utils/type";

import { austrittKuerzel, austrittZustand } from "../../constants";
import { computePlatzByTeamId, computeQualifyingTeamIds } from "../../utils";
import { TeamPopoverMenu } from "../ui/TeamPopoverMenu";
import { Tordifferenz } from "../ui/Tordifferenz";

import type { FLGruppen } from "../../schemas";

/**
 * A sentence per count and per season state. A running season's placing is `aktuell` because a result
 * can still move it; a finished one's group phase is over, so the same mark states where it ended.
 */
function qualifiedLegend(anzahl: number, isFinishedSaison: boolean): string {
  if (isFinishedSaison) {
    return anzahl === 1
      ? "Hervorgehoben ist das Team, das die Gruppenphase auf einem KO-Runden-Platz beendet hat."
      : `Hervorgehoben sind die ${anzahl} Teams, die die Gruppenphase auf einem KO-Runden-Platz beendet haben.`;
  }

  return anzahl === 1
    ? "Hervorgehoben ist das Team, das aktuell auf einem KO-Runden-Platz steht."
    : `Hervorgehoben sind die ${anzahl} Teams, die aktuell auf einem KO-Runden-Platz stehen.`;
}

/**
 * Annotative and never additive: a forfeit is in both figures (`docs/backend/spec.md :: I1d`), so a
 * `+1` would invite a reader to add it to the tally and reach a total the season never held.
 *
 * A hint, not `IconTooltip` — `Hint.tsx` carries why.
 */
function AbgesagteSpieleHint({ anzahl }: { anzahl: number }) {
  return (
    <Hint
      mode="reveal"
      label={anzahl === 1 ? "1 abgesagtes Spiel" : `${anzahl} abgesagte Spiele`}
      body={{
        lead: "Diese Zahl zählt die abgesagten Spiele dieses Teams.",
        points: [{ text: "Rechne sie nicht zur Zahl daneben dazu." }],
      }}
      trigger={<span className="fluid-xxs bg-danger/15 text-danger-strong rounded-md px-1 py-0.5 font-extrabold">{anzahl}</span>}
    />
  );
}

export function SaisontabelleView({
  gruppenData,
  qualifiersPerGroup,
  saisonId,
  isFinishedSaison,
}: {
  gruppenData: FLGruppen;
  qualifiersPerGroup: number;
  /** The season the URL names, `undefined` for the running one, which a bare club link opens too. */
  saisonId: string | undefined;
  isFinishedSaison: boolean;
}) {
  if (typedObjectEntries(gruppenData).length === 0) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <SeasonEmptyState
          nothing="keine Tabelle"
          hint="Sobald Gruppen eingeteilt und Spiele gewertet sind, erscheint hier der Tabellenstand."
          isFinishedSaison={isFinishedSaison}
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
        /* Derived, never row indices: a club that has left the season holds no place, and the
           seeding passes over it too. */
        const qualifying = computeQualifyingTeamIds({ teams: teamsData, qualifiersPerGroup });

        /* Numbered as a `Platz` is, not as a row index, so the ordinal is what the bracket's
           "2. der Gruppe A" names. The map IS the rule: an absent club is the cell's `N/A`, which
           the cell must never decide for itself. */
        const platzByTeamId = computePlatzByTeamId(teamsData);

        return (
          <div
            role="listitem"
            key={gruppe}
            className={`${card()} max-w-page mb-6 flex w-full flex-col items-start p-3 sm:p-6`}>
            <div className="flex flex-col gap-1 pb-6">
              <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">Saisontabelle</span>
              <h2 className={`${DISPLAY_HEADING} fluid-xl text-foreground`}>Gruppe {gruppe}</h2>
              {/* Not decoration: a team's own page counts the playoffs too, so the two pages disagree
                  by design and only this line says why. */}
              <p className="fluid-xxs text-foreground-muted font-medium">Gewertet werden nur Spiele der Gruppenphase.</p>
              {/* Only once something is marked: a legend for an absent highlight reads as a fault. */}
              {qualifying.size > 0 && (
                <p className="fluid-xxs text-foreground-muted font-medium">{qualifiedLegend(qualifying.size, isFinishedSaison)}</p>
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
                      <p className="muted-hint">
                        {isFinishedSaison ? "Für diese Gruppe gibt es keine Teams." : "Für diese Gruppe sind noch keine Teams eingeteilt."}
                      </p>
                    </div>
                  )}>
                  {teamsData.map((teamData) => (
                    <Table.Row
                      key={teamData.id}
                      className={`border-border border-b last:border-0 ${qualifying.has(teamData.id) ? "bg-brand/5" : ""}`}>
                      {/* A left rule on this cell, so the marker reads as an annotation on the
                          POSITION rather than as a highlight on the club. */}
                      <Table.Cell
                        className={`font-numeric fluid-xs w-fit py-4 pl-2 font-bold tabular-nums lg:px-4 ${
                          qualifying.has(teamData.id) ? "border-brand border-l-4" : "border-l-4 border-l-transparent"
                        }`}>
                        {/* Colour is never the only carrier: a screen reader gets the same fact the
                            rule and the legend give, in the cell that states the place. */}
                        {qualifying.has(teamData.id) && <span className="sr-only">KO-Runden-Platz: </span>}
                        {platzByTeamId.get(teamData.id) ?? "N/A"}
                      </Table.Cell>

                      {/* `overflow-visible` stays — the Austritt badge is translated outside this
                          cell on purpose, so truncation has to live on the span below rather than
                          here. */}
                      <Table.Cell className="fluid-xs overflow-visible px-1 py-4 lg:min-w-[200px] lg:px-4">
                        <TeamPopoverMenu
                          teamName={teamData.name}
                          teamId={teamData.id}
                          teamAustritt={teamData.austritt_type}
                          saisonId={saisonId}>
                          <span className="fluid-xs text-foreground hover:text-brand hidden max-w-full min-w-0 truncate font-medium transition-colors lg:block">
                            {`${teamData.name} (${teamData.shorthand})`}
                          </span>
                          <span className="fluid-sm text-foreground hover:text-brand block font-medium transition-colors lg:hidden">
                            {teamData.shorthand}
                          </span>
                          {/* `PILL_SOLID` and not the tint: a qualifying row wears `bg-brand/5`, and
                              a tint stacked on that ground measures 4.49:1 in the light theme. */}
                          {teamData.austritt_type !== null && (
                            <Badge
                              size="sm"
                              placement="top-right"
                              aria-label={austrittZustand(teamData.austritt_type)}
                              className={`fluid-xxs! ${PILL_SOLID.danger} translate-x-5 -translate-y-2 rounded-md border-none p-1 font-extrabold uppercase lg:translate-x-6`}>
                              {austrittKuerzel(teamData.austritt_type)}
                            </Badge>
                          )}
                        </TeamPopoverMenu>
                      </Table.Cell>

                      <Table.Cell className="font-numeric text-foreground-muted px-1 py-4 text-center font-medium tabular-nums lg:px-2">
                        {/* A flex row, not two inline nodes: a badge on the text baseline would drag
                            the number off the cell's centre. */}
                        <span className="inline-flex items-center justify-center gap-x-1">
                          {teamData.statistik.anzahl_gespielte_spiele}
                          {teamData.statistik.anzahl_abgesagte_spiele > 0 && (
                            <AbgesagteSpieleHint anzahl={teamData.statistik.anzahl_abgesagte_spiele} />
                          )}
                        </span>
                      </Table.Cell>

                      {/* `-strong`, not the plain accents: a figure this size is text and answers to
                          4.5:1, where the plain accents measure 3.15:1 to 4.73:1 on the card's ground
                          in the light theme. */}
                      <Table.Cell className="font-numeric fluid-xs px-1 py-4 text-center font-medium tabular-nums lg:px-2">
                        <span className="text-success-strong font-semibold">{teamData.statistik.siege}</span>-
                        <span className="text-warning-strong font-semibold">{teamData.statistik.unentschieden}</span>-
                        <span className="text-danger-strong font-semibold">{teamData.statistik.niederlagen}</span>
                      </Table.Cell>

                      <Table.Cell className="font-numeric muted-meta px-1 py-4 text-center tabular-nums lg:px-2">
                        {teamData.statistik.tore_geschossen}
                      </Table.Cell>

                      <Table.Cell className="font-numeric fluid-xs px-1 py-4 text-center font-bold tabular-nums lg:px-2">
                        <Tordifferenz
                          geschossen={teamData.statistik.tore_geschossen}
                          kassiert={teamData.statistik.tore_kassiert}
                        />
                      </Table.Cell>

                      <Table.Cell className="font-numeric fluid-sm text-foreground px-1 py-4 text-center font-extrabold tabular-nums lg:px-2">
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
