"use client";

import Link from "next/link";

import { CircleExclamation, PencilToSquare } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";

import { computeSpielStatus, formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "./SaisonPhaseChip";
import { SpielStatusChip } from "./SpielStatusChip";
import { SpielTeamSlot } from "./SpielTeamSlot";

import type { FLSpiel } from "../../schemas";

export function SpielCard({
  spielData,
  onOpenInfoModal,
  adminEditHref,
  asListitem = true,
  today,
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
      role={asListitem ? "listitem" : undefined}
      className={`${card()} relative flex h-auto w-full flex-col items-center justify-between gap-x-4 gap-y-6 px-4 py-3 lg:px-5 lg:py-4`}>
      <div className="flex w-full flex-row items-center justify-between">
        <div className="flex flex-col">
          <span className="fluid-sm text-foreground font-bold">{spielDatum}</span>
          <span className="fluid-xs text-foreground-muted font-medium">{spielUhrzeit}</span>
        </div>

        <div className="flex w-full items-center justify-end gap-x-2">
          {/* The radius is spelled on BOTH controls rather than left to HeroUI on one, the pair
              having to read as one. `IconTooltip` over `title`: it opens on focus too. The
              `aria-label`s carry the match number a tooltip should not. */}
          {adminEditHref && (
            <IconTooltip label="Spiel bearbeiten">
              <Link
                href={adminEditHref}
                aria-label={`Spiel Nr.${spielData.spiel_nr} bearbeiten`}
                /* The brand fill rather than `bg-muted`, and the only difference from the info button
                   beside it: same box, same radius, same position, so no layout moves. The pairing is
                   `-solid` plus its own foreground, like every other opaque fill. */
                className="bg-brand-solid text-brand-solid-foreground hover:bg-brand-solid-hover flex h-[35px] w-[35px] items-center justify-center rounded-xl shadow-sm transition-colors duration-200 md:h-[38px] md:w-[38px]">
                <PencilToSquare className="m-0 size-5" />
              </Link>
            </IconTooltip>
          )}
          <IconTooltip label="Spielinfo">
            <Button
              isIconOnly
              aria-label={`Spielinfo Spiel Nr.${spielData.spiel_nr}`}
              onPress={onOpenInfoModal}
              size="md"
              variant="tertiary"
              /* `flex` over HeroUI's `inline-flex`: a line box round an inline child leaves the
                 trigger's height to the font's metrics rather than to this control. And
                 `bg-hover-muted`, since this rests on `bg-muted` rather than on the page. */
              className="bg-muted text-foreground data-hovered:bg-hover-muted flex h-[35px] w-[35px] rounded-xl p-0 transition-colors duration-200 md:h-[38px] md:w-[38px]">
              <CircleExclamation className="m-0 size-5" />
            </Button>
          </IconTooltip>
        </div>
      </div>

      {/* Equal 1fr tracks keep the score centred regardless of name lengths. */}
      <div className="bg-muted grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl p-2">
        <span className="flex min-w-0 justify-end">
          <SpielTeamSlot
            team={spielData.team1}
            quelle={spielData.team1_quelle}
            text={spielData.team1?.name || "Team 1"}
            className="fluid-xs lg:fluid-sm max-w-full truncate text-right font-bold"
          />
        </span>

        {/* `-strong`, not the plain accents: the tokens' rule is plain for fills, `-strong` for
            text on a tint, and this sits on `bg-muted`. The shoot-out is a SECOND LINE in the same
            cell, so the two 1fr team tracks are unaffected. */}
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
