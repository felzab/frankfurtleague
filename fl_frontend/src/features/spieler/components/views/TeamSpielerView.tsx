"use client";

import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Avatar, Button, Chip, Table } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSpieler } from "../../schemas";

/**
 * A team's squad list.
 *
 * Every field except `vorname` renders through a fallback, and that is not defensiveness — `FLSpieler`
 * declares surname, number, level and position as nullable, because a squad entry is routinely created
 * before those are known. Removing a fallback renders a literal "null" the first time someone adds a
 * player mid-season.
 *
 * `"use client"` is required: the back button needs `useRouter`, and `Table.Body` takes a
 * `renderEmptyState` render prop, which a Server Component may not pass.
 */
export function TeamSpielerView({ teamName, teamSpieler }: { teamName: string; teamSpieler: FLSpieler[] }) {
  const router = useRouter();

  return (
    <div className={`${PAGE_RISE} flex w-full flex-col`}>
      {/* Back Navigation Button */}
      <Button
        onPress={() => {
          router.back();
        }}
        className="bg-surface border-border text-foreground hover:bg-muted text-fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
        <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
        <span>Zurück</span>
      </Button>

      {/* Header Container */}
      <div className={`${card()} mb-2 flex w-full flex-col items-center p-4 sm:p-6`}>
        <div className="flex w-full flex-row items-center justify-between">
          <h1 className="text-fluid-xl text-foreground font-extrabold tracking-tight">{teamName} - Kader</h1>
          <Chip
            size="sm"
            className="bg-success/15 text-success-strong font-bold">
            {teamSpieler.length} Spieler
          </Chip>
        </div>
      </div>

      {/* Table Container */}
      <div className={`${card()} w-full overflow-x-auto p-4 sm:p-6`}>
        <Table
          variant="secondary"
          className="h-fit w-full text-left">
          <Table.Content aria-label={`Tabelle: Spieler ${teamName}`}>
            <Table.Header className="text-fluid-xxs text-foreground-muted font-semibold uppercase">
              <Table.Column
                isRowHeader
                className="text-fluid-xs pt-1.5 pb-2 pl-2 font-extrabold lg:px-4">
                Name
              </Table.Column>
              <Table.Column className="w-1 px-1 text-center whitespace-nowrap lg:px-4">#</Table.Column>
              <Table.Column className="w-1 px-1 text-center whitespace-nowrap lg:px-4">Stufe</Table.Column>
              <Table.Column className="w-1 pr-2 pl-1 text-right whitespace-nowrap lg:px-4">Position</Table.Column>
            </Table.Header>

            <Table.Body
              renderEmptyState={() => (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <p className="text-fluid-sm text-foreground-muted font-medium">Für dieses Team ist noch kein Kader eingetragen.</p>
                </div>
              )}>
              {teamSpieler.map((spielerData) => (
                <Table.Row
                  key={spielerData.id}
                  className="border-border border-b last:border-0">
                  {/* NAME */}
                  <Table.Cell className="px-1 py-4 lg:px-4">
                    <div className="flex items-center gap-x-3">
                      <Avatar
                        size="sm"
                        color="accent"
                        variant="soft"
                        className="hidden shrink-0 sm:flex">
                        <Avatar.Fallback className="font-bold">
                          {spielerData.vorname.charAt(0).toUpperCase()}
                          {spielerData.nachname?.charAt(0).toUpperCase() ?? ""}
                        </Avatar.Fallback>
                      </Avatar>
                      <span className="text-fluid-xs text-foreground line-clamp-1 font-bold">
                        {[spielerData.vorname, spielerData.nachname].filter(Boolean).join(" ")}
                      </span>
                    </div>
                  </Table.Cell>

                  {/* NUMMER */}
                  <Table.Cell className="text-fluid-xs text-foreground-muted w-1 px-1 py-4 text-center font-mono font-medium lg:px-4">
                    {spielerData.nummer || "-"}
                  </Table.Cell>

                  {/* STUFE */}
                  <Table.Cell className="text-fluid-xs text-foreground-muted w-1 px-1 py-4 text-center font-medium lg:px-4">
                    {spielerData.stufe || "-"}
                  </Table.Cell>

                  {/* POSITION */}
                  <Table.Cell className="w-1 px-1 py-4 whitespace-nowrap lg:px-4">
                    <div className="flex justify-end">
                      {/* `color="accent"` here resolved against HeroUI's own `--accent`, which this
                          app never maps — so a squad list on a maroon-branded site rendered a column
                          of stock blue chips. A position is a neutral label rather than a status, so
                          it takes the brand tint instead of one of the feedback accents. */}
                      <Chip
                        size="sm"
                        className="bg-brand/10 text-brand text-fluid-xxs font-semibold capitalize">
                        {spielerData.position || "-"}
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
