"use client";

import { CircleExclamation, PencilToSquare } from "@gravity-ui/icons";

import { useServerConfig } from "@/core/providers/ServerConfigProvider";

import { Button } from "@heroui/react";

import { computeSpielStatus } from "../utils";
import SaisonPhaseChip from "./ui/SaisonPhaseChip";
import SpielStatusChip from "./ui/SpielStatusChip";

import type { FLSpiel } from "../schemas";

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
      className={`bg-tertiary-light dark:bg-tertiary-dark relative mb-2 flex h-auto w-full max-w-[1000px] flex-col items-center justify-between gap-x-4 gap-y-6 rounded-3xl px-4 py-3 lg:w-[98%] lg:px-5 lg:py-4 ${
        spielStatus === "vergangen" && "opacity-85"
      }`}>
      <div className="flex w-full flex-row items-center justify-between">
        {/* Datum/Uhrzeit */}
        <div className="flex flex-col">
          <span className="text-fluid-sm font-bold">{spielDatum}</span>
          <span className="text-fluid-xs font-medium">{spielUhrzeit}</span>
        </div>

        {/* Buttons */}
        <div className="flex w-full items-center justify-end gap-x-2">
          {onOpenAdminModal && (
            <Button
              isIconOnly
              aria-label={`Spielinfo bearbeiten Spiel Nr.${spielData.spiel_nr}`}
              onPress={onOpenAdminModal}
              size="md"
              variant="tertiary"
              className="bg-quinary-light dark:bg-quinary-dark w-[40px] px-0 md:w-[45px]">
              <PencilToSquare className="h-5 w-5 px-0" />
            </Button>
          )}
          <Button
            aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
            onPress={onOpenInfoModal}
            size="md"
            variant="tertiary"
            className="bg-quinary-light dark:bg-quinary-dark w-[40px] px-0 md:w-[45px]">
            <CircleExclamation className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Spielinfos */}
      <div className="bg-quinary-light dark:bg-primary-dark/90 flex w-full items-center justify-between rounded-xl p-2">
        <strong className="text-fluid-xs lg:text-fluid-md flex-1 truncate text-right font-bold">{spielData.team1.name || "Team 1"}</strong>

        <span
          className={`text-fluid-base w-fit px-3 text-center font-extrabold lg:px-4 ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>
          {spielErgebnis}
        </span>

        <strong className="text-fluid-xs lg:text-fluid-md flex-1 truncate text-left font-bold">{spielData.team2.name || "Team 2"}</strong>
      </div>

      <div className="flex h-fit w-full flex-row items-center justify-center gap-x-2">
        <SpielStatusChip spielStatus={spielStatus} />
        <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
      </div>
    </div>
  );
}
