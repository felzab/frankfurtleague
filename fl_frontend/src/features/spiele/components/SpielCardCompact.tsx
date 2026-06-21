"use client";

import type { FLSpiel } from "../schemas";
import SaisonPhaseChip from "./ui/SaisonPhaseChip";

export default function SpielCardCompact({ spielData }: { spielData: FLSpiel }) {
  const spielDatum = spielData.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : "TBD";
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "-:-";

  return (
    <div className="w-full flex flex-col gap-y-4 lg:flex-row p-3 justify-between items-center rounded-2xl transition-all duration-200 text-left bg-primary-light dark:bg-primary-dark">
      {/* Metadata */}
      <div className="flex flex-col items-left gap-y-1 gap-x-4 w-full h-fit text-fluid-sm lg:flex-row">
        {/** Time/Date */}
        <div className="flex flex-row items-center justify-evenly gap-x-2 w-fit h-full lg:flex-col lg:items-left font-bold ">
          <span className="w-full">{spielDatum}</span>
          <span className="lg:hidden">-</span>
          <span className="w-full">{spielUhrzeit}</span>
        </div>

        <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
      </div>

      {/* Bottom Row: Teams and Score */}
      <div className="flex flex-row items-center justify-center lg:justify-end w-full gap-2">
        <strong className="w-fit text-fluid-sm lg:text-fluid-md font-bold truncate ">{spielData.team1.name || "Team 1"}</strong>

        <span
          className={`w-fit px-1 lg:px-4 text-center text-fluid-base font-extrabold ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>
          {spielErgebnis}
        </span>

        <strong className="w-fit text-fluid-sm lg:text-fluid-md font-bold  truncate">{spielData.team2.name || "Team 2"}</strong>
      </div>
    </div>
  );
}
