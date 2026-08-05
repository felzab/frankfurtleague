"use client";

import { Card } from "@heroui/react";

import { card } from "@/shared/components/ui/card";

import { formatSpielDisplay } from "../../utils";
import { SpielTeamSlot } from "./SpielTeamSlot";

import type { FLSpiel } from "../../schemas";

/**
 * `relative z-20` lifts a popover trigger clear of the full-bleed button below, so a team name stays
 * independently clickable. An UNRESOLVED slot has no popover and must not be lifted: a plain label
 * sitting above that button would swallow the press that opens the match, and the bracket's largest
 * click target would stop working on exactly the fixtures a reader taps to find out who is playing.
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
        {/* The card itself cannot become the button: it contains TeamPopoverMenu's own <button>
            triggers, and a nested button is invalid HTML that breaks the popover. So the click
            target is a full-bleed overlay sibling, and the two popover triggers are lifted above
            it so they stay independently clickable -- which is what TeamPopoverMenu's
            stopPropagation handlers were compensating for before. */}
        <button
          type="button"
          onClick={onPress}
          aria-label={`Spieldetails Spiel Nr. ${spielData.spiel_nr}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-2xl"
        />

        {/** Game Metadata */}
        <div className="flex h-full w-fit flex-col items-start">
          <span className="fluid-sm text-foreground font-bold">{spielDatum}</span>
          <span className="fluid-xs text-foreground-muted font-medium">{spielUhrzeit}</span>
        </div>

        {/** Who vs. Who — equal 1fr tracks keep the score centered whatever the two sides read. */}
        {/* `min-w-0` is what makes the `truncate` below reachable at all. As a flex item this pill
            defaults to `min-width: auto`, so under `w-fit` its `1fr` tracks resolve to the full
            untruncated content and the pill overflows the bracket column's `max-w-[380px]`. The
            content that reaches that width is an unresolved slot's source label, which is an
            order of magnitude longer than a two-character shorthand. */}
        <div className="bg-background border-border grid w-fit min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 rounded-xl border px-3 py-1.5 shadow-sm">
          {/* TeamPopoverMenu renders display:contents, so z-index has to be applied from outside it. */}
          <span className={`${slotLift(spielData.team1 !== null)} justify-end`}>
            <SpielTeamSlot
              team={spielData.team1}
              quelle={spielData.team1_quelle}
              text={spielData.team1?.shorthand ?? ""}
              className="fluid-base max-w-full truncate text-right font-bold"
            />
          </span>

          {/* The result in the status chips' tint formula -- the owner's reference chip look.
              This is the bracket's card, so it is the one that most often carries a shoot-out: the
              line below it names how a level knockout was settled WITHOUT changing the score, which
              stays the draw the Saisontabelle counts (ADR-0044). It sits inside the `auto` track, so
              the two `1fr` team tracks keep their widths. */}
          <span
            className={`fluid-xs flex flex-col items-center rounded-md px-1.5 py-0.5 text-center font-extrabold ${
              spielData.ergebnis !== null ? "bg-success/15 text-success-strong" : "bg-danger/15 text-danger-strong"
            }`}>
            {spielErgebnis}
            {spielElfmeterschiessen !== null && <span className="fluid-xxs font-semibold whitespace-nowrap">{spielElfmeterschiessen}</span>}
          </span>

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
