import { COPY, textOf } from "@/core/copy";
import { ERGEBNIS_SEPARATOR } from "@/core/format";

import { cardSurface, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Pair } from "@/core/format";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { Plaque } from "./TeamPlaque";

/** One side of a match: the club's name and its plaque, or the source of a side not yet known. */
export type SpielSide = { name: Words; plaque: Plaque };

export type SpielRowProps = {
  /** The match's own page, which opens as the pop-up over the list. */
  href: Route;
  /** When it is played, as the catalogue words it. */
  when: Copy;
  team1: SpielSide;
  team2: SpielSide;
  /** Absent until a result is entered, so an unplayed match never reads 0:0. */
  result?: { tore: Pair; elfmeterschiessen?: Pair };
  /** The phase, by its catalogue name. */
  phase?: Copy;
  /** The row's one chip, after the pairing, such as „Startelf“ on a pupil's list. */
  chip?: ChipProps;
};

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
    // The first side on desktop: the name before its plaque, so the plaque stands nearest the score.
    mirrored: {
      true: { side: "justify-end" },
    },
  },
});

/** Each side's figure, or `null` before a result. */
export type Figures = { team1: number; team2: number; shootOut: boolean } | null;

/** Each side's figure: its goals, a shoot-out's goals added, as the league reports it. */
export function figures(result: SpielRowProps["result"]): Figures {
  if (result === undefined) return null;
  const { tore, elfmeterschiessen } = result;
  return {
    team1: tore.team1 + (elfmeterschiessen?.team1 ?? 0),
    team2: tore.team2 + (elfmeterschiessen?.team2 ?? 0),
    shootOut: elfmeterschiessen !== undefined,
  };
}

/** How one side reads, as `sideMarks`' variants: whether it won, and how its goals count. */
export function look(score: Figures, side: "team1" | "team2") {
  if (score === null) return { winner: false, goals: "none" } as const;
  const own = score[side];
  const other = score[side === "team1" ? "team2" : "team1"];
  return { winner: own > other, goals: score.shootOut && own < other ? "lost" : "counted" } as const;
}

/** One side's goals as its block marks them, or the empty mark before a result: a row's, a head's or a bracket card's. */
export function Goal({ score, part, className }: { score: Figures; part: "team1" | "team2"; className: string }) {
  return <span className={className}>{score === null ? COPY.shared.noValue : score[part]}</span>;
}

/** The mark between the two sides' goals, muted with them before a result. */
export function GoalSeparator({ score }: { score: Figures }) {
  return <span className={score === null ? "text-fg-muted" : undefined}>{ERGEBNIS_SEPARATOR}</span>;
}

function Side({ side, score, part, mirrored }: { side: SpielSide; score: Figures; part: "team1" | "team2"; mirrored?: boolean }) {
  const style = row({ ...look(score, part), mirrored: mirrored === true });
  const name = textOf(side.name);
  return (
    <span className={style.side()}>
      {mirrored !== true && <TeamPlaque plaque={side.plaque} />}
      {/* Cut with „…“ where the side's column is too narrow, the whole name in its `title`. */}
      <span
        className={style.name()}
        title={name}>
        {name}
      </span>
      {mirrored === true && <TeamPlaque plaque={side.plaque} />}
    </span>
  );
}

function Goals({ score, part }: { score: Figures; part: "team1" | "team2" }) {
  return (
    <Goal
      score={score}
      part={part}
      className={row(look(score, part)).goals()}
    />
  );
}

function RowChip({ chip }: { chip?: ChipProps }) {
  return chip !== undefined && <Chip {...chip} />;
}

/**
 * A match in a list, the whole row a link to it. In a wide list one line, 56 px: when, the first side, the
 * score with „n. E.“ centred under it, the second side, the phase, the chevron. In a narrow one a card of two
 * lines under the date line, each side with its goals at the right, „n. E.“ on the date line, and no chevron;
 * every row the same height with or without a shoot-out.
 */
function SpielRow({ href, when, team1, team2, result, phase, chip }: SpielRowProps) {
  const score = figures(result);
  const shootOut = score?.shootOut === true ? COPY.shared.afterElfmeterschiessen : null;

  return (
    <div className={stacked()}>
      <Link
        href={href}
        placement="card">
        <span className="grid min-h-14 grid-cols-[9.5rem_minmax(0,1fr)_6rem_minmax(0,1fr)_6rem_auto] grid-rows-[1.5rem_1rem] content-center items-center gap-x-3 px-4 text-sm @max-2xl:hidden">
          <span className="col-start-1 row-span-2 row-start-1 font-numeric text-fg-muted">{when}</span>
          <span className="col-start-2 row-span-2 row-start-1">
            <Side
              side={team1}
              score={score}
              part="team1"
              mirrored
            />
          </span>
          <span className="col-start-3 row-start-1 text-center text-base">
            <Goals
              score={score}
              part="team1"
            />
            <GoalSeparator score={score} />
            <Goals
              score={score}
              part="team2"
            />
          </span>
          {/* Placed under the score, and read straight after it. */}
          <span className="col-start-3 row-start-2 text-center text-xs text-fg-muted">{shootOut}</span>
          <span className="col-start-4 row-span-2 row-start-1 flex min-w-0 items-center gap-2">
            <Side
              side={team2}
              score={score}
              part="team2"
            />
            <RowChip chip={chip} />
          </span>
          <span className="col-start-5 row-span-2 row-start-1 text-end text-xs whitespace-nowrap text-fg-muted">{phase}</span>
          {/* A row in a list says it leads on; the phone's form stands as a card of its own and says nothing. */}
          <span className="col-start-6 row-span-2 row-start-1 flex self-stretch">
            <RowEnd />
          </span>
        </span>
        <span className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[1rem_1.5rem_1.5rem] items-center gap-x-3 gap-y-1 px-4 py-3 text-base @2xl:hidden">
          <span className="truncate font-numeric text-xs text-fg-muted">{when}</span>
          <span className="text-end text-xs text-fg-muted">{shootOut}</span>
          <span className="flex min-w-0 items-center gap-2">
            <Side
              side={team1}
              score={score}
              part="team1"
            />
          </span>
          <span className="min-w-7 text-end">
            <Goals
              score={score}
              part="team1"
            />
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <Side
              side={team2}
              score={score}
              part="team2"
            />
            <RowChip chip={chip} />
          </span>
          <span className="min-w-7 text-end">
            <Goals
              score={score}
              part="team2"
            />
          </span>
        </span>
      </Link>
    </div>
  );
}

/**
 * Matches one under another in one box with the card corners and the hairline, the rows parted by lines:
 * a matchday's matches, the matches a read page lists, or the landing's last and next in its season card.
 * The box's own width picks the rows' form, not the screen's: from 42 rem (`@container` on the box, Tailwind's
 * `@2xl`) the one-line row, which a rail page's content holds at the rail's 1024-px breakpoint, 704 px wide,
 * and below it the two-line card a phone shows and the landing's narrower card holds on any screen.
 *
 * `cards` sets each match in a box of its own instead, one under another on a phone and two a row from `lg`, as
 * the Spielplan shows a matchday: each box its own container, so a phone's box and every box of a pair takes
 * the two-line card, and only a lone box wider than 42 rem below `lg`, a tablet's, the one-line row.
 *
 * `bare` sets the rows without the box's own surface, inside a card's body, whose box already holds them, as a
 * table's `bare` does: the season card's matches.
 */
export function SpielList({
  matches,
  layout = "rows",
  bare = false,
}: { matches: ReadonlyArray<SpielRowProps & { id: string }> } & ({ layout?: "rows"; bare?: boolean } | { layout: "cards"; bare?: never })) {
  if (layout === "cards") {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {matches.map(({ id, ...spiel }) => (
          <div
            key={id}
            className={cardSurface({ class: "@container overflow-hidden" })}>
            <SpielRow {...spiel} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={bare ? "@container" : cardSurface({ class: "@container overflow-hidden" })}>
      {matches.map(({ id, ...spiel }) => (
        <SpielRow
          key={id}
          {...spiel}
        />
      ))}
    </div>
  );
}
