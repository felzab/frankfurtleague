"use client";

import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Avatar, Button, Chip, Table } from "@heroui/react";

import type { FLSpieler } from "@/features/spieler/schemas";

export default function TeamSpielerView({ teamName, teamSpieler }: { teamName: string; teamSpieler: FLSpieler[] }) {
  const router = useRouter();

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full flex-col duration-400">
      {/* Back Navigation Button */}
      <Button
        onClick={() => {
          router.back();
        }}
        className="bg-quaternary-light dark:bg-quaternary-dark text-fluid-xs mb-4 size-fit px-2 py-1 brightness-95 lg:px-3">
        <ArrowUturnCwLeft className="h-[16px]! w-[16px]!" />
        Zurück
      </Button>

      <div className="flex flex-row items-center justify-start gap-x-2 p-2 min-[360px]:gap-x-6">
        <h3 className="text-fluid-xl font-extrabold">{teamName}-Spieler</h3>
        <Chip
          size="md"
          variant="soft"
          color="success"
          className="lg:mt-1.5">
          {teamSpieler.length} Spieler
        </Chip>
      </div>

      <div className="w-full max-w-[1550px] overflow-x-auto pb-4">
        <Table
          variant="secondary"
          className="h-fit min-w-full xl:p-2">
          <Table.Content aria-label={`Tabelle: Spieler ${teamName}`}>
            <Table.Header className="text-fluid-sm text-default-400 font-semibold uppercase">
              <Table.Column
                isRowHeader
                className="pr-1 pl-1.5 sm:pr-2 sm:pl-4">
                Name
              </Table.Column>
              <Table.Column className="w-1 px-1 text-center whitespace-nowrap sm:px-4">#</Table.Column>
              <Table.Column className="w-1 px-1 text-center whitespace-nowrap sm:px-4">Stufe</Table.Column>
              <Table.Column className="w-[1%] pr-2 pl-1 text-right whitespace-nowrap min-[360px]:pr-1.5 sm:pr-4 sm:pl-2">Position</Table.Column>
            </Table.Header>

            <Table.Body>
              {teamSpieler.map((spielerData) => (
                <Table.Row key={spielerData.id}>
                  {/* NAME */}
                  <Table.Cell className="px-1 py-2 sm:px-4 sm:py-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Avatar
                        size="sm"
                        color="accent"
                        variant="soft"
                        className="hidden shrink-0 sm:flex">
                        <Avatar.Fallback>
                          {spielerData.vorname.charAt(0).toUpperCase()}
                          {spielerData.nachname.charAt(0).toUpperCase()}
                        </Avatar.Fallback>
                      </Avatar>
                      {/* Added line-clamp-1 so extremely long names truncate instead of breaking the table width */}
                      <span className="text-fluid-xs line-clamp-1 font-semibold">{`${spielerData.vorname} ${spielerData.nachname}`}</span>
                    </div>
                  </Table.Cell>

                  {/* NUMMMER */}
                  <Table.Cell className="w-1 px-1 py-2 text-center whitespace-nowrap sm:px-4 sm:py-3">
                    <span className="text-fluid-xs font-mono">{spielerData.nummer || "-"}</span>
                  </Table.Cell>

                  {/* STUFE */}
                  <Table.Cell className="w-1 px-1 py-2 text-center whitespace-nowrap sm:px-4 sm:py-3">
                    <span className="text-fluid-xs font-medium">{spielerData.stufe}</span>
                  </Table.Cell>

                  {/* POSITION */}
                  <Table.Cell className="w-1 px-1 py-2 whitespace-nowrap sm:px-4 sm:py-3">
                    <div className="flex justify-end">
                      <Chip
                        size="sm"
                        variant="soft"
                        color="accent"
                        className="text-fluid-xxs font-medium capitalize">
                        {spielerData.position}
                      </Chip>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table>
      </div>
    </div>
  );
}
