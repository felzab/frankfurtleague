import { COPY } from "@/core/copy";
import { ERGEBNIS_TRENNER } from "@/core/format";

import { figures, look, NONE, sideMarks } from "./MatchRow";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Figures, MatchRowProps, MatchSide } from "./MatchRow";

export type MatchHeadProps = {
  /** The line above the pairing, as a competition's round stands over a scoreboard: the matchday. */
  eyebrow: string;
  home: MatchSide;
  away: MatchSide;
  /** Absent until a result is entered, so an unplayed match never reads 0:0. */
  result?: MatchRowProps["result"];
};

const head = tv({
  extend: sideMarks,
  slots: {
    // The band: the lighter surface run edge to edge across the dialog's top, the padding the box declares
    // taken back around it, so the pairing is framed as the old pop-up framed the teams, on a surface of its
    // own. Its top corners are the box's: a box whose overflow is not visible clips its content to its
    // rounded padding edge (CSS Backgrounds 3, corner clipping).
    root: "-mx-(--dialog-padding) -mt-(--dialog-padding) grid justify-items-center gap-4 bg-bg-surface p-6",
    eyebrow: "text-xs font-medium text-fg-muted",
    side: "grid min-w-0 justify-items-center gap-2 text-center",
    name: "min-w-0 text-sm [overflow-wrap:anywhere]",
  },
});

function Goals({ score, part }: { score: Figures; part: "home" | "away" }) {
  return <span className={head(look(score, part)).goals()}>{score === null ? NONE : score[part]}</span>;
}

/** A side as the centred look sets it: the plaque over the name. */
function Side({ side, score, part }: { side: MatchSide; score: Figures; part: "home" | "away" }) {
  const style = head(look(score, part));
  return (
    <span className={style.side()}>
      <TeamPlaque {...side.plaque} />
      <span className={style.name()}>{side.name}</span>
    </span>
  );
}

/**
 * The match head over the pop-up's facts: the matchday, and under it the two sides as a pairing with their
 * plaques over their names and the score large between them, „n. E.“ under a shoot-out's score, the whole
 * on the band across the dialog's top. The one block that names a match by its two sides.
 */
export function MatchHead({ eyebrow, home, away, result }: MatchHeadProps) {
  const score = figures(result);
  const shootOut = score?.shootOut === true ? COPY.shared.nachElfmeterschiessen : null;
  const style = head();
  return (
    <div className={style.root()}>
      <span className={style.eyebrow()}>{eyebrow}</span>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
        <Side
          side={home}
          score={score}
          part="home"
        />
        <span className="grid justify-items-center pt-0.5">
          <span className="text-3xl leading-none">
            <Goals
              score={score}
              part="home"
            />
            <span className={score === null ? "text-fg-muted" : undefined}>{ERGEBNIS_TRENNER}</span>
            <Goals
              score={score}
              part="away"
            />
          </span>
          {/* Placed under the score, and read straight after it; the line keeps its height so the sides stand still. */}
          <span className="h-4 text-xs text-fg-muted">{shootOut}</span>
        </span>
        <Side
          side={away}
          score={score}
          part="away"
        />
      </div>
    </div>
  );
}
