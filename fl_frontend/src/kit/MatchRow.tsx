import { COPY } from "@/core/copy";
import { ERGEBNIS_TRENNER } from "@/core/format";

import { Chip } from "./Chip";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Paar } from "@/core/format";
import type { Route } from "next";
import type { ChipProps } from "./Chip";

/** One side of a match: the club's name and its plaque, or the source of a side not yet known. */
export type MatchSide = { name: string; plaque: { kuerzel: string } | { quelle: string } };

export type MatchRowProps = {
  /** The match's own page, which opens as the pop-up over the list. */
  href: Route;
  /** When it is played, as the formatting module writes it. */
  when: string;
  home: MatchSide;
  away: MatchSide;
  /** Absent until a result is entered, so an unplayed match never reads 0:0. */
  result?: { tore: Paar; elfmeterschiessen?: Paar };
  /** The phase, as text. */
  phase?: string;
  /** The row's one chip, after the pairing, such as „Startelf“ on a pupil's list. */
  chip?: ChipProps;
};

/** No result yet: a dash for each side's goals. */
export const NONE = "–";

/**
 * How a side's name and goals are marked wherever a match's two sides stand, in a row, a bracket card or the
 * pop-up's head: the winner's name semibold; goals bold, a shoot-out loser's regular, and no result yet
 * muted. Each block extends it with its own layout and takes its variants from `look`.
 */
export const sideMarks = tv({
  slots: {
    name: "",
    goals: "font-numeric",
  },
  variants: {
    winner: {
      true: { name: "font-semibold" },
    },
    goals: {
      counted: { goals: "font-bold" },
      lost: { goals: "font-normal" },
      none: { goals: "font-normal text-fg-muted" },
    },
  },
});

const row = tv({
  extend: sideMarks,
  slots: {
    side: "flex min-w-0 items-center gap-2",
    name: "min-w-0 truncate",
  },
  variants: {
    // The home side on desktop: the name before its plaque, so the plaque stands nearest the score.
    mirrored: {
      true: { side: "justify-end" },
    },
  },
});

/** Each side's figure, or `null` before a result. */
export type Figures = { home: number; away: number; shootOut: boolean } | null;

/** Each side's figure: its goals, a shoot-out's goals added, as the league reports it. */
export function figures(result: MatchRowProps["result"]): Figures {
  if (result === undefined) return null;
  const { tore, elfmeterschiessen } = result;
  return {
    home: tore.team1 + (elfmeterschiessen?.team1 ?? 0),
    away: tore.team2 + (elfmeterschiessen?.team2 ?? 0),
    shootOut: elfmeterschiessen !== undefined,
  };
}

/** How one side reads, as `sideMarks`' variants: whether it won, and how its goals count. */
export function look(score: Figures, side: "home" | "away") {
  if (score === null) return { winner: false, goals: "none" } as const;
  const own = score[side];
  const other = score[side === "home" ? "away" : "home"];
  return { winner: own > other, goals: score.shootOut && own < other ? "lost" : "counted" } as const;
}

function Side({ side, score, part, mirrored }: { side: MatchSide; score: Figures; part: "home" | "away"; mirrored?: boolean }) {
  const style = row({ ...look(score, part), mirrored: mirrored === true });
  return (
    <span className={style.side()}>
      {mirrored !== true && <TeamPlaque {...side.plaque} />}
      <span className={style.name()}>{side.name}</span>
      {mirrored === true && <TeamPlaque {...side.plaque} />}
    </span>
  );
}

function Goals({ score, part }: { score: Figures; part: "home" | "away" }) {
  return <span className={row(look(score, part)).goals()}>{score === null ? NONE : score[part]}</span>;
}

function RowChip({ chip }: { chip?: ChipProps }) {
  return (
    chip !== undefined && (
      <Chip
        tone={chip.tone}
        label={chip.label}
      />
    )
  );
}

/**
 * A match in a list, the whole row a link to it. On desktop one line, 56 px: when, the home side, the
 * score with „n. E.“ centred under it, the away side, the phase, the chevron. On a phone a card of two lines
 * under the date line, each side with its goals at the right, „n. E.“ on the date line, and no chevron; every
 * row the same height with or without a shoot-out.
 */
function MatchRow({ href, when, home, away, result, phase, chip }: MatchRowProps) {
  const score = figures(result);
  const shootOut = score?.shootOut === true ? COPY.shared.nachElfmeterschiessen : null;

  return (
    <div className="border-t border-border first:border-t-0">
      <Link
        href={href}
        placement="card">
        <span className="grid min-h-14 grid-cols-[9.5rem_minmax(0,1fr)_6rem_minmax(0,1fr)_6rem_auto] grid-rows-[1.5rem_1rem] content-center items-center gap-x-3 px-4 text-sm max-lg:hidden">
          <span className="col-start-1 row-span-2 row-start-1 font-numeric text-fg-muted">{when}</span>
          <span className="col-start-2 row-span-2 row-start-1">
            <Side
              side={home}
              score={score}
              part="home"
              mirrored
            />
          </span>
          <span className="col-start-3 row-start-1 text-center text-base">
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
          {/* Placed under the score, and read straight after it. */}
          <span className="col-start-3 row-start-2 text-center text-xs text-fg-muted">{shootOut}</span>
          <span className="col-start-4 row-span-2 row-start-1 flex min-w-0 items-center gap-2">
            <Side
              side={away}
              score={score}
              part="away"
            />
            <RowChip chip={chip} />
          </span>
          <span className="col-start-5 row-span-2 row-start-1 text-end text-xs whitespace-nowrap text-fg-muted">{phase}</span>
          {/* A row in a list says it leads on; the phone's form stands as a card of its own and says nothing. */}
          <span className="col-start-6 row-span-2 row-start-1 flex self-stretch">
            <RowEnd />
          </span>
        </span>
        <span className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[1rem_1.5rem_1.5rem] items-center gap-x-3 gap-y-1 px-4 py-3 text-base lg:hidden">
          <span className="truncate font-numeric text-xs text-fg-muted">{when}</span>
          <span className="text-end text-xs text-fg-muted">{shootOut}</span>
          <span className="flex min-w-0 items-center gap-2">
            <Side
              side={home}
              score={score}
              part="home"
            />
          </span>
          <span className="min-w-7 text-end">
            <Goals
              score={score}
              part="home"
            />
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <Side
              side={away}
              score={score}
              part="away"
            />
            <RowChip chip={chip} />
          </span>
          <span className="min-w-7 text-end">
            <Goals
              score={score}
              part="away"
            />
          </span>
        </span>
      </Link>
    </div>
  );
}

/**
 * Matches one under another in one box with the card corners and the hairline, the rows parted by lines:
 * a matchday's matches, or the matches a read page lists.
 */
export function MatchList({ matches }: { matches: ReadonlyArray<MatchRowProps & { id: string }> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      {matches.map(({ id, ...match }) => (
        <MatchRow
          key={id}
          {...match}
        />
      ))}
    </div>
  );
}
