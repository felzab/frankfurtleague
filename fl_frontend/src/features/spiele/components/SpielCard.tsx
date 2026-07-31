"use client";

import { CircleExclamation, PencilToSquare } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import TeamPopoverMenu from "@/features/teams/components/TeamPopoverMenu";
import { card } from "@/shared/components/ui/card";

import { computeSpielStatus, formatSpielDisplay } from "../utils";
import SaisonPhaseChip from "./ui/SaisonPhaseChip";
import SpielStatusChip from "./ui/SpielStatusChip";

import type { FLSpiel } from "../schemas";

export default function SpielCard({
  spielData,
  onOpenInfoModal,
  onOpenAdminModal,
  today,
}: {
  spielData: FLSpiel;
  onOpenInfoModal: () => void;
  onOpenAdminModal?: () => void;
  today: string;
}) {
  const { datum: spielDatum, uhrzeit: spielUhrzeit, ergebnis: spielErgebnis } = formatSpielDisplay(spielData);

  const spielStatus = computeSpielStatus({
    datum: spielData.datum,
    isCanceled: spielData.is_canceled,
    today,
  });

  return (
    <div
      role="listitem"
      className={`${card()} relative flex h-auto w-full flex-col items-center justify-between gap-x-4 gap-y-6 px-4 py-3 lg:px-5 lg:py-4 ${
        spielStatus === "vergangen" ? "opacity-90" : ""
      }`}>
      <div className="flex w-full flex-row items-center justify-between">
        {/* Datum/Uhrzeit */}
        <div className="flex flex-col">
          <span className="text-fluid-sm text-foreground font-bold">{spielDatum}</span>
          <span className="text-fluid-xs text-foreground-muted font-medium">{spielUhrzeit}</span>
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
              className="bg-muted text-foreground hover:bg-muted/80 h-[35px] w-[35px] p-0 transition-all duration-200 md:h-[38px] md:w-[38px]">
              <PencilToSquare className="m-0 size-5" />
            </Button>
          )}
          <Button
            isIconOnly
            aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
            onPress={onOpenInfoModal}
            size="md"
            variant="tertiary"
            className="bg-muted text-foreground hover:bg-muted/80 h-[35px] w-[35px] p-0 transition-all duration-200 md:h-[38px] md:w-[38px]">
            <CircleExclamation className="m-0 size-5" />
          </Button>
        </div>
      </div>

      {/* Spielinfos — equal 1fr tracks keep the score centered regardless of name lengths. */}
      <div className="bg-muted grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl p-2">
        <span className="flex min-w-0 justify-end">
          <TeamPopoverMenu
            teamName={spielData.team1.name}
            teamId={spielData.team1.team_id}
            teamShorthand={spielData.team1.shorthand}>
            <strong className="text-fluid-xs lg:text-fluid-sm hover:text-brand max-w-full truncate text-right font-bold transition-colors duration-200">
              {spielData.team1.name || "Team 1"}
            </strong>
          </TeamPopoverMenu>
        </span>

        <span
          className={`text-fluid-base w-fit px-3 text-center font-extrabold lg:px-4 ${spielData.ergebnis !== null ? "text-success" : "text-danger"}`}>
          {spielErgebnis}
        </span>

        <span className="flex min-w-0 justify-start">
          <TeamPopoverMenu
            teamName={spielData.team2.name}
            teamId={spielData.team2.team_id}
            teamShorthand={spielData.team2.shorthand}>
            <strong className="text-fluid-xs lg:text-fluid-sm hover:text-brand max-w-full truncate text-left font-bold transition-colors duration-200">
              {spielData.team2.name || "Team 2"}
            </strong>
          </TeamPopoverMenu>
        </span>
      </div>

      <div className="flex h-fit w-full flex-row items-center justify-center gap-x-2">
        <SpielStatusChip spielStatus={spielStatus} />
        <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
      </div>
    </div>
  );
}
