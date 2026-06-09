"use client";

import { Table } from "@heroui/react";
import type { FLGruppen } from "../types";
import { typedObjectEntries } from "@/shared/utils";

export default function Saisontabelle({ gruppenData }: { gruppenData: FLGruppen }) {
  return (
    /** Container for all the groups */
    <div className="flex flex-col items-center h-full w-full pb-20 mt-4 overflow-y-scroll scrollbar-hide">
      {
        /** One Table generated for each group */
        typedObjectEntries(gruppenData).map(([group, teamsData]) => (
          <div
            key={group}
            className="flex flex-col items-center min-h-fit w-[90%] max-w-[1550px] px-1 lg:px-4 py-1 mb-4 rounded-4xl bg-tertiary-light dark:bg-tertiary-dark">
            <h3 className="text-fluid-2xl lg:text-fluid-2xl font-extrabold pt-5 pb-7">Gruppe-{group}</h3>

            <Table
              variant="secondary"
              className="w-full h-fit text-left ">
              <Table.Content aria-label={`Tabelle: Gruppe ${group}`}>
                <Table.Header className="uppercase text-fluid-xxs font-semibold ">
                  <Table.Column
                    isRowHeader
                    className=" pb-2 pt-1.5 px-2 lg:px-4 text-fluid-sm font-extrabold">
                    #
                  </Table.Column>
                  <Table.Column className="px-1 lg:px-4">Team</Table.Column>
                  <Table.Column className="px-1 lg:px-2 text-center">Spiele</Table.Column>
                  <Table.Column className="px-1 lg:px-2 text-center">S-U-N</Table.Column>
                  <Table.Column className="px-1 lg:px-2 text-center">Tore</Table.Column>
                  <Table.Column className="px-1 lg:px-2 text-center">
                    <span className="hidden lg:block">Differenz</span>
                    <span className="lg:hidden">Diff.</span>
                  </Table.Column>
                  <Table.Column className="px-1 lg:px-2 text-center font-semibold">Punkte</Table.Column>
                </Table.Header>

                <Table.Body>
                  {teamsData.map((teamData, index) => (
                    <Table.Row
                      key={teamData.id}
                      className="last:border-0">
                      {/** Placement */}
                      <Table.Cell className=" py-4 px-2 lg:px-4 font-semibold text-fluid-sm">
                        {teamData.statistik.anzahl_gespielte_spiele === 0 ? "N/A" : index + 1}
                      </Table.Cell>

                      {/** Team name */}
                      <Table.Cell className="py-4 px-2 lg:px-4 text-fluid-xs ">
                        <span className="hidden lg:block">{`${teamData.name} - ${teamData.name.substring(0, 2)}`}</span>

                        {/* Mobile: CSS-only "Tooltip" */}
                        <div className="group relative lg:hidden inline-block w-fit h-fit">
                          <span className="text-fluid-sm">{teamData.name.substring(0, 2)}</span>

                          <div
                            className="
                              absolute bottom-full left-0 mb-3 z-5 pointer-events-none

                              opacity-0 transition-opacity duration-500 delay-500 ease-out
                              group-active:opacity-100 group-active:duration-0 group-active:delay-0
                            ">
                            {/* The Bubble */}
                            <div className="relative bg-tertiary-dark dark:bg-primary-light  text-text-white dark:text-text-black text-fluid-base font-semibold py-2 px-3 shadow-md rounded-full rounded-bl-none whitespace-nowrap">
                              {teamData.name}

                              {/* The Tail */}
                              <div
                                className="absolute top-[98%] left-0 w-3 h-3 bg-tertiary-dark dark:bg-primary-light"
                                style={{
                                  clipPath: "polygon(0 0, 0 100%, 100% 0)",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </Table.Cell>

                      {/** Games played */}
                      <Table.Cell className="py-4 px-1 lg:px-2 text-center ">{teamData.statistik.anzahl_gespielte_spiele}</Table.Cell>

                      {/** Wins-Draws-Losses */}
                      <Table.Cell className="py-4 px-1 lg:px-2 text-center text-fluid-xs">
                        <span className="text-green-600">{teamData.statistik.siege}</span>-
                        <span className="text-yellow-400">{teamData.statistik.unentschieden}</span>-
                        <span className="text-red-600">{teamData.statistik.niederlagen}</span>
                      </Table.Cell>

                      {/** Goals for */}
                      <Table.Cell className="py-4 px-1 lg:px-2 text-center text-fluid-xs">{teamData.statistik.tore_geschossen}</Table.Cell>

                      {/** Goal difference */}
                      <Table.Cell className={"py-4 px-1 lg:px-2 text-center text-fluid-xs"}>
                        {teamData.statistik.tore_geschossen - teamData.statistik.tore_kassiert}
                      </Table.Cell>

                      {/** Points */}
                      <Table.Cell className="py-4 px-1 lg:px-2 text-center font-bold text-fluid-sm">{teamData.statistik.punkte}</Table.Cell>
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
