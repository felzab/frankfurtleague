"use client";

import { Card } from "@heroui/react";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSpiel } from "../schemas";

export default function SpielCardUltraCompact({ spielData, onPress }: { spielData: FLSpiel; onPress: () => void }) {
  const spielDatum = formatSpielDatum(spielData.datum);
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "-:-";

  return (
    <Card
      /* FIX: Applied standard card styling (surface, border, hover states) to match the other components */
      className="bg-surface border-border text-foreground hover:border-foreground/30 relative w-full rounded-xl border shadow-sm transition-all hover:scale-[1.02]">
      <Card.Content className="flex flex-row items-center justify-between p-3">
        {/* The card itself cannot become the button: it contains TeamPopoverMenu's own <button>
            triggers, and a nested button is invalid HTML that breaks the popover. So the click
            target is a full-bleed overlay sibling, and the two popover triggers are lifted above
            it so they stay independently clickable -- which is what TeamPopoverMenu's
            stopPropagation handlers were compensating for before. */}
        <button
          type="button"
          onClick={onPress}
          aria-label={`Spieldetails Spiel Nr. ${spielData.spiel_nr}`}
          className="focus-visible:ring-brand absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset"
        />

        {/** Game Metadata */}
        <div className="text-fluid-sm text-foreground-muted flex h-full w-fit flex-col items-start font-bold">
          <span className="w-full">{spielDatum}</span>
          <span className="w-full">{spielUhrzeit}</span>
        </div>

        {/** Who vs. Who */}
        {/* FIX: Changed bg-background/90 to solid bg-background with a border to pop off the surface layer */}
        <div className="bg-background border-border flex w-fit flex-row items-center gap-x-3 rounded-lg border px-4 py-1.5 shadow-sm">
          {/* TeamPopoverMenu renders display:contents, so z-index has to be applied from outside it. */}
          <span className="relative z-20">
            <TeamPopoverMenu
              teamName={spielData.team1.name}
              teamId={spielData.team1.team_id}
              teamShorthand={spielData.team1.shorthand}>
              <strong className="text-fluid-base text-foreground w-fit">{spielData.team1.shorthand}</strong>
            </TeamPopoverMenu>
          </span>

          <span className={`text-fluid-sm font-bold ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>{spielErgebnis}</span>

          <span className="relative z-20">
            <TeamPopoverMenu
              teamName={spielData.team2.name}
              teamId={spielData.team2.team_id}
              teamShorthand={spielData.team2.shorthand}>
              <strong className="text-fluid-base text-foreground w-fit">{spielData.team2.shorthand}</strong>
            </TeamPopoverMenu>
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
