"use client";

import { Card } from "@heroui/react";

import { formatSpielDisplay } from "../utils";
import SaisonPhaseChip from "./ui/SaisonPhaseChip";

import type { FLSpiel } from "../schemas";

export default function SpielCardCompact({ spielData }: { spielData: FLSpiel }) {
  const { datum: spielDatum, uhrzeit: spielUhrzeit, ergebnis: spielErgebnis } = formatSpielDisplay(spielData);

  return (
    <Card className="bg-surface border-border text-foreground w-full rounded-xl border p-4 shadow-sm transition-all">
      <Card.Content className="flex w-full flex-col items-center justify-between gap-y-3 p-0 text-left lg:flex-row">
        {/* Metadata */}
        <div className="flex h-fit w-full flex-col items-start gap-x-4 gap-y-2 lg:flex-row lg:items-center">
          {/** Time/Date */}
          <div className="text-fluid-sm text-foreground-muted flex h-full w-fit flex-row items-center gap-x-2 font-bold lg:flex-col lg:items-start lg:gap-y-0.5">
            <span className="w-full">{spielDatum}</span>
            <span className="lg:hidden">-</span>
            <span className="w-full">{spielUhrzeit}</span>
          </div>

          <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
        </div>

        {/* Bottom Row: Teams and Score */}
        <div className="flex w-full flex-row items-center justify-between gap-2 lg:w-fit lg:justify-end lg:gap-x-4">
          <strong className="text-fluid-sm lg:text-fluid-base w-fit truncate font-bold">{spielData.team1.name || "Team 1"}</strong>

          <span
            className={`text-fluid-base px-2 py-1 text-center font-extrabold ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>
            {spielErgebnis}
          </span>

          <strong className="text-fluid-sm lg:text-fluid-base w-fit truncate font-bold">{spielData.team2.name || "Team 2"}</strong>
        </div>
      </Card.Content>
    </Card>
  );
}
