"use client";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";

import { Card } from "@heroui/react";

import type { FLSpiel } from "../schemas";

export default function SpielCardUltraCompact({ spielData, onClick }: { spielData: FLSpiel; onClick: () => void }) {
  const spielDatum = spielData.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : "TBD";
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "-:-";

  return (
    <Card
      onClick={onClick}
      className="bg-tertiary-light dark:bg-tertiary-dark w-full shadow-lg transition-transform hover:scale-[1.02]">
      <Card.Content className="flex flex-row items-center justify-between">
        {/** Game Metadata */}
        <div className="text-fluid-sm flex h-full w-fit flex-col items-start font-semibold">
          <span className="w-full">{spielDatum}</span>
          <span className="text-default-500 w-full">{spielUhrzeit}</span>
        </div>

        {/** Who vs. Who */}
        <div className="bg-quinary-light dark:bg-primary-dark/90 flex w-fit flex-row items-center gap-x-3 rounded-lg px-4 py-1.5 shadow-sm">
          <TeamPopoverMenu
            teamName={spielData.team1.name}
            teamId={spielData.team1.team_id}>
            <strong className="text-fluid-base w-fit">{spielData.team1.shorthand}</strong>
          </TeamPopoverMenu>

          <span className={`text-fluid-sm font-bold ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>{spielErgebnis}</span>

          <TeamPopoverMenu
            teamName={spielData.team2.name}
            teamId={spielData.team2.team_id}>
            <strong className="text-fluid-base w-fit">{spielData.team2.shorthand}</strong>
          </TeamPopoverMenu>
        </div>
      </Card.Content>
    </Card>
  );
}
