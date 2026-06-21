"use client";

import { typedObjectEntries } from "@/shared/utils/utils";

import { Badge, Table } from "@heroui/react";

import TeamPopoverMenu from "../TeamPopoverMenu";

import type { FLGruppen } from "../../schemas";

export default function SaisontabelleView({ gruppenData }: { gruppenData: FLGruppen }) {
  return (
    /** Container for all the groups */
    <div className="scrollbar-hide mt-4 flex h-full w-full flex-col items-center overflow-y-scroll pb-20">
      {
        /** One Table generated for each group */
        typedObjectEntries(gruppenData).map(([group, teamsData]) => (
          <div
            key={group}
            className="bg-tertiary-light dark:bg-tertiary-dark mb-4 flex min-h-fit w-[95%] max-w-[1550px] flex-col items-center rounded-4xl px-1 py-1 lg:px-4">
            <h3 className="text-fluid-2xl lg:text-fluid-2xl pt-5 pb-7 font-extrabold">Gruppe-{group}</h3>

            <Table
              variant="secondary"
              className="h-fit w-full text-left">
              <Table.Content aria-label={`Tabelle: Gruppe ${group}`}>
                <Table.Header className="text-fluid-xxs font-semibold uppercase">
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

                <Table.Body>
                  {teamsData.map((teamData, index) => (
                    <Table.Row
                      key={teamData.id}
                      className="last:border-0">
                      {/** Placement */}
                      <Table.Cell className="text-fluid-xs w-fit py-4 pl-2 font-semibold lg:px-4">
                        {teamData.statistik.anzahl_gespielte_spiele === 0 ? "N/A" : index + 1}
                      </Table.Cell>

                      {/** Team name */}
                      <Table.Cell className="text-fluid-xs truncate overflow-visible px-1 py-4 lg:min-w-[200px] lg:px-4">
                        <TeamPopoverMenu
                          teamName={teamData.name}
                          teamId={teamData.id}
                          teamIsDisqualified={teamData.is_disqualified}>
                          {/** Desktop view */}
                          <span className="text-fluid-xs hidden w-fit font-medium lg:block">{`${teamData.name} - ${teamData.shorthand}`}</span>
                          {/** Mobile view */}
                          <span className="text-fluid-sm block font-medium lg:hidden">{teamData.shorthand}</span>
                          {teamData.is_disqualified && (
                            <Badge
                              size="sm"
                              color="danger"
                              placement="top-right"
                              className="text-fluid-xxs! translate-x-5 -translate-y-2 p-1 lg:translate-x-6">
                              DQ
                            </Badge>
                          )}
                        </TeamPopoverMenu>
                      </Table.Cell>

                      {/** Games played */}
                      <Table.Cell className="px-1 py-4 text-center lg:px-2">{teamData.statistik.anzahl_gespielte_spiele}</Table.Cell>

                      {/** Wins-Draws-Losses */}
                      <Table.Cell className="text-fluid-xs px-1 py-4 text-center lg:px-2">
                        <span className="text-green-600">{teamData.statistik.siege}</span>-
                        <span className="text-yellow-400">{teamData.statistik.unentschieden}</span>-
                        <span className="text-red-600">{teamData.statistik.niederlagen}</span>
                      </Table.Cell>

                      {/** Goals for */}
                      <Table.Cell className="text-fluid-xs px-1 py-4 text-center lg:px-2">{teamData.statistik.tore_geschossen}</Table.Cell>

                      {/** Goal difference */}
                      <Table.Cell className={"text-fluid-xs px-1 py-4 text-center lg:px-2"}>
                        {teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}
                      </Table.Cell>

                      {/** Points */}
                      <Table.Cell className="text-fluid-sm px-1 py-4 text-center font-bold lg:px-2">{teamData.statistik.punkte}</Table.Cell>
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
