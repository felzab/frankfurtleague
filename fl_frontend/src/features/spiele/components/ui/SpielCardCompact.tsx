"use client";

import { CircleExclamation } from "@gravity-ui/icons";

import { Button, Card } from "@heroui/react";

import { TeamPopoverMenu } from "@/features/teams/components/ui/TeamPopoverMenu";
import { card } from "@/shared/components/ui/card";

import { formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "./SaisonPhaseChip";

import type { FLSpiel } from "../../schemas";

export function SpielCardCompact({ spielData, onOpenInfoModal }: { spielData: FLSpiel; onOpenInfoModal?: () => void }) {
  const { datum: spielDatum, uhrzeit: spielUhrzeit, ergebnis: spielErgebnis } = formatSpielDisplay(spielData);

  return (
    <Card className={`${card()} w-full p-4`}>
      <Card.Content className="flex w-full flex-col items-center justify-between gap-y-3 p-0 text-left">
        {/* Metadata */}
        <div className="flex h-fit w-full flex-row items-center gap-x-4">
          {/** Time/Date */}
          <div className="text-fluid-sm text-foreground-muted flex h-full w-fit flex-row items-center gap-x-2 font-bold">
            <span className="w-full">{spielDatum}</span>
            <span>-</span>
            <span className="w-full">{spielUhrzeit}</span>
          </div>

          <SaisonPhaseChip saisonPhase={spielData.saison_phase} />

          {/* The same details-modal affordance SpielCard has, sized to the slimmer row. */}
          {onOpenInfoModal && (
            <Button
              isIconOnly
              aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
              onPress={onOpenInfoModal}
              size="sm"
              variant="tertiary"
              className="bg-muted text-foreground hover:bg-muted/80 ml-auto h-[32px] w-[32px] p-0 transition-colors duration-200">
              <CircleExclamation className="m-0 size-4" />
            </Button>
          )}
        </div>

        {/* Teams and Score — equal 1fr tracks so the score stays centered no matter how the two
            name lengths differ; long names truncate, and the popover always carries the full name. */}
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <span className="flex min-w-0 justify-end">
            <TeamPopoverMenu
              teamName={spielData.team1.name}
              teamId={spielData.team1.team_id}
              teamShorthand={spielData.team1.shorthand}>
              <strong className="text-fluid-sm lg:text-fluid-base hover:text-brand max-w-full truncate text-right font-bold transition-colors duration-200">
                {spielData.team1.name || "Team 1"}
              </strong>
            </TeamPopoverMenu>
          </span>

          {/* `-strong` for the same reason as in the other two cards: this is text, not a fill, and the
              plain accents are too light to carry it on a light surface. */}
          <span
            className={`text-fluid-base px-2 py-1 text-center font-extrabold ${spielData.ergebnis !== null ? "text-success-strong" : "text-danger-strong"}`}>
            {spielErgebnis}
          </span>

          <span className="flex min-w-0 justify-start">
            <TeamPopoverMenu
              teamName={spielData.team2.name}
              teamId={spielData.team2.team_id}
              teamShorthand={spielData.team2.shorthand}>
              <strong className="text-fluid-sm lg:text-fluid-base hover:text-brand max-w-full truncate text-left font-bold transition-colors duration-200">
                {spielData.team2.name || "Team 2"}
              </strong>
            </TeamPopoverMenu>
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
