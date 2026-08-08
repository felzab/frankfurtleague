"use client";

import { CircleExclamation } from "@gravity-ui/icons";

import { Button, Card } from "@heroui/react";

import { card } from "@/shared/components/ui/card";

import { formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "./SaisonPhaseChip";
import { SpielTeamSlot } from "./SpielTeamSlot";

import type { FLSpiel } from "../../schemas";

export function SpielCardCompact({ spielData, onOpenInfoModal }: { spielData: FLSpiel; onOpenInfoModal?: () => void }) {
  const {
    datum: spielDatum,
    uhrzeit: spielUhrzeit,
    ergebnis: spielErgebnis,
    elfmeterschiessen: spielElfmeterschiessen,
  } = formatSpielDisplay(spielData);

  return (
    <Card className={`${card()} w-full p-4`}>
      <Card.Content className="flex w-full flex-col items-center justify-between gap-y-3 p-0 text-left">
        {/* Metadata. `flex-wrap`, because inside the timeline rail this row gets ~259px on a 375px
            phone and its content needs ~319px: measured 2026-08-08 against the local stack, where the
            un-wrappable row crushed the 32px info button to 16px and pushed 26px past the card edge.
            Nothing here may deform instead of wrapping — the date group and the button are `shrink-0`,
            so below ~435px the chip (and the button after it) moves to a second line intact. */}
        <div className="flex h-fit w-full flex-row flex-wrap items-center gap-x-4 gap-y-2">
          {/** Time/Date — one non-breaking unit; a date split across lines reads as two dates. */}
          <div className="fluid-sm text-foreground-muted flex shrink-0 flex-row items-center gap-x-2 font-bold whitespace-nowrap">
            <span>{spielDatum}</span>
            <span>-</span>
            <span>{spielUhrzeit}</span>
          </div>

          <SaisonPhaseChip saisonPhase={spielData.saison_phase} />

          {/* The same details-modal affordance SpielCard has, sized to the slimmer row. `shrink-0`
              carries the fix above: a tap target must wrap, never narrow. */}
          {onOpenInfoModal && (
            <Button
              isIconOnly
              aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
              onPress={onOpenInfoModal}
              size="sm"
              variant="tertiary"
              className="bg-muted text-foreground hover:bg-muted/80 ml-auto h-[32px] w-[32px] shrink-0 p-0 transition-colors duration-200">
              <CircleExclamation className="m-0 size-4" />
            </Button>
          )}
        </div>

        {/* Teams and Score — equal 1fr tracks so the score stays centered no matter how the two
            name lengths differ; long names truncate, and the popover always carries the full name. */}
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <span className="flex min-w-0 justify-end">
            <SpielTeamSlot
              team={spielData.team1}
              quelle={spielData.team1_quelle}
              text={spielData.team1?.name || "Team 1"}
              className="fluid-sm lg:fluid-base max-w-full truncate text-right font-bold"
            />
          </span>

          {/* `-strong` for the same reason as in the other two cards: this is text, not a fill, and the
              plain accents are too light to carry it on a light surface. */}
          {/* A second line under the score rather than part of it, for the reason the other two cards
              give: the fixture is a draw everywhere but the bracket (ADR-0044). */}
          <span
            className={`fluid-base flex flex-col items-center px-2 py-1 text-center font-extrabold ${spielData.ergebnis !== null ? "text-success-strong" : "text-danger-strong"}`}>
            {spielErgebnis}
            {spielElfmeterschiessen !== null && <span className="fluid-xxs font-semibold whitespace-nowrap">{spielElfmeterschiessen}</span>}
          </span>

          <span className="flex min-w-0 justify-start">
            <SpielTeamSlot
              team={spielData.team2}
              quelle={spielData.team2_quelle}
              text={spielData.team2?.name || "Team 2"}
              className="fluid-sm lg:fluid-base max-w-full truncate text-left font-bold"
            />
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
