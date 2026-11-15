import { textOf } from "@/core/copy";

import { CardMark } from "./CardMark";
import { SPIEL_COLUMNS_CLASSES, SpielList } from "./SpielRow";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ComponentProps, ReactNode } from "react";
import type { SpielRowProps } from "./SpielRow";

/**
 * One checkpoint: what its point holds (a club's running count of its matches, a minute), its title and detail
 * beside the point, and what stands under them, such as a match card. A minute is read with the title, since it
 * says when a goal fell and nothing else does; a count is not, the ordered list telling a screen reader each
 * checkpoint's place already, so „1“ is never read out before „1. Spieltag“.
 */
export type Checkpoint = {
  id: string;
  point: Words;
  /** The point counts the checkpoints, as a club's matches are numbered, rather than saying something of its own. */
  counts?: true;
  /** A card's colour, the small card directly before the title, whose words name the colour. */
  mark?: ComponentProps<typeof CardMark>;
  title: Copy;
  detail?: Words;
  children?: ReactNode;
  /** A club's match, its row under the title: every checkpoint's row stands on the line's one set of match columns. */
  spiel?: SpielRowProps & { id: string };
  /** A club's match: how it went for the club, which the point wears in the Tabelle's S, U and N colours. */
  outcome?: Outcome;
};

/** How a match went for a club, or `none` while nothing is scored, such as an undecided or called-off match. */
export type Outcome = "won" | "drawn" | "lost" | "none";

/**
 * The point and the line every line of checkpoints draws, the season's stages on the landing among them: a
 * point outlined in the brand green, or in a club's match in its outcome's colour, with its figure inside, and from it a dotted line in the control edge's
 * grey to the next. A figure longer than two characters, a minute of stoppage time, widens the point into a pill.
 * Each block places the line, a `before:` box, by its own geometry.
 */
export const checkpoint = tv({
  slots: {
    point:
      "relative flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-brand bg-bg px-1 font-numeric text-xs font-semibold text-fg",
    line: "before:absolute before:border-l-2 before:border-dotted before:border-border-control",
  },
  variants: {
    // A club's match in the colours its S, U and N carry in the Tabelle (`RecordFigures`), ring and figure alike, so
    // a glance down the points reads the run of results; nothing scored keeps the control edge's grey.
    outcome: {
      won: { point: "border-success text-success" },
      drawn: { point: "border-warn text-warn" },
      lost: { point: "border-danger text-danger" },
      none: { point: "border-border-control text-fg-muted" },
    },
  },
});

const timeline = tv({
  extend: checkpoint,
  slots: {
    // The points' column is as wide as the widest point, so every title of the line stands at one edge.
    list: "grid grid-cols-[auto_minmax(0,1fr)] gap-x-4",
    step: "group/checkpoint col-span-full grid grid-cols-subgrid pb-6 last:pb-0",
    // Down from under the point, through the gap, to the next point; the last checkpoint draws none.
    line: "relative flex items-start justify-center before:top-6 before:-bottom-6 before:left-[calc(50%-1px)] group-last/checkpoint:before:hidden",
    body: "grid min-w-0 gap-2",
    // As tall as the point, its line centred on the point's middle, the title's and the detail's words on one baseline.
    head: "flex min-h-6 flex-wrap content-center items-baseline gap-x-2",
    title: "text-sm font-semibold",
    // A card's mark centred on the title's line. The words alone align on baselines, so the title's baseline is
    // theirs rather than the mark's bottom edge, and the detail beside it stays on the words' line.
    marked: "flex items-center gap-1.5",
    words: "min-w-0 self-baseline",
    detail: "font-numeric text-xs text-fg-muted",
  },
  variants: {
    // A club's matches: the line holds the match columns beside the points' and hands them through each checkpoint to
    // its match's box, so every score and side stands at one x down the line (`spielColumns`). The line is the
    // container picking the rows' form, since a part handing columns on is never one: its width counts the points'
    // column and its gap, so a match's box takes the one-line row from 39.5 rem rather than 42. The list's gap is the
    // rows' own, which a subgrid's cells stretch into where the two differ, and the points' column keeps the line's
    // 16 px to its titles by its own end margin.
    matches: {
      true: {
        list: `${SPIEL_COLUMNS_CLASSES} @container grid-cols-[auto_var(--spiel-columns)] gap-x-3`,
        line: "me-1",
        body: "col-[2/-1] grid-cols-subgrid gap-x-3 *:col-span-full",
      },
    },
  },
});

/**
 * Things in their order along one dotted line, a checkpoint for each: a club's matches by matchday, a match's
 * goals and cards by minute. Each checkpoint names itself beside its point and holds its content under that.
 */
export function Timeline({ label, items }: { label: Copy; items: readonly Checkpoint[] }) {
  const slots = timeline({ matches: items.some((item) => item.spiel !== undefined) });
  return (
    <ol
      aria-label={label}
      className={slots.list()}>
      {items.map((item) => (
        <li
          key={item.id}
          className={slots.step()}>
          <div className={slots.line()}>
            <span
              aria-hidden={item.counts}
              className={slots.point({ outcome: item.outcome })}>
              {textOf(item.point)}
            </span>
          </div>
          <div className={slots.body()}>
            <div className={slots.head()}>
              <span className={slots.marked({ class: slots.title() })}>
                {item.mark !== undefined && <CardMark {...item.mark} />}
                <span className={slots.words()}>{item.title}</span>
              </span>
              {item.detail !== undefined && <span className={slots.detail()}>{textOf(item.detail)}</span>}
            </div>
            {item.children}
            {item.spiel !== undefined && (
              <SpielList
                matches={[item.spiel]}
                columns="outer"
              />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
