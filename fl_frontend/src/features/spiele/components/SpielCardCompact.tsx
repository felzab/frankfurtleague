"use client";

import SaisonPhaseChip from "./ui/SaisonPhaseChip";

import type { FLSpiel } from "../schemas";

export default function SpielCardCompact({ spielData }: { spielData: FLSpiel }) {
  const spielDatum = spielData.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : "TBD";
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "-:-";

  return (
    <div className="bg-primary-light dark:bg-primary-dark flex w-full flex-col items-center justify-between gap-y-4 rounded-2xl p-3 text-left transition-all duration-200 lg:flex-row">
      {/* Metadata */}
      <div className="items-left text-fluid-sm flex h-fit w-full flex-col gap-x-4 gap-y-1 lg:flex-row">
        {/** Time/Date */}
        <div className="lg:items-left flex h-full w-fit flex-row items-center justify-evenly gap-x-2 font-bold lg:flex-col">
          <span className="w-full">{spielDatum}</span>
          <span className="lg:hidden">-</span>
          <span className="w-full">{spielUhrzeit}</span>
        </div>

        <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
      </div>

      {/* Bottom Row: Teams and Score */}
      <div className="flex w-full flex-row items-center justify-center gap-2 lg:justify-end">
        <strong className="text-fluid-sm lg:text-fluid-md w-fit truncate font-bold">{spielData.team1.name || "Team 1"}</strong>

        <span
          className={`text-fluid-base w-fit px-1 text-center font-extrabold lg:px-4 ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>
          {spielErgebnis}
        </span>

        <strong className="text-fluid-sm lg:text-fluid-md w-fit truncate font-bold">{spielData.team2.name || "Team 2"}</strong>
      </div>
    </div>
  );
}
