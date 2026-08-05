"use client";

import { CircleExclamation, PencilToSquare } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { card } from "@/shared/components/ui/card";

import { computeSpielStatus, formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "./SaisonPhaseChip";
import { SpielStatusChip } from "./SpielStatusChip";
import { SpielTeamSlot } from "./SpielTeamSlot";

import type { FLSpiel } from "../../schemas";

export function SpielCard({
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
          <span className="fluid-sm text-foreground font-bold">{spielDatum}</span>
          <span className="fluid-xs text-foreground-muted font-medium">{spielUhrzeit}</span>
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
              className="bg-muted text-foreground hover:bg-muted/80 h-[35px] w-[35px] p-0 transition-colors duration-200 md:h-[38px] md:w-[38px]">
              <PencilToSquare className="m-0 size-5" />
            </Button>
          )}
          <Button
            isIconOnly
            aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
            onPress={onOpenInfoModal}
            size="md"
            variant="tertiary"
            className="bg-muted text-foreground hover:bg-muted/80 h-[35px] w-[35px] p-0 transition-colors duration-200 md:h-[38px] md:w-[38px]">
            <CircleExclamation className="m-0 size-5" />
          </Button>
        </div>
      </div>

      {/* Spielinfos — equal 1fr tracks keep the score centered regardless of name lengths. */}
      <div className="bg-muted grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl p-2">
        <span className="flex min-w-0 justify-end">
          <SpielTeamSlot
            team={spielData.team1}
            quelle={spielData.team1_quelle}
            text={spielData.team1?.name || "Team 1"}
            className="fluid-xs lg:fluid-sm max-w-full truncate text-right font-bold"
          />
        </span>

        {/* `-strong`, not the plain accents: this text sits on `bg-muted`, and the rule the tokens exist
            to carry is "plain accent for fills, `-strong` for text on a tint". The plain pair measures
            2.62:1 (success) and 3.83:1 (danger) here in the light theme. All three cards say `-strong`. */}
        <span
          className={`fluid-base w-fit px-3 text-center font-extrabold lg:px-4 ${spielData.ergebnis !== null ? "text-success-strong" : "text-danger-strong"}`}>
          {spielErgebnis}
        </span>

        <span className="flex min-w-0 justify-start">
          <SpielTeamSlot
            team={spielData.team2}
            quelle={spielData.team2_quelle}
            text={spielData.team2?.name || "Team 2"}
            className="fluid-xs lg:fluid-sm max-w-full truncate text-left font-bold"
          />
        </span>
      </div>

      <div className="flex h-fit w-full flex-row items-center justify-center gap-x-2">
        <SpielStatusChip spielStatus={spielStatus} />
        <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
      </div>
    </div>
  );
}
