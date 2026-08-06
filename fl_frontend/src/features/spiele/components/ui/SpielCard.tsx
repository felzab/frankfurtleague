"use client";

import Link from "next/link";

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
  adminEditHref,
  today,
}: {
  spielData: FLSpiel;
  onOpenInfoModal: () => void;
  /**
   * Where this fixture is edited, on the admin routes; absent on every public one.
   *
   * A LINK, not a button, because the editor is a page now (ADR-0050). Three things follow that a
   * button could not give: Next prefetches the route on approach, so the first tap pays for no chunk —
   * which is what the modal's hand-rolled idle preload existed to fake — and middle-click and
   * open-in-new-tab work, so an admin can line up several fixtures at once.
   */
  adminEditHref?: string;
  today: string;
}) {
  const {
    datum: spielDatum,
    uhrzeit: spielUhrzeit,
    ergebnis: spielErgebnis,
    elfmeterschiessen: spielElfmeterschiessen,
  } = formatSpielDisplay(spielData);

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
          {adminEditHref && (
            // The classes match the icon button beside it exactly, minus the ones HeroUI's Button
            // supplied itself — a link and a button sitting in one row must not read as two controls.
            <Link
              href={adminEditHref}
              aria-label={`Spiel Nr.${spielData.spiel_nr} bearbeiten`}
              className="bg-muted text-foreground hover:bg-muted/80 flex h-[35px] w-[35px] items-center justify-center rounded-lg transition-colors duration-200 md:h-[38px] md:w-[38px]">
              <PencilToSquare className="m-0 size-5" />
            </Link>
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
        {/* The shoot-out is a SECOND LINE under the score, never folded into it: the fixture finished
            level and the Saisontabelle counts it as a draw, so `2:2` has to stay the score this card
            shows (ADR-0044). Inside the same grid cell, so the two 1fr team tracks are unaffected. */}
        <span
          className={`fluid-base flex w-fit flex-col items-center px-3 text-center font-extrabold lg:px-4 ${spielData.ergebnis !== null ? "text-success-strong" : "text-danger-strong"}`}>
          {spielErgebnis}
          {spielElfmeterschiessen !== null && <span className="fluid-xxs font-semibold whitespace-nowrap">{spielElfmeterschiessen}</span>}
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
