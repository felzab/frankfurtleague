"use client";

import { PLACEHOLDER } from "@/shared/utils/format";

import { computeSpielStatus, formatQuelle, formatSpielDisplay } from "../../../utils";
import { SaisonPhaseChip } from "../../ui/SaisonPhaseChip";
import { SpielStatusChip } from "../../ui/SpielStatusChip";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * The fixture as it will read once saved.
 *
 * **Built by laying the draft over the stored fixture and then rendering through the site's own
 * derivations** — `formatSpielDisplay`, `computeSpielStatus`, `formatQuelle`, `PLACEHOLDER` and the two
 * real chips. That is the whole mechanism that keeps this honest: the drift actually at risk in a
 * preview is in the strings, not the boxes (`-:-` against `- : -`, `4:3 i. E.`, "Noch offen", the
 * status vocabulary), and every one of those comes from a helper this component calls rather than from
 * a copy it keeps.
 *
 * **`ergebnis` is derived here the way the backend derives it** — a scoreline only when both counts are
 * present — because the stored `ergebnis` string belongs to the stored goals and would contradict the
 * draft the moment either is edited. Same for the shoot-out: the write path keeps a record only on a
 * knockout fixture that finished level and discards it anywhere else (ADR-0044), so a preview that
 * showed one on a 3:1 would promise something the save throws away.
 *
 * **Not `SpielCardCompact` itself**, though it renders the same information. That card mounts
 * `SpielTeamSlot`, which mounts a `TeamPopoverMenu` — a popover whose links navigate away, on a page
 * holding unsaved changes — and suppressing it would mean a mode flag on a card ADR-0007 forbids
 * growing modes on. This is a mirror; that card is a link into detail.
 *
 * **It shows the DRAFT and says so.** When anything is unsaved the panel takes a brand border and a
 * "Nicht gespeichert" chip, so a glance can never read it as what is stored. The previous values are
 * named field by field, in the change list beside this and under each edited field.
 */
export function SpielDraftPreview({
  previewSpiel,
  today,
  isDirty,
}: {
  /** The fixture as it will stand once saved, from `applyDraftToSpiel`. */
  previewSpiel: FLSpiel;
  today: string;
  isDirty: boolean;
}) {
  const { datum, uhrzeit, ergebnis, elfmeterschiessen } = formatSpielDisplay(previewSpiel);
  const spielStatus = computeSpielStatus({ datum: previewSpiel.datum, isCanceled: previewSpiel.is_canceled, today });

  // Team, then provenance, then the shared placeholder — the fall-through every card uses (ADR-0041),
  // so this names a side exactly as the bracket will.
  const team1Name = previewSpiel.team1?.name || formatQuelle(previewSpiel.team1_quelle) || PLACEHOLDER.slot;
  const team2Name = previewSpiel.team2?.name || formatQuelle(previewSpiel.team2_quelle) || PLACEHOLDER.slot;

  return (
    <div className={`flex w-full flex-col gap-y-3 rounded-xl border p-3 ${isDirty ? "border-brand/50 bg-brand/5" : "border-border"}`}>
      {/* Two rows, always: date and time, then the chips (owner, seventh review). One wrapping row
          broke exactly on narrow cards — one chip on the first line, the other bleeding onto the
          next — and a layout that is sometimes one row and sometimes two reads as two designs. */}
      <div className="flex w-full flex-col gap-y-1.5">
        <div className="flex w-full flex-row items-baseline gap-x-2">
          <span className="fluid-xs text-foreground font-bold">{datum}</span>
          <span className="fluid-xs text-foreground-muted font-medium">{uhrzeit}</span>
        </div>
        <div className="flex w-full flex-row flex-wrap items-center gap-1.5">
          <SpielStatusChip spielStatus={spielStatus} />
          <SaisonPhaseChip saisonPhase={previewSpiel.saison_phase} />
        </div>
      </div>

      {/* The equal-track grid every scoreline in the app uses: both 1fr columns resolve to the wider
          name's width, so the score stays centred however the two names differ. */}
      <div className="bg-muted grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl p-2">
        <span className="fluid-xs text-foreground min-w-0 truncate text-right font-bold">{team1Name}</span>
        <span
          className={`fluid-base flex w-fit flex-col items-center px-3 text-center font-extrabold ${
            previewSpiel.ergebnis !== null ? "text-success-strong" : "text-danger-strong"
          }`}>
          {ergebnis}
          {/* A second line under the score, never folded into it: the fixture finished level and the
              Saisontabelle counts it as a draw, so the score has to stay the score (ADR-0044). */}
          {elfmeterschiessen !== null && <span className="fluid-xxs font-semibold whitespace-nowrap">{elfmeterschiessen}</span>}
        </span>
        <span className="fluid-xs text-foreground min-w-0 truncate text-left font-bold">{team2Name}</span>
      </div>

      <dl className="flex w-full flex-col gap-y-1">
        <div className="flex flex-row items-baseline justify-between gap-x-3">
          <dt className="fluid-xxs text-foreground-muted font-bold">Ort</dt>
          <dd className="fluid-xs text-foreground min-w-0 truncate font-semibold">{previewSpiel.ort?.name ?? PLACEHOLDER.entity}</dd>
        </div>
        <div className="flex flex-row items-baseline justify-between gap-x-3">
          <dt className="fluid-xxs text-foreground-muted font-bold">Schiedsrichter</dt>
          <dd className="fluid-xs text-foreground min-w-0 truncate font-semibold">{previewSpiel.schiedsrichter?.name ?? PLACEHOLDER.entity}</dd>
        </div>
      </dl>
    </div>
  );
}
