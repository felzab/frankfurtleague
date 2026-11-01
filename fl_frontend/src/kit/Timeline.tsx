import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * One checkpoint: its mark inside the point (a matchday's number, a minute), its title and detail beside the
 * point, and what stands under them, such as a match card. The mark is read with the title, since a minute
 * says when a goal fell and nothing else does.
 */
export type Checkpoint = { id: string; mark: string; title: string; detail?: string; children?: ReactNode };

/**
 * The point and the line every line of checkpoints draws, the season's stages on the landing among them: a
 * point outlined in the brand green with its mark inside, and from it a dotted line in the control edge's
 * grey to the next. A mark longer than two figures, a minute of stoppage time, widens the point into a pill.
 * Each block places the line, a `before:` box, by its own geometry.
 * @awaitsPage session 3's landing, whose `StepsLine` reads it
 */
export const checkpoint = tv({
  slots: {
    point:
      "relative flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-brand bg-bg px-1 font-numeric text-xs font-semibold text-fg",
    line: "before:absolute before:border-l-2 before:border-dotted before:border-border-control",
  },
});

const timeline = tv({
  extend: checkpoint,
  slots: {
    // The marks' column is as wide as the widest mark, so every title of the line stands at one edge.
    list: "grid grid-cols-[auto_minmax(0,1fr)] gap-x-4",
    step: "group/checkpoint col-span-2 grid grid-cols-subgrid pb-6 last:pb-0",
    // Down from under the point, through the gap, to the next point; the last checkpoint draws none.
    line: "relative flex items-start justify-center before:top-6 before:-bottom-6 before:left-[calc(50%-1px)] group-last/checkpoint:before:hidden",
    body: "grid min-w-0 gap-2",
    head: "flex min-h-6 flex-wrap items-baseline gap-x-2",
    title: "text-sm font-semibold",
    detail: "font-numeric text-xs text-fg-muted",
  },
});

/**
 * Things in their order along one dotted line, a checkpoint for each: a club's matches by matchday, a match's
 * goals and cards by minute. Each checkpoint names itself beside its point and holds its content under that.
 */
export function Timeline({ label, items }: { label: Copy; items: readonly Checkpoint[] }) {
  const slots = timeline();
  return (
    <ol
      aria-label={label}
      className={slots.list()}>
      {items.map((item) => (
        <li
          key={item.id}
          className={slots.step()}>
          <div className={slots.line()}>
            <span className={slots.point()}>{item.mark}</span>
          </div>
          <div className={slots.body()}>
            <div className={slots.head()}>
              <span className={slots.title()}>{item.title}</span>
              {item.detail !== undefined && <span className={slots.detail()}>{item.detail}</span>}
            </div>
            {item.children}
          </div>
        </li>
      ))}
    </ol>
  );
}
