"use client";

import { Button, Table, Chip, Avatar } from "@heroui/react";
import { ArrowUturnCwLeft } from "@gravity-ui/icons";
import { useRouter } from "next/navigation";
import type { FLSpieler } from "@/features/spieler/schemas";

export default function TeamSpielerView({ teamName, teamSpieler }: { teamName: string; teamSpieler: FLSpieler[] }) {
  const router = useRouter();

  return (
    <div className="flex flex-col w-full animate-in fade-in slide-in-from-bottom-4 duration-400 ">
      {/* Back Navigation Button */}
      <Button
        onClick={() => {
          router.back();
        }}
        className="bg-quaternary-light dark:bg-quaternary-dark size-fit text-fluid-xs mb-4 brightness-95 px-2 lg:px-3 py-1 ">
        <ArrowUturnCwLeft className="w-[16px]! h-[16px]!" />
        Zurück
      </Button>

      <div className="flex flex-row items-center justify-start gap-x-2 min-[360px]:gap-x-6 p-2">
        <h3 className="text-fluid-xl font-extrabold">{teamName}-Spieler</h3>
        <Chip
          size="md"
          variant="soft"
          color="success"
          className=" lg:mt-1.5">
          {teamSpieler.length} Spieler
        </Chip>
      </div>

      <div className="w-full max-w-[1550px] overflow-x-auto pb-4">
        <Table
          variant="secondary"
          className="min-w-full h-fit xl:p-2">
          <Table.Content aria-label={`Tabelle: Spieler ${teamName}`}>
            <Table.Header className="uppercase text-fluid-sm font-semibold text-default-400">
              <Table.Column
                isRowHeader
                className="pl-1.5 sm:pl-4 pr-1 sm:pr-2">
                Name
              </Table.Column>
              <Table.Column className="px-1 sm:px-4 text-center w-1 whitespace-nowrap">#</Table.Column>
              <Table.Column className="px-1 sm:px-4 text-center w-1 whitespace-nowrap">Stufe</Table.Column>
              <Table.Column className="pl-1 sm:pl-2 pr-2 min-[360px]:pr-1.5 sm:pr-4 text-right w-[1%] whitespace-nowrap">Position</Table.Column>
            </Table.Header>

            <Table.Body>
              {teamSpieler.map((spielerData) => (
                <Table.Row key={spielerData.id}>
                  {/* NAME */}
                  <Table.Cell className="px-1 sm:px-4 py-2 sm:py-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Avatar
                        size="sm"
                        color="accent"
                        variant="soft"
                        className="hidden sm:flex shrink-0">
                        <Avatar.Fallback>
                          {spielerData.vorname.charAt(0).toUpperCase()}
                          {spielerData.nachname.charAt(0).toUpperCase()}
                        </Avatar.Fallback>
                      </Avatar>
                      {/* Added line-clamp-1 so extremely long names truncate instead of breaking the table width */}
                      <span className="font-semibold text-fluid-xs line-clamp-1">{`${spielerData.vorname} ${spielerData.nachname}`}</span>
                    </div>
                  </Table.Cell>

                  {/* NUMMMER */}
                  <Table.Cell className="px-1 sm:px-4 py-2 sm:py-3 text-center w-1 whitespace-nowrap">
                    <span className="font-mono  text-fluid-xs">{spielerData.nummer || "-"}</span>
                  </Table.Cell>

                  {/* STUFE */}
                  <Table.Cell className="px-1 sm:px-4 py-2 sm:py-3 text-center w-1 whitespace-nowrap">
                    <span className="text-fluid-xs font-medium">{spielerData.stufe}</span>
                  </Table.Cell>

                  {/* POSITION */}
                  <Table.Cell className="px-1 sm:px-4 py-2 sm:py-3 w-1 whitespace-nowrap">
                    <div className="flex justify-end">
                      <Chip
                        size="sm"
                        variant="soft"
                        color="accent"
                        className="capitalize text-fluid-xxs font-medium">
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
