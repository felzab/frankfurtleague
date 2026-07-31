"use client";

import { Card } from "@heroui/react";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import { card } from "@/shared/components/ui/card";

import { formatSpielDisplay } from "../utils";

import type { FLSpiel } from "../schemas";

export default function SpielCardUltraCompact({ spielData, onPress }: { spielData: FLSpiel; onPress: () => void }) {
  const { datum: spielDatum, uhrzeit: spielUhrzeit, ergebnis: spielErgebnis } = formatSpielDisplay(spielData);

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
          className="focus-visible:ring-brand absolute inset-0 z-10 cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset"
        />

        {/** Game Metadata */}
        <div className="flex h-full w-fit flex-col items-start">
          <span className="text-fluid-sm text-foreground font-bold">{spielDatum}</span>
          <span className="text-fluid-xs text-foreground-muted font-medium">{spielUhrzeit}</span>
        </div>

        {/** Who vs. Who — equal 1fr tracks keep the score centered whatever the shorthand lengths. */}
        <div className="bg-background border-border grid w-fit grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 rounded-xl border px-3 py-1.5 shadow-sm">
          {/* TeamPopoverMenu renders display:contents, so z-index has to be applied from outside it. */}
          <span className="relative z-20 flex min-w-0 justify-end">
            <TeamPopoverMenu
              teamName={spielData.team1.name}
              teamId={spielData.team1.team_id}
              teamShorthand={spielData.team1.shorthand}>
              <strong className="text-fluid-base hover:text-brand max-w-full truncate text-right font-bold transition-colors duration-200">
                {spielData.team1.shorthand}
              </strong>
            </TeamPopoverMenu>
          </span>

          {/* The result in the status chips' tint formula -- the owner's reference chip look. */}
          <span
            className={`text-fluid-xs rounded-md px-1.5 py-0.5 text-center font-extrabold ${
              spielData.ergebnis !== null ? "bg-success/15 text-success-strong" : "bg-danger/15 text-danger-strong"
            }`}>
            {spielErgebnis}
          </span>

          <span className="relative z-20 flex min-w-0 justify-start">
            <TeamPopoverMenu
              teamName={spielData.team2.name}
              teamId={spielData.team2.team_id}
              teamShorthand={spielData.team2.shorthand}>
              <strong className="text-fluid-base hover:text-brand max-w-full truncate text-left font-bold transition-colors duration-200">
                {spielData.team2.shorthand}
              </strong>
            </TeamPopoverMenu>
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
