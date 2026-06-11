// ---------------------------------------------------------
// DESIGN 2: Refined Row (Improved Version 1)
// Fixes: Proper Flexbox math. Zero text overlap. Fixed typography.
// ---------------------------------------------------------
"use client";
import { Button } from "@heroui/react";
import { CircleExclamation, PencilToSquare } from "@gravity-ui/icons";
import type { FLSpielWithChipData } from "../types";
import SpielStatusChip from "./chips/SpielStatusChip";
import SpielPhaseChip from "./chips/SpielPhaseChip";

export default function SpielDisplay({
  spielData,
  onOpenInfoModal,
  onOpenAdminModal,
  adminMode,
}: {
  spielData: FLSpielWithChipData;
  onOpenInfoModal: () => void;
  onOpenAdminModal: () => void;
  adminMode: boolean;
}) {
  const spielDatum = spielData.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : "TBD";
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "- : -";

  return (
    <div
      className={`relative flex flex-col items-center justify-between gap-x-4 gap-y-6 w-full lg:w-[98%] max-w-[1000px] h-auto px-4 py-3 lg:px-5 lg:py-4 mb-2 rounded-3xl border border-divider bg-tertiary-light dark:bg-tertiary-dark ${
        spielData.status === "vergangen" && "opacity-85"
      }`}>
      <div className="flex flex-row items-center justify-between w-full">
        {/* Datum/Uhrzeit */}
        <div className="flex flex-col">
          <span className="text-fluid-sm font-bold">{spielDatum}</span>
          <span className="text-fluid-xs font-medium">{spielUhrzeit}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end w-full gap-x-2">
          {adminMode && (
            <Button
              isIconOnly
              onPress={onOpenAdminModal}
              size="md"
              variant="tertiary"
              className="bg-quinary-light dark:bg-quinary-dark">
              <PencilToSquare className="w-5 h-5" />
            </Button>
          )}
          <Button
            isIconOnly
            onPress={onOpenInfoModal}
            size="md"
            variant="tertiary"
            className="bg-quinary-light dark:bg-quinary-dark">
            <CircleExclamation className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Spielinfos */}
      <div className="flex items-center justify-between w-full bg-background/50 rounded-xl p-2 shadow-lg">
        <h4 className="text-fluid-xs lg:text-fluid-md font-bold text-right flex-1 truncate ">{spielData.team1.name || "Team 1"}</h4>

        <span
          className={`w-fit px-3 lg:px-4 text-center text-fluid-base font-extrabold ${spielData.status === "vergangen" ? "text-success" : "text-danger"}`}>
          {spielErgebnis}
        </span>

        <h4 className="text-fluid-xs lg:text-fluid-md font-bold text-left flex-1 truncate">{spielData.team2.name || "Team 2"}</h4>
      </div>

      <div className="flex flex-row items-center justify-center w-full h-fit gap-x-2">
        <SpielStatusChip spielStatus={spielData.status} />
        <SpielPhaseChip spielPhase={spielData.phase} />
      </div>
    </div>
  );
}
