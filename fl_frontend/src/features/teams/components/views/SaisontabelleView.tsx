"use client";

import { Badge, Table } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { typedObjectEntries } from "@/shared/utils/type";

import TeamPopoverMenu from "../TeamPopoverMenu";

import type { FLGruppen } from "../../schemas";

export default function SaisontabelleView({ gruppenData }: { gruppenData: FLGruppen }) {
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
    /** Container for all the groups */
    <div className="relative flex w-full flex-1 flex-col items-center px-3 pt-6 sm:px-8">
      {
        /** One Table generated for each group */
        typedObjectEntries(gruppenData).map(([group, teamsData]) => (
          <div
            key={group}
            className={`${card()} max-w-page mb-6 flex w-full flex-col items-start p-3 sm:p-6`}>
            <div className="flex flex-col gap-1 pb-6">
              <span className="text-fluid-xxs text-brand font-extrabold tracking-widest uppercase">Saisontabelle</span>
              <h3 className="text-fluid-xl text-foreground font-black tracking-tight">Gruppe {group}</h3>
            </div>

            <Table
              variant="secondary"
              className="h-fit w-full text-left">
              <Table.Content aria-label={`Tabelle: Gruppe ${group}`}>
                <Table.Header className="text-fluid-xxs text-foreground-muted font-semibold uppercase">
                  <Table.Column
                    isRowHeader
                    className="text-fluid-xs w-fit pt-1.5 pb-2 pl-2 font-extrabold lg:px-4">
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
                      <p className="text-fluid-sm text-foreground-muted font-medium">Für diese Gruppe sind noch keine Teams eingeteilt.</p>
                    </div>
                  )}>
                  {teamsData.map((teamData, index) => (
                    <Table.Row
                      key={teamData.id}
                      className="border-border hover:bg-muted/40 border-b transition-colors last:border-0">
                      {/** Placement */}
                      <Table.Cell className="text-fluid-xs w-fit py-4 pl-2 font-bold lg:px-4">
                        {teamData.statistik.anzahl_gespielte_spiele === 0 ? "N/A" : index + 1}
                      </Table.Cell>

                      {/** Team name */}
                      {/* `overflow-visible` stays — the DQ badge is translated outside this cell on
                          purpose. Truncation therefore has to live on the span below, not here; the
                          `truncate` that used to sit on this cell was inert for the same reason. */}
                      <Table.Cell className="text-fluid-xs overflow-visible px-1 py-4 lg:min-w-[200px] lg:px-4">
                        <TeamPopoverMenu
                          teamName={teamData.name}
                          teamId={teamData.id}
                          teamShorthand={teamData.shorthand}
                          teamIsDisqualified={teamData.is_disqualified}>
                          {/** Desktop view */}
                          <span className="text-fluid-xs text-foreground hover:text-brand hidden max-w-full min-w-0 truncate font-medium transition-colors lg:block">
                            {`${teamData.name} - ${teamData.shorthand}`}
                          </span>
                          {/** Mobile view */}
                          <span className="text-fluid-sm text-foreground hover:text-brand block font-medium transition-colors lg:hidden">
                            {teamData.shorthand}
                          </span>
                          {teamData.is_disqualified && (
                            <Badge
                              size="sm"
                              placement="top-right"
                              className="text-fluid-xxs! bg-danger/10 text-danger translate-x-5 -translate-y-2 rounded-md border-none p-1 font-extrabold uppercase lg:translate-x-6">
                              DQ
                            </Badge>
                          )}
                        </TeamPopoverMenu>
                      </Table.Cell>

                      {/** Games played */}
                      <Table.Cell className="text-foreground-muted px-1 py-4 text-center font-medium lg:px-2">
                        {teamData.statistik.anzahl_gespielte_spiele}
                      </Table.Cell>

                      {/** Wins-Draws-Losses */}
                      <Table.Cell className="text-fluid-xs px-1 py-4 text-center font-medium lg:px-2">
                        <span className="text-success font-semibold">{teamData.statistik.siege}</span>-
                        <span className="text-warning font-semibold">{teamData.statistik.unentschieden}</span>-
                        <span className="text-danger font-semibold">{teamData.statistik.niederlagen}</span>
                      </Table.Cell>

                      {/** Goals for */}
                      <Table.Cell className="text-fluid-xs text-foreground-muted px-1 py-4 text-center font-medium lg:px-2">
                        {teamData.statistik.tore_geschossen}
                      </Table.Cell>

                      {/** Goal difference */}
                      <Table.Cell className="text-fluid-xs px-1 py-4 text-center font-bold lg:px-2">
                        {teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert > 0 ? (
                          <span className="text-success">+{teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}</span>
                        ) : (
                          <span className="text-danger">{teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}</span>
                        )}
                      </Table.Cell>

                      {/** Points */}
                      <Table.Cell className="text-fluid-sm text-foreground px-1 py-4 text-center font-extrabold lg:px-2">
                        {teamData.statistik.punkte}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table>
          </div>
        ))
      }
    </div>
  );
}
