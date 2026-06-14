"use client";
import { Button } from "@heroui/react";
import { CircleExclamation, PencilToSquare } from "@gravity-ui/icons";
import type { FLSpiel } from "../types";
import SpielStatusChip from "./ui/SpielStatusChip";
import { useServerConfig } from "@/core/providers/ServerConfigProvider";
import { computeSpielStatus } from "../utils";
import SaisonPhaseChip from "./ui/SaisonPhaseChip";

export default function SpielCard({
  spielData,
  onOpenInfoModal,
  onOpenAdminModal,
}: {
  spielData: FLSpiel;
  onOpenInfoModal: () => void;
  onOpenAdminModal?: () => void;
}) {
  const { today } = useServerConfig();

  const spielDatum = spielData.datum ? new Date(spielData.datum).toLocaleDateString("de-de") : "TBD";
  const spielUhrzeit = spielData.uhrzeit || "--:--";
  const spielErgebnis = spielData.ergebnis ?? "- : -";

  const spielStatus = computeSpielStatus({
    datum: spielData.datum,
    isCanceled: spielData.is_canceled,
    today,
  });

  return (
    <div
      className={`relative flex flex-col items-center justify-between gap-x-4 gap-y-6 w-full lg:w-[98%] max-w-[1000px] h-auto px-4 py-3 lg:px-5 lg:py-4 mb-2 rounded-3xl  bg-tertiary-light dark:bg-tertiary-dark ${
        spielStatus === "vergangen" && "opacity-85"
      }`}>
      <div className="flex flex-row items-center justify-between w-full">
        {/* Datum/Uhrzeit */}
        <div className="flex flex-col">
          <span className="text-fluid-sm font-bold">{spielDatum}</span>
          <span className="text-fluid-xs font-medium">{spielUhrzeit}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end w-full gap-x-2">
          {onOpenAdminModal && (
            <Button
              isIconOnly
              aria-label={`Spielinfo bearbeiten Spiel Nr.${spielData.spiel_nr}`}
              onPress={onOpenAdminModal}
              size="md"
              variant="tertiary"
              className="bg-quinary-light dark:bg-quinary-dark w-[40px] md:w-[45px] px-0">
              <PencilToSquare className="w-5 h-5 px-0" />
            </Button>
          )}
          <Button
            aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
            onPress={onOpenInfoModal}
            size="md"
            variant="tertiary"
            className="bg-quinary-light dark:bg-quinary-dark w-[40px] md:w-[45px] px-0">
            <CircleExclamation className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Spielinfos */}
      <div className="flex items-center justify-between w-full bg-quinary-light dark:bg-primary-dark/90 rounded-xl p-2 ">
        <strong className="text-fluid-xs lg:text-fluid-md font-bold text-right flex-1 truncate ">{spielData.team1.name || "Team 1"}</strong>

        <span
          className={`w-fit px-3 lg:px-4 text-center text-fluid-base font-extrabold ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>
          {spielErgebnis}
        </span>

        <strong className="text-fluid-xs lg:text-fluid-md font-bold text-left flex-1 truncate">{spielData.team2.name || "Team 2"}</strong>
      </div>

      <div className="flex flex-row items-center justify-center w-full h-fit gap-x-2">
        <SpielStatusChip spielStatus={spielStatus} />
        <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
      </div>
    </div>
  );
}
