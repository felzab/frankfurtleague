"use client";

/**
 * SPIELE · the timeline match card
 *
 * One chip and full team names, for the dashed vertical timeline a team's page renders its fixtures
 * in. That rail is narrower than any card grid and narrowest on a phone, which is what every wrapping
 * rule below is about.
 *
 * Invariants:
 * - Never merged with `SpielCard` or `SpielCardUltraCompact`; only their shared derivation is
 *   extracted (ADR-0005).
 */
import { CircleExclamation } from "@gravity-ui/icons";

import { Button, Card } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";

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
        {/* Metadata. Inside the timeline rail this row gets ~259px on a 375px phone and its content
            needs ~319px: measured 2026-08-08 against the local stack, where the un-wrappable row
            crushed the 32px info button to 16px and pushed 26px past the card edge. Nothing here may
            deform instead of wrapping — but only the LEFT GROUP wraps: the chip moves under the date
            when space runs out, while the button stays a direct child of the outer row, pinned to the
            card's top-right corner as it is on SpielCard (decided 2026-08-08). `self-start` costs the
            button nothing on one line, where it is the tallest item anyway. */}
        <div className="flex h-fit w-full flex-row items-center gap-x-4">
          <div className="flex min-w-0 flex-row flex-wrap items-center gap-x-4 gap-y-2">
            {/** Time/Date — one non-breaking unit; a date split across lines reads as two dates. */}
            <div className="fluid-sm text-foreground-muted flex shrink-0 flex-row items-center gap-x-2 font-bold whitespace-nowrap">
              <span>{spielDatum}</span>
              <span>-</span>
              <span>{spielUhrzeit}</span>
            </div>

            <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
          </div>

          {/* SpielCard's affordance and tooltip, sized to the slimmer row. The row's classes sit on
              the span because the trigger div lands between them, `flex` so it adds no line box,
              `shrink-0` so a tap target keeps its box whatever the row does. */}
          {onOpenInfoModal && (
            <span className="ml-auto flex shrink-0 self-start">
              <IconTooltip label="Spielinfo">
                <Button
                  isIconOnly
                  aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
                  onPress={onOpenInfoModal}
                  size="sm"
                  variant="tertiary"
                  className="bg-muted text-foreground hover:bg-muted/80 h-[32px] w-[32px] p-0 transition-colors duration-200">
                  <CircleExclamation className="m-0 size-4" />
                </Button>
              </IconTooltip>
            </span>
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
              give: the fixture is a draw everywhere but the bracket (ADR-0036). */}
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
