"use client";

import { Card } from "@heroui/react";

import { card } from "@/shared/components/ui/card";

import { formatSpielDisplay } from "../../utils";
import { SpielScore } from "./SpielScore";
import { SpielTeamSlot } from "./SpielTeamSlot";

import type { FLSpiel } from "../../schemas";

/**
 * Lifts a popover trigger clear of the full-bleed button below. An UNRESOLVED slot has no popover
 * and must NOT be lifted: a plain label over that button swallows the press that opens the match.
 */
const slotLift = (isResolved: boolean) => (isResolved ? "relative z-20 flex min-w-0" : "flex min-w-0");

export function SpielCardUltraCompact({ spielData, onPress }: { spielData: FLSpiel; onPress: () => void }) {
  const {
    datum: spielDatum,
    uhrzeit: spielUhrzeit,
    ergebnis: spielErgebnis,
    elfmeterschiessen: spielElfmeterschiessen,
  } = formatSpielDisplay(spielData);

  return (
    <Card className={`${card({ interactive: true })} relative w-full`}>
      <Card.Content className="flex flex-row items-center justify-between gap-x-3 p-3">
        {/* The card cannot become the button: it holds `TeamPopoverMenu`'s own triggers, and a
            nested button is invalid HTML that breaks the popover. Hence a full-bleed overlay
            sibling, with the triggers lifted above it. */}
        <button
          type="button"
          onClick={onPress}
          aria-label={`Spieldetails Spiel Nr. ${spielData.spiel_nr}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-2xl"
        />

        <div className="flex h-full w-fit flex-col items-start">
          <span className="fluid-sm text-foreground font-bold">{spielDatum}</span>
          <span className="muted-meta">{spielUhrzeit}</span>
        </div>

        {/* `min-w-0` is what makes the `truncate` below reachable: as a flex item this pill
            defaults to `min-width: auto`, so under `w-fit` its `1fr` tracks resolve to the full
            content and it overflows the bracket column — an unresolved slot's label is long. */}
        <div className="bg-background border-border grid w-fit min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 rounded-xl border px-3 py-1.5 shadow-sm">
          {/* `TeamPopoverMenu` renders `display:contents`, so z-index applies from outside it. */}
          <span className={`${slotLift(spielData.team1 !== null)} justify-end`}>
            <SpielTeamSlot
              team={spielData.team1}
              quelle={spielData.team1_quelle}
              text={spielData.team1?.shorthand ?? ""}
              className="fluid-base max-w-full truncate text-right font-bold"
            />
          </span>

          {/* Inside the `auto` track, so the shoot-out's second line leaves the two `1fr` team
              tracks their widths. */}
          <SpielScore
            ergebnis={spielErgebnis}
            elfmeterschiessen={spielElfmeterschiessen}
            className={`fluid-xs flex flex-col items-center rounded-md px-1.5 py-0.5 text-center font-extrabold ${
              spielData.ergebnis !== null ? "bg-success/15 text-success-strong" : "bg-danger/15 text-danger-strong"
            }`}
          />

          <span className={`${slotLift(spielData.team2 !== null)} justify-start`}>
            <SpielTeamSlot
              team={spielData.team2}
              quelle={spielData.team2_quelle}
              text={spielData.team2?.shorthand ?? ""}
              className="fluid-base max-w-full truncate text-left font-bold"
            />
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
