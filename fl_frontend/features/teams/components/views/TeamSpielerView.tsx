"use client";

import { Button, Table } from "@heroui/react";
import type { FLSpieler } from "../../types";
import { ArrowUturnCwLeft } from "@gravity-ui/icons";
import { useRouter } from "next/navigation";

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
        Zurück zur Übersicht
      </Button>
      <h3 className="text-fluid-xl p-2 font-extrabold">{teamName}-Spieler</h3>

      <Table
        variant="secondary"
        className=" w-full h-fit xl:p-2">
        <Table.Content aria-label={`Tabelle: Spieler ${teamName}`}>
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
            {teamSpieler.map((spielerData) => (
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
    </div>
  );
}
