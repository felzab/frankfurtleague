"use client";

import { spielSchiedsrichterAnzeige } from "@/features/schiedsrichter/constants";
import { PLACEHOLDER } from "@/shared/utils/format";

import { computeSpielStatus, ergebnisTone, formatQuelle, formatSpielDisplay } from "../../../utils";
import { SaisonPhaseChip } from "../../ui/SaisonPhaseChip";
import { ERGEBNIS_INK_CLASSES, SpielScore } from "../../ui/SpielScore";
import { SpielStatusChip } from "../../ui/SpielStatusChip";
import { SLOT_LABEL_WRAP_CLASSES, TEAM_NAME_TRACK_CLASSES, TEAM_NAME_WRAP_CLASSES } from "../../ui/teamName";

import type { FLSpielWithDraftFields } from "@/features/spiele/schemas";

/**
 * **Not `SpielCardCompact` itself**: that card mounts a popover whose links navigate away from a
 * page holding unsaved changes. Rendered through the site's own derivations, never copies of them.
 */
export function SpielDraftPreview({
  previewSpiel,
  today,
  isDirty,
  isFinishedSaison,
}: {
  previewSpiel: FLSpielWithDraftFields;
  today: string;
  isDirty: boolean;
  isFinishedSaison: boolean;
}) {
  const { datum, uhrzeit, ergebnis, elfmeterschiessen } = formatSpielDisplay(previewSpiel, isFinishedSaison);
  const spielStatus = computeSpielStatus({ datum: previewSpiel.datum, sonderereignis: previewSpiel.sonderereignis, today });

  // The award is composed on the server from the season's forfeit rule, which this page never loads.
  // So the score reads as unknown and this names why, rather than the preview inventing figures the
  // save would replace.
  const isAwaitingForfeit = previewSpiel.sonderereignis === "nichtantreten_team1" || previewSpiel.sonderereignis === "nichtantreten_team2";

  // The fall-through every card uses, so this names a side exactly as the bracket will: a club clamped
  // at two lines, a label never.
  const sideName = (team: FLSpielWithDraftFields["team1"], quelle: FLSpielWithDraftFields["team1_quelle"], align: string) => (
    <span className={`fluid-xs font-bold text-foreground ${align} ${TEAM_NAME_TRACK_CLASSES}`}>
      {team?.name ? (
        <span className={`${align} ${TEAM_NAME_WRAP_CLASSES}`}>{team.name}</span>
      ) : (
        <span className={`${align} ${SLOT_LABEL_WRAP_CLASSES}`}>{formatQuelle(quelle) ?? PLACEHOLDER.slot}</span>
      )}
    </span>
  );

  return (
    <div className={`flex w-full flex-col gap-y-3 rounded-xl border p-3 ${isDirty ? "border-brand/50 bg-brand/5" : "border-border"}`}>
      {/* Two rows, always: date and time, then the chips. One wrapping row
          broke exactly on narrow cards — one chip on the first line, the other bleeding onto the
          next — and a layout that is sometimes one row and sometimes two reads as two designs. */}
      <div className="flex w-full flex-col gap-y-1">
        <div className="flex w-full flex-row items-baseline gap-x-2">
          <span className="fluid-xs font-bold text-foreground">{datum}</span>
          <span className="muted-meta">{uhrzeit}</span>
        </div>
        <div className="flex w-full flex-row flex-wrap items-center gap-2">
          <SpielStatusChip spielStatus={spielStatus} />
          <SaisonPhaseChip saisonPhase={previewSpiel.saison_phase} />
        </div>
      </div>

      {/* The equal-track grid every scoreline uses: both 1fr columns resolve to the wider
          name's width, so the score stays centred however the two names differ. */}
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl bg-muted p-2">
        {sideName(previewSpiel.team1, previewSpiel.team1_quelle, "text-right")}
        <SpielScore
          ergebnis={ergebnis}
          elfmeterschiessen={elfmeterschiessen}
          className={`flex w-fit flex-col items-center px-3 text-center fluid-base font-extrabold ${ERGEBNIS_INK_CLASSES[ergebnisTone(previewSpiel)]}`}
        />
        {sideName(previewSpiel.team2, previewSpiel.team2_quelle, "text-left")}
      </div>

      {isAwaitingForfeit && <p className="text-center muted-meta">Das Ergebnis steht erst nach dem Speichern fest.</p>}

      <dl className="flex w-full flex-col gap-y-1">
        <div className="flex flex-row items-baseline justify-between gap-x-3">
          <dt className="fluid-xxs font-bold text-foreground-muted">Ort</dt>
          <dd className="min-w-0 truncate fluid-xs font-semibold text-foreground">{previewSpiel.ort?.name ?? PLACEHOLDER.entity}</dd>
        </div>
        <div className="flex flex-row items-baseline justify-between gap-x-3">
          <dt className="fluid-xxs font-bold text-foreground-muted">Schiedsrichter</dt>
          <dd className="min-w-0 truncate fluid-xs font-semibold text-foreground">{spielSchiedsrichterAnzeige(previewSpiel.schiedsrichter)}</dd>
        </div>
      </dl>
    </div>
  );
}
