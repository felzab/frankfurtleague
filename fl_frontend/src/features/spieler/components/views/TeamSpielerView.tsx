"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Avatar, Button, Chip, Table } from "@heroui/react";

import { PILL_RADIUS } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { formButton } from "@/shared/components/ui/formButtons";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSpielerPublic } from "../../schemas";

/**
 * `"use client"` is required: `Table.Body` takes a `renderEmptyState` render prop, which a Server
 * Component may not pass.
 *
 * The fallbacks are load-bearing — `FLSpielerPublic` declares surname, number and position nullable.
 */
export function TeamSpielerView({ teamName, teamSpieler }: { teamName: string; teamSpieler: FLSpielerPublic[] }) {
  const router = useRouter();
  const [isLeaving, startLeaving] = useTransition();

  return (
    <div className={`${PAGE_RISE} flex w-full flex-col`}>
      <Button
        onPress={() => {
          // The pending flag is what ends react-aria's hover (`docs/frontend/spec.md :: I68`).
          startLeaving(() => {
            router.back();
          });
        }}
        isDisabled={isLeaving}
        className={`${formButton({ intent: "nav", size: "sm" })} mb-6 w-fit gap-x-2`}>
        <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
        <span>Zurück</span>
      </Button>

      <div className={`${card()} mb-2 flex w-full flex-col items-center p-4 sm:p-6`}>
        <div className="flex w-full flex-row items-center justify-between">
          <h2 className="fluid-xl text-foreground font-extrabold tracking-tight">Kader von {teamName}</h2>
          <Chip
            size="sm"
            className={`${PILL_RADIUS} bg-success/15 text-success-strong font-bold`}>
            {teamSpieler.length} Spieler
          </Chip>
        </div>
      </div>

      <div className={`${card()} w-full overflow-x-auto p-4 sm:p-6`}>
        <Table
          variant="secondary"
          className="h-fit w-full text-left">
          <Table.Content aria-label={`Tabelle: Spieler ${teamName}`}>
            <Table.Header className="fluid-xxs text-foreground-muted font-semibold uppercase">
              <Table.Column
                isRowHeader
                className="fluid-xs pt-1.5 pb-2 pl-2 font-extrabold lg:px-4">
                Name
              </Table.Column>
              <Table.Column className="w-1 px-1 text-center whitespace-nowrap lg:px-4">#</Table.Column>
              <Table.Column className="w-1 pr-2 pl-1 text-right whitespace-nowrap lg:px-4">Position</Table.Column>
            </Table.Header>

            <Table.Body
              renderEmptyState={() => (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <p className="muted-hint">Für dieses Team ist noch kein Kader eingetragen.</p>
                </div>
              )}>
              {teamSpieler.map((spielerData) => (
                <Table.Row
                  key={spielerData.id}
                  className="border-border border-b last:border-0">
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
                      <span className="fluid-xs text-foreground line-clamp-1 font-bold">
                        {[spielerData.vorname, spielerData.nachname].filter(Boolean).join(" ")}
                      </span>
                    </div>
                  </Table.Cell>

                  {/* §1.12 names an absent value in words, so this cell says which value the player has none of. */}
                  <Table.Cell className="muted-meta w-1 px-1 py-4 text-center lg:px-4">
                    {spielerData.nummer ? <span className="font-mono">{spielerData.nummer}</span> : "Ohne Nummer"}
                  </Table.Cell>

                  <Table.Cell className="w-1 px-1 py-4 whitespace-nowrap lg:px-4">
                    <div className="flex justify-end">
                      {/* This app's `info` pair, not a HeroUI colour prop. A position is a label,
                          not a state, so it stays clear of the brand colour. */}
                      {spielerData.position ? (
                        <Chip
                          size="sm"
                          className={`${PILL_RADIUS} bg-info/15 text-info-strong fluid-xxs font-semibold capitalize`}>
                          {spielerData.position}
                        </Chip>
                      ) : (
                        /* The tint reads as a stated position, so an unset one is words rather than a chip. */
                        <span className="muted-meta">Ohne Position</span>
                      )}
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
