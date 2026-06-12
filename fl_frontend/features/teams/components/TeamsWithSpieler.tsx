"use client";

import { Accordion, Table } from "@heroui/react";
import { ChevronsDownWide } from "@gravity-ui/icons";

import TeamStatsPreview from "./TeamStatsPreview";
import type { FLTeamWithSpieler } from "../types";

export default function TeamsWithSpieler({ teamsData }: { teamsData: FLTeamWithSpieler[] }) {
  return (
    <Accordion className="flex flex-col h-full w-[95%] max-w-[1550px] gap-y-2 text-text-black dark:text-text-white overflow-y-scroll scrollbar-hide lg:mt-2">
      {teamsData?.map((teamData) => (
        // One item for each team
        <Accordion.Item
          key={teamData.id}
          className="after:hidden bg-tertiary-light dark:bg-tertiary-dark rounded-2xl">
          <Accordion.Heading>
            <Accordion.Trigger className="w-full px-3 py-4 rounded-2xl bg-primary-light dark:bg-primary-dark border-2 border-quaternary-light dark:border-quaternary-dark">
              <h3 className="text-fluid-lg font-bold tracking-tighter">{teamData.name}</h3>
              <Accordion.Indicator>
                <ChevronsDownWide />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>

          <Accordion.Panel>
            <Accordion.Body className="flex flex-col items-center px-1">
              {/** Basic information about the team */}
              <TeamStatsPreview teamData={teamData} />

              <Table
                variant="secondary"
                className=" w-full h-fit xl:p-2">
                <Table.Content aria-label={`Tabelle: Spieler ${teamData.name}`}>
                  <Table.Header className="uppercase text-fluid-sm font-semibold">
                    <Table.Column
                      isRowHeader
                      className="px-2 lg:px-4">
                      Name
                    </Table.Column>
                    <Table.Column className="px-2 lg:px-4">#</Table.Column>
                    <Table.Column className="px-2 lg:px-4">Position</Table.Column>
                    <Table.Column className="px-3 lg:px-4 text-right">Stufe</Table.Column>
                  </Table.Header>

                  <Table.Body>
                    {teamData.spieler.map((spielerData) => (
                      <Table.Row key={spielerData.id}>
                        <Table.Cell className="px-2 lg:px-4 py-3 font-medium text-fluid-xxs">
                          {`${spielerData.vorname} ${spielerData.nachname}`}
                        </Table.Cell>
                        <Table.Cell className="px-2 lg:px-4 py-3 text-fluid-xxs">{spielerData.nummer}</Table.Cell>
                        <Table.Cell className="px-2 lg:px-4 py-3 text-fluid-xxs">{spielerData.position}</Table.Cell>
                        <Table.Cell className="px-3 lg:px-4 py-3 text-right text-fluid-xs">{spielerData.stufe}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
