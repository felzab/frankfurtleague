"use client";

import { spielSchiedsrichterAnzeige } from "@/features/schiedsrichter/constants";
import { PLACEHOLDER } from "@/shared/utils/format";

import { computeSpielStatus, formatQuelle, formatSpielDisplay, isAbgesagt } from "../../../utils";
import { SaisonPhaseChip } from "../../ui/SaisonPhaseChip";
import { SpielScore } from "../../ui/SpielScore";
import { SpielStatusChip } from "../../ui/SpielStatusChip";

import type { FLSpielWithDraftFields } from "@/features/spiele/schemas";

/**
 * **Not `SpielCardCompact` itself**: that card mounts a popover whose links navigate away from a
 * page holding unsaved changes. Rendered through the site's own derivations, never copies of them.
 */
export function SpielDraftPreview({ previewSpiel, today, isDirty }: { previewSpiel: FLSpielWithDraftFields; today: string; isDirty: boolean }) {
  const { datum, uhrzeit, ergebnis, elfmeterschiessen } = formatSpielDisplay(previewSpiel);
  const spielStatus = computeSpielStatus({ datum: previewSpiel.datum, sonderereignis: previewSpiel.sonderereignis, today });

  // The award is composed on the server from the season's forfeit rule, which this page never loads.
  // So the score reads as unknown and this names why, rather than the preview inventing figures the
  // save would replace.
  const isAwaitingForfeit = previewSpiel.sonderereignis === "nichtantreten_team1" || previewSpiel.sonderereignis === "nichtantreten_team2";

  // A stored result outranks the event: a forfeit's awarded score is what the Saisontabelle counts.
  // Danger only where none is stored, the placeholder then being one nothing will ever fill rather
  // than a result still owed.
  const ergebnisTint =
    previewSpiel.ergebnis !== null
      ? "text-success-strong"
      : isAbgesagt(previewSpiel.sonderereignis)
        ? "text-danger-strong"
        : "text-warning-strong";

  // The fall-through every card uses, so this names a side exactly as the bracket will.
  const team1Name = previewSpiel.team1?.name || formatQuelle(previewSpiel.team1_quelle) || PLACEHOLDER.slot;
  const team2Name = previewSpiel.team2?.name || formatQuelle(previewSpiel.team2_quelle) || PLACEHOLDER.slot;

  return (
    <div className={`flex w-full flex-col gap-y-3 rounded-xl border p-3 ${isDirty ? "border-brand/50 bg-brand/5" : "border-border"}`}>
      {/* Two rows, always: date and time, then the chips. One wrapping row
          broke exactly on narrow cards — one chip on the first line, the other bleeding onto the
          next — and a layout that is sometimes one row and sometimes two reads as two designs. */}
      <div className="flex w-full flex-col gap-y-1">
        <div className="flex w-full flex-row items-baseline gap-x-2">
          <span className="fluid-xs text-foreground font-bold">{datum}</span>
          <span className="muted-meta">{uhrzeit}</span>
        </div>
        <div className="flex w-full flex-row flex-wrap items-center gap-2">
          <SpielStatusChip spielStatus={spielStatus} />
          <SaisonPhaseChip saisonPhase={previewSpiel.saison_phase} />
        </div>
      </div>

      {/* The equal-track grid every scoreline uses: both 1fr columns resolve to the wider
          name's width, so the score stays centred however the two names differ. */}
      <div className="bg-muted grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl p-2">
        <span className="fluid-xs text-foreground min-w-0 truncate text-right font-bold">{team1Name}</span>
        <SpielScore
          ergebnis={ergebnis}
          elfmeterschiessen={elfmeterschiessen}
          className={`fluid-base flex w-fit flex-col items-center px-3 text-center font-extrabold ${ergebnisTint}`}
        />
        <span className="fluid-xs text-foreground min-w-0 truncate text-left font-bold">{team2Name}</span>
      </div>

      {isAwaitingForfeit && <p className="muted-meta text-center">Das Ergebnis steht erst nach dem Speichern fest.</p>}

      <dl className="flex w-full flex-col gap-y-1">
        <div className="flex flex-row items-baseline justify-between gap-x-3">
          <dt className="fluid-xxs text-foreground-muted font-bold">Ort</dt>
          <dd className="fluid-xs text-foreground min-w-0 truncate font-semibold">{previewSpiel.ort?.name ?? PLACEHOLDER.entity}</dd>
        </div>
        <div className="flex flex-row items-baseline justify-between gap-x-3">
          <dt className="fluid-xxs text-foreground-muted font-bold">Schiedsrichter</dt>
          <dd className="fluid-xs text-foreground min-w-0 truncate font-semibold">{spielSchiedsrichterAnzeige(previewSpiel.schiedsrichter)}</dd>
        </div>
      </dl>
    </div>
  );
}
