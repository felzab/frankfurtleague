import { COPY, textOf } from "@/core/copy";
import { ERGEBNIS_SEPARATOR } from "@/core/format";

import { cardSurface, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
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
  /**
   * The match's own page, which opens as the pop-up over the list; absent where the match has no page to open yet, such
   * as one of a season not yet public, whose row then opens nothing, as the kit's other rows do that lead nowhere.
   */
  href?: Route;
  /** When it is played, as the catalogue words it. */
  when: Copy;
  team1: SpielSide;
  team2: SpielSide;
  /** Absent until a result is entered, so an unplayed match never reads 0:0. */
  result?: { tore: Pair; elfmeterschiessen?: Pair };
  /** The row's one chip, such as „Vorläufig“ on a match whose date is not confirmed. */
  chip?: ChipProps;
  /** Something befell the match: its sides' names and plaques muted, the chip alone in its hue. */
  muted?: boolean;
  /** The side that did not turn up, its name struck, which is how a row says which; the chip does not repeat it. */
  absent?: "team1" | "team2";
  /** `false` in a list of many, whose cards in view would each cost a request (`Link`). */
  prefetch?: false;
};

/**
 * The one-line row's columns, named once as `--spiel-columns` on what holds them and read by every grid taking them
 * there, a pair's box from `lg` among them. The when column holds the date with the chip beside it, „Sa., 21.11.2026 ·
 * 16:00 [Antwort fehlt]“, as the owner ruled for every list's match row on a wide screen: at least a date's width, and
 * as wide as the widest date and chip of the list, the sides taking what is left. The score's 6 rem is its column's
 * most, which a wide box always leaves it, so a narrow box, whose rows stand as cards across the columns, holds the
 * date's least width alone.
 */
export const SPIEL_COLUMNS_CLASSES = "[--spiel-columns:minmax(min(9.5rem,100%),max-content)_minmax(0,1fr)_minmax(0,6rem)_minmax(0,1fr)_auto]";

/**
 * The holder of a list's match columns, every row taking them as a subgrid, as a table's rows take its columns: so the
 * score and the sides stand at one x down the whole list, however many boxes it sets them in. The box of a list's rows
 * holds them, or the list of boxes a page's groups of matches stand in.
 */
export const spielColumns = tv({ base: `${SPIEL_COLUMNS_CLASSES} grid grid-cols-(--spiel-columns) gap-x-3` });

/**
 * Boxes of matches one under another on a phone and a tablet and two a row from `lg`, as the Spielplan sets a
 * matchday's. Below `lg` the list holds the columns and is the container picking the rows' form, so a tablet's wide
 * boxes stand their scores at one x down the page, each box handing the columns on; a container is never a subgrid,
 * which drops the columns. From `lg` each box of a pair is its own container holding its own columns, so its width
 * alone picks its row's form, the two-line card at a pair's width.
 */
export const spielPairs = tv({
  slots: {
    list: `${SPIEL_COLUMNS_CLASSES} @container grid gap-3 max-lg:grid-cols-(--spiel-columns) lg:grid-cols-2`,
    box: cardSurface({
      class: "grid overflow-hidden max-lg:col-span-full max-lg:grid-cols-subgrid lg:@container lg:grid-cols-(--spiel-columns) lg:gap-x-3",
    }),
  },
});

/** A part standing between the box holding the columns and a row, which hands the columns on to the row. */
export const spielSubgrid = tv({ base: "col-span-full grid grid-cols-subgrid" });

/**
 * The one-line row and the card's lines. A card's date line is a chip's height, chip or none, so every card stands as
 * tall as every other and as its wait, which cannot know whether a list holds a chip; it spans the columns, which it
 * does not use.
 */
const forms = tv({
  slots: {
    line: `${spielSubgrid()} min-h-14 grid-rows-[1.5rem_1rem] content-center items-center gap-x-3 px-4 text-sm @max-2xl:hidden`,
    card: "col-span-full grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[1.25rem_1.5rem_1.5rem] items-center gap-x-3 gap-y-1 px-4 py-3 text-base @2xl:hidden",
  },
});

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
    muted: {
      true: { name: "text-fg-muted" },
    },
    struck: {
      true: { name: "line-through" },
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

/** One side's goals, or the empty mark before a result: a row's, a head's and a bracket card's figure. */
export function goalsOf(score: Figures, part: "team1" | "team2") {
  return score === null ? COPY.shared.noValue : score[part];
}

/** The mark between the two sides' goals, muted with them before a result. */
export function GoalSeparator({ score }: { score: Figures }) {
  return <span className={score === null ? "text-fg-muted" : undefined}>{ERGEBNIS_SEPARATOR}</span>;
}

type SideProps = { side: SpielSide; score: Figures; part: "team1" | "team2"; mirrored?: boolean } & Pick<SpielRowProps, "muted" | "absent">;

function Side({ side, score, part, mirrored, muted, absent }: SideProps) {
  const style = row({ ...look(score, part), mirrored: mirrored === true, muted: muted === true, struck: absent === part });
  const name = textOf(side.name);
  const plaque = (
    <TeamPlaque
      plaque={side.plaque}
      muted={muted === true}
    />
  );
  return (
    <span className={style.side()}>
      {mirrored !== true && plaque}
      {/* Cut with „…“ where the side's column is too narrow, the whole name in its `title` while it is cut. */}
      <CutText
        text={name}
        className={style.name()}
      />
      {mirrored === true && plaque}
    </span>
  );
}

function Goals({ score, part }: { score: Figures; part: "team1" | "team2" }) {
  return <span className={row(look(score, part)).goals()}>{goalsOf(score, part)}</span>;
}

/**
 * The one-line row's score: centred in the row's two lines, or, after a shoot-out, on the first with „n. E.“ under
 * it, the pair centred together, so the row keeps one height either way.
 */
const scoreCell = tv({
  base: "col-start-3 row-start-1 text-center text-base",
  variants: { shootOut: { true: "", false: "row-span-2" } },
});

/**
 * When the match is played: on the one-line row's line with its chip beside it, and cut with „…“ on the card's one
 * date line.
 */
const whenWords = tv({ base: "min-w-0 font-numeric text-fg-muted", variants: { cut: { true: "max-w-full truncate" } } });

/**
 * A match in a list, the whole row a link to it, or opening nothing where it has no `href`. In a wide list one line, 56 px: when with the row's chip beside
 * it, the first side, the score with „n. E.“ centred under it, the second side, the chevron. In a
 * narrow one a card of two lines under the date line, whose right end holds the chip and „n. E.“, each side with
 * its goals at the right, and no chevron; every row the same height with or without a shoot-out or a chip.
 */
function SpielRow({ href, when, team1, team2, result, chip, muted, absent, prefetch }: SpielRowProps) {
  const score = figures(result);
  const shootOut = score?.shootOut === true ? COPY.shared.afterElfmeterschiessen : null;
  const form = forms();
  const event = { muted, absent };

  const body = (
    <>
      <span className={form.line()}>
        <span className="col-start-1 row-span-2 row-start-1 flex items-center gap-2 whitespace-nowrap">
          <span className={whenWords()}>{when}</span>
          {chip !== undefined && <Chip {...chip} />}
        </span>
        <span className="col-start-2 row-span-2 row-start-1">
          <Side
            side={team1}
            score={score}
            part="team1"
            mirrored
            {...event}
          />
        </span>
        <span className={scoreCell({ shootOut: shootOut !== null })}>
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
        {shootOut !== null && <span className="col-start-3 row-start-2 text-center text-xs text-fg-muted">{shootOut}</span>}
        <span className="col-start-4 row-span-2 row-start-1 flex min-w-0 items-center gap-2">
          <Side
            side={team2}
            score={score}
            part="team2"
            {...event}
          />
        </span>
        {/* A row in a list says it leads on; the phone's form stands as a card of its own and says nothing. */}
        {href !== undefined && (
          <span className="col-start-5 row-span-2 row-start-1 flex self-stretch">
            <RowEnd />
          </span>
        )}
      </span>
      <span className={form.card()}>
        <span className={whenWords({ cut: true, class: "text-xs" })}>{when}</span>
        {/* „n. E.“ last, so it stays over the goals it qualifies. */}
        <span className="flex items-center justify-end gap-2 text-xs text-fg-muted">
          {chip !== undefined && <Chip {...chip} />}
          {shootOut}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <Side
            side={team1}
            score={score}
            part="team1"
            {...event}
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
            {...event}
          />
        </span>
        <span className="min-w-7 text-end">
          <Goals
            score={score}
            part="team2"
          />
        </span>
      </span>
    </>
  );

  return (
    <div className={spielSubgrid({ class: stacked() })}>
      {href === undefined ? (
        // The same row in a box that leads nowhere: no hover, no focus, no chevron.
        <div className={spielSubgrid({ class: "text-fg" })}>{body}</div>
      ) : (
        <Link
          href={href}
          placement="card"
          subgrid
          prefetch={prefetch}>
          {body}
        </Link>
      )}
    </div>
  );
}

/** A side while its match is read: the plaque and the name's line as bars, mirrored as the one-line row mirrors the first. */
function SidePlaceholder({ mirrored = false }: { mirrored?: boolean }) {
  const plaque = <span className={placeholderBar("h-6 w-10")} />;
  return (
    <span className={row({ mirrored }).side()}>
      {!mirrored && plaque}
      <PlaceholderLine
        textClass="text-sm"
        widthClass="w-24"
      />
      {mirrored && plaque}
    </span>
  );
}

/**
 * A match row while its match is read, in both of `SpielRow`'s forms on the row's own grid, which the box's width
 * picks between as it picks the row's: the one line, when, the sides about the score and the chevron; or the card,
 * the date line over each side with its goals at the right.
 */
function SpielRowPlaceholder({ layout, linked }: { layout: "rows" | "cards"; linked: boolean }) {
  const form = forms();
  return (
    <div className={spielSubgrid({ class: layout === "rows" ? stacked() : "" })}>
      <span className={form.line()}>
        <span className="col-start-1 row-span-2 row-start-1">
          <span className={placeholderBar("h-3 w-24")} />
        </span>
        <span className="col-start-2 row-span-2 row-start-1">
          <SidePlaceholder mirrored />
        </span>
        <span className={scoreCell({ shootOut: false, class: "flex justify-center" })}>
          <span className={placeholderBar("h-4 w-10")} />
        </span>
        <span className="col-start-4 row-span-2 row-start-1">
          <SidePlaceholder />
        </span>
        {linked && (
          <span className="col-start-5 row-span-2 row-start-1 flex self-stretch">
            <RowEnd />
          </span>
        )}
      </span>
      <span className={form.card()}>
        <span className={placeholderBar("h-3 w-32")} />
        <span />
        <SidePlaceholder />
        <span className={placeholderBar("ms-auto h-4 w-3")} />
        <SidePlaceholder />
        <span className={placeholderBar("ms-auto h-4 w-3")} />
      </span>
    </div>
  );
}

/**
 * The box of a list's rows: the card's surface, or none where it stands `bare` inside a card's body; the holder of the
 * rows' columns and the container whose width picks their form, or, `outer`, a part handing on the columns of the list
 * of groups it stands in (`SpielGroup`), which is the container instead. A part handing columns on is never a container:
 * a container establishes an independent formatting context, and a grid that does is no subgrid and drops the columns.
 */
function rowsBox(bare: boolean, columns: "own" | "outer") {
  const grid = columns === "own" ? `@container ${spielColumns()}` : spielSubgrid();
  return bare ? grid : cardSurface({ class: `overflow-hidden ${grid}` });
}

/**
 * Matches while they are read, in the box or the boxes `SpielList` sets them in: `count` rows one under another, or
 * cards two a row from `lg` where `layout` is `cards`, each row in the row's own forms; `bare` inside a card's body,
 * `columns` as the list's. `linked` is `false` for rows that will open nothing, which end in no chevron.
 */
export function SpielListPlaceholder({
  count,
  layout = "rows",
  bare = false,
  columns = "own",
  linked = true,
}: {
  count: number;
  layout?: "rows" | "cards";
  bare?: boolean;
  columns?: "own" | "outer";
  linked?: boolean;
}) {
  const rows = Array.from({ length: count }, (_, index) => index);
  if (layout === "cards") {
    const pairs = spielPairs();
    return (
      <div className={pairs.list()}>
        {rows.map((index) => (
          <div
            key={index}
            className={pairs.box()}>
            <SpielRowPlaceholder
              layout="cards"
              linked={linked}
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={rowsBox(bare, columns)}>
      {rows.map((index) => (
        <SpielRowPlaceholder
          key={index}
          layout="rows"
          linked={linked}
        />
      ))}
    </div>
  );
}

/**
 * Matches one under another in one box with the card corners and the hairline, the rows parted by lines:
 * a matchday's matches, the matches a read page lists, or the landing's last and next in its season card.
 * The box's own width picks the rows' form, not the screen's: from 42 rem (`@container` on the box, or on the list of
 * groups holding its columns, Tailwind's `@2xl`) the one-line row, which a rail page's content holds at the rail's 1024-px breakpoint, 704 px wide,
 * and below it the two-line card a phone shows and the landing's narrower card holds on any screen.
 *
 * `cards` sets each match in a box of its own instead, one under another on a phone and two a row from `lg`, as
 * the Spielplan shows a matchday (`spielPairs`): a phone's box and every box of a pair takes the two-line card, and
 * only a box wider than 42 rem below `lg`, a tablet's, the one-line row, on the list's columns.
 *
 * `bare` sets the rows without the box's own surface, inside a card's body, whose box already holds them, as a
 * table's `bare` does: the season card's matches. The box holds the rows' columns (`spielColumns`), so every row of
 * the list stands its score and sides at one x; `columns: "outer"` takes them from the list of groups the box stands
 * in instead, so the rows of every group line up (`SpielGroup`).
 */
export function SpielList({
  matches,
  layout = "rows",
  bare = false,
  columns = "own",
}: { matches: ReadonlyArray<SpielRowProps & { id: string }> } & (
  { layout?: "rows"; bare?: boolean; columns?: "own" | "outer" } | { layout: "cards"; bare?: never; columns?: never }
)) {
  if (layout === "cards") {
    const pairs = spielPairs();
    return (
      <div className={pairs.list()}>
        {matches.map(({ id, ...spiel }) => (
          <div
            key={id}
            className={pairs.box()}>
            <SpielRow {...spiel} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={rowsBox(bare, columns)}>
      {matches.map(({ id, ...spiel }) => (
        <SpielRow
          key={id}
          {...spiel}
        />
      ))}
    </div>
  );
}
