"use client";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";

import { Card } from "@heroui/react";

import type { FLSpiel } from "../schemas";

export default function SpielCardUltraCompact({ spielData, onPress }: { spielData: FLSpiel; onPress: () => void }) {
  const spielDatum = spielData.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : "TBD";
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "-:-";

  return (
    <Card
      onClick={onPress}
      /* FIX: Applied standard card styling (surface, border, hover states) to match the other components */
      className="bg-surface border-border text-foreground hover:border-foreground/30 w-full cursor-pointer rounded-xl border shadow-sm transition-all hover:scale-[1.02]">
      <Card.Content className="flex flex-row items-center justify-between p-3">
        {/** Game Metadata */}
        <div className="text-fluid-sm text-foreground-muted flex h-full w-fit flex-col items-start font-bold">
          <span className="w-full">{spielDatum}</span>
          <span className="w-full">{spielUhrzeit}</span>
        </div>

        {/** Who vs. Who */}
        {/* FIX: Changed bg-background/90 to solid bg-background with a border to pop off the surface layer */}
        <div className="bg-background border-border flex w-fit flex-row items-center gap-x-3 rounded-lg border px-4 py-1.5 shadow-sm">
          <TeamPopoverMenu
            teamName={spielData.team1.name}
            teamId={spielData.team1.team_id}
            teamShorthand={spielData.team1.shorthand}>
            <strong className="text-fluid-base text-foreground w-fit">{spielData.team1.shorthand}</strong>
          </TeamPopoverMenu>

          <span className={`text-fluid-sm font-bold ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>{spielErgebnis}</span>

          <TeamPopoverMenu
            teamName={spielData.team2.name}
            teamId={spielData.team2.team_id}
            teamShorthand={spielData.team2.shorthand}>
            <strong className="text-fluid-base text-foreground w-fit">{spielData.team2.shorthand}</strong>
          </TeamPopoverMenu>
        </div>
      </Card.Content>
    </Card>
  );
}
