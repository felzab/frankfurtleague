"use client";

import { CircleExclamation } from "@gravity-ui/icons";

import { Button, Card } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";

import { formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "./SaisonPhaseChip";
import { SpielScore } from "./SpielScore";
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
        {/* The timeline rail is narrower than this row's content on a phone, and nothing here may
            deform instead of wrapping. Only the LEFT GROUP wraps: the chip drops under the date,
            the button stays pinned to the card's corner. */}
        <div className="flex h-fit w-full flex-row items-center gap-x-4">
          <div className="flex min-w-0 flex-row flex-wrap items-center gap-x-4 gap-y-2">
            {/* One non-breaking unit: a date split across lines reads as two dates. */}
            <div className="fluid-sm text-foreground-muted flex shrink-0 flex-row items-center gap-x-2 font-bold whitespace-nowrap">
              {/* A comma joins the pair, never a dash: no dash is punctuation (`docs/frontend/spec.md` §1.12). */}
              <span>{spielDatum},</span>
              <span>{spielUhrzeit}</span>
            </div>

            <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
          </div>

          {/* The row's classes sit on the span because the trigger div lands between them;
              `shrink-0` so a tap target keeps its box whatever the row does. */}
          {onOpenInfoModal && (
            <span className="ml-auto flex shrink-0 self-start">
              <IconTooltip label="Spielinfo">
                <Button
                  isIconOnly
                  aria-label={`Spielinfo Spiel Nr. ${spielData.spiel_nr}`}
                  onPress={onOpenInfoModal}
                  size="sm"
                  variant="tertiary"
                  /* `flex` here and on the span, and `bg-hover-muted`, for `SpielCard.tsx`'s
                     reasons at the same control. `rounded-xl` is spelled, not inherited: HeroUI's
                     base radius clamps to a circle at this size. */
                  className="bg-muted text-foreground data-hovered:bg-hover-muted flex h-[32px] w-[32px] rounded-xl p-0 transition-colors duration-200">
                  <CircleExclamation className="m-0 size-4" />
                </Button>
              </IconTooltip>
            </span>
          )}
        </div>

        {/* Equal 1fr tracks centre the score whatever the names measure; the popover carries the
            full name a truncation drops. */}
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <span className="flex min-w-0 justify-end">
            <SpielTeamSlot
              team={spielData.team1}
              quelle={spielData.team1_quelle}
              text={spielData.team1?.name || "Team 1"}
              className="fluid-sm lg:fluid-base max-w-full truncate text-right font-bold"
            />
          </span>

          {/* `-strong` and a second line under the score, as on the other two cards. */}
          <SpielScore
            ergebnis={spielErgebnis}
            elfmeterschiessen={spielElfmeterschiessen}
            className={`fluid-base flex flex-col items-center px-2 py-1 text-center font-extrabold ${spielData.ergebnis !== null ? "text-success-strong" : "text-danger-strong"}`}
          />

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
