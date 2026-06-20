"use client";

import { Card } from "@heroui/react";
import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import type { FLSpiel } from "../schemas";

export default function SpielCardUltraCompact({ spielData, onClick }: { spielData: FLSpiel; onClick: () => void }) {
  const spielDatum = spielData.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : "TBD";
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "-:-";

  return (
    <Card
      onClick={onClick}
      className="w-full shadow-lg bg-tertiary-light dark:bg-tertiary-dark hover:scale-[1.02] transition-transform">
      <Card.Content className="flex flex-row items-center justify-between">
        {/** Game Metadata */}
        <div className="flex flex-col items-start w-fit h-full font-semibold text-fluid-sm">
          <span className="w-full">{spielDatum}</span>
          <span className="w-full text-default-500">{spielUhrzeit}</span>
        </div>

        {/** Who vs. Who */}
        <div className="flex flex-row items-center gap-x-3 w-fit rounded-lg shadow-sm px-4 py-1.5 bg-quinary-light dark:bg-primary-dark/90">
          <TeamPopoverMenu
            teamName={spielData.team1.name}
            teamId={spielData.team1.team_id}>
            <strong className="text-fluid-base w-fit">{spielData.team1.shorthand}</strong>
          </TeamPopoverMenu>

          <span className={`font-bold text-fluid-sm ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>{spielErgebnis}</span>

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
