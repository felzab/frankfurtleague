"use client";

import Link from "next/link";

import CircleExclamation from "@gravity-ui/icons/CircleExclamation";
import PencilToSquare from "@gravity-ui/icons/PencilToSquare";

import { Button } from "@heroui/react/button";

import { BRAND_ICON_BUTTON_CLASSES } from "@/shared/components/ui/brandTile";
import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";

import { computeSpielStatus, ergebnisTone, formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "./SaisonPhaseChip";
import { ERGEBNIS_INK_CLASSES, SpielScore } from "./SpielScore";
import { SpielStatusChip } from "./SpielStatusChip";
import { SpielTeamSlot } from "./SpielTeamSlot";

import type { FLSpiel } from "../../schemas";

export function SpielCard({
  spielData,
  onOpenInfoModal,
  adminEditHref,
  asListitem = true,
  today,
  isFinishedSaison,
}: {
  spielData: FLSpiel;
  onOpenInfoModal: () => void;
  /**
   * A LINK, not a button, because the editor is a page: Next prefetches it on approach, and
   * middle-click and open-in-new-tab let an admin line up several fixtures at once.
   */
  adminEditHref?: string;
  /**
   * False only on the triage list, where a faulted fixture is a note plus a card and the WRAPPER
   * carries the role: nesting one listitem in another announces the fixture twice.
   */
  asListitem?: boolean;
  today: string;
  /** Required: a card omitting it promises a Termin for a finished season's undated fixture. */
  isFinishedSaison: boolean;
}) {
  const {
    datum: spielDatum,
    uhrzeit: spielUhrzeit,
    ergebnis: spielErgebnis,
    elfmeterschiessen: spielElfmeterschiessen,
  } = formatSpielDisplay(spielData, isFinishedSaison);

  const spielStatus = computeSpielStatus({
    datum: spielData.datum,
    sonderereignis: spielData.sonderereignis,
    today,
  });

  return (
    <div
      role={asListitem ? "listitem" : undefined}
      className={`${card()} relative flex h-auto w-full flex-col items-center justify-between gap-x-4 gap-y-6 px-4 py-3 lg:px-5 lg:py-4`}>
      <div className="flex w-full flex-row items-center justify-between">
        {/* `shrink-0`: beside the `w-full` actions the column shrinks to its longest word, and „Termin
            offen“ splits into two lines the skeleton reserves one for. */}
        <div className="flex shrink-0 flex-col">
          <span className="fluid-sm font-bold text-foreground">{spielDatum}</span>
          <span className="muted-meta">{spielUhrzeit}</span>
        </div>

        <div className="flex w-full items-center justify-end gap-x-2">
          {/* The radius is spelled on BOTH controls rather than left to HeroUI on one, the pair
              having to read as one. `IconTooltip` over `title`: it opens on focus too. The
              `aria-label`s carry the match number a tooltip should not. */}
          {adminEditHref && (
            <IconTooltip label="Spiel bearbeiten">
              <Link
                href={adminEditHref}
                aria-label={`Spiel Nr. ${spielData.spiel_nr} bearbeiten`}
                /* The brand fill rather than `bg-muted`, and the only difference from the info button
                   beside it: same box, same radius, same position, so no layout moves. */
                className={BRAND_ICON_BUTTON_CLASSES}>
                <PencilToSquare
                  aria-hidden="true"
                  className="m-0 size-4.5"
                />
              </Link>
            </IconTooltip>
          )}
          <IconTooltip label="Spielinfo">
            <Button
              isIconOnly
              aria-label={`Spielinfo Spiel Nr. ${spielData.spiel_nr}`}
              onPress={onOpenInfoModal}
              size="md"
              variant="tertiary"
              /* `flex` over HeroUI's `inline-flex`: a line box round an inline child leaves the
                 trigger's height to the font's metrics rather than to this control. And
                 `bg-hover-muted`, since this rests on `bg-muted` rather than on the page. */
              className="flex size-9 rounded-xl bg-muted p-0 text-foreground transition-colors duration-(--motion-base) data-hovered:bg-hover-muted">
              <CircleExclamation
                aria-hidden="true"
                className="m-0 size-4.5"
              />
            </Button>
          </IconTooltip>
        </div>
      </div>

      {/* Equal 1fr tracks keep the score centred regardless of name lengths. */}
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl bg-muted p-2">
        <span className="flex min-w-0 justify-end">
          <SpielTeamSlot
            team={spielData.team1}
            quelle={spielData.team1_quelle}
            saisonId={spielData.saison_id}
            text={spielData.team1?.name || "Team 1"}
            className="text-right fluid-xs font-bold lg:fluid-sm"
          />
        </span>

        {/* The shoot-out is a SECOND LINE in the same cell, so the two 1fr team tracks are unaffected. */}
        <SpielScore
          ergebnis={spielErgebnis}
          elfmeterschiessen={spielElfmeterschiessen}
          className={`flex w-fit flex-col items-center px-3 text-center fluid-base font-extrabold lg:px-4 ${ERGEBNIS_INK_CLASSES[ergebnisTone(spielData)]}`}
        />

        <span className="flex min-w-0 justify-start">
          <SpielTeamSlot
            team={spielData.team2}
            quelle={spielData.team2_quelle}
            saisonId={spielData.saison_id}
            text={spielData.team2?.name || "Team 2"}
            className="text-left fluid-xs font-bold lg:fluid-sm"
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
