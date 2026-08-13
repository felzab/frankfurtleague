"use client";

/**
 * SPIELE · the full-width match card
 *
 * The densest of the match cards: phase chip, status chip, full team names, and — on the admin
 * routes — a link to the editor. The responsive card grids drive it, so it is the one card whose
 * width comes from the viewport rather than from a container that has already claimed most of it.
 *
 * Invariants:
 * - Never merged with `SpielCardCompact` or `SpielCardUltraCompact`; only their shared derivation is
 *   extracted (ADR-0005).
 */
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
   * Where this fixture is edited, on the admin routes; absent on every public one.
   *
   * A LINK, not a button, because the editor is a page now (ADR-0040). Three things follow that a
   * button could not give: Next prefetches the route on approach, so the first tap pays for no chunk —
   * which is what the modal's hand-rolled idle preload existed to fake — and middle-click and
   * open-in-new-tab work, so an admin can line up several fixtures at once.
   */
  adminEditHref?: string;
  /**
   * Whether this card is itself the `role="listitem"` of the grid, which it is everywhere except on
   * the triage list: there a fixture with faults is a note plus a card, so a WRAPPER carries the role
   * and the card is plain content inside it (decided 2026-08-08). A listitem nested inside a listitem
   * would announce every faulted fixture twice, which is why this is a prop and not a second wrapper.
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
          {/* The two controls sit in one row and must read as one pair, so the radius is spelled on
              BOTH rather than left to HeroUI on the button and guessed on the link. `rounded-xl` is
              the app's icon-target radius — the same one `RowActions` uses for its 40×40 targets. */}
          {/* Both controls are icon-only, so both say in a tooltip what their glyph means. `IconTooltip`
              rather than a `title` attribute: it opens on focus as well as hover, it is the one tooltip
              appearance in the app, and its trigger is deliberately `role="presentation"` with
              `tabIndex={-1}` so wrapping an already-labelled control adds no second tab stop. The
              `aria-label`s stay — they carry the match number, which a tooltip repeated on every card
              in a grid should not. */}
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
              /* `flex` over HeroUI's `inline-flex`: the tooltip trigger is `inline-block`, and a line
                 box round an inline child leaves the trigger's height to the font's metrics rather
                 than to this control. The link beside it is block-level already. */
              className="text-foreground data-hovered:bg-hover flex h-[35px] w-[35px] rounded-xl bg-transparent p-0 transition-colors duration-200 md:h-[38px] md:w-[38px]">
              <CircleExclamation className="m-0 size-5" />
            </Button>
          </IconTooltip>
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
            shows (ADR-0036). Inside the same grid cell, so the two 1fr team tracks are unaffected. */}
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
