import { formatNumber } from "@/core/format";

import { checkpoint } from "./Timeline";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/** One stage of the line: its title and its one paragraph. */
type LineStep = { title: Copy; text: Copy };

const line = tv({
  extend: checkpoint,
  slots: {
    // Laid along the line across four columns from 42 rem of the list's own width; one under another below it, where
    // four do not fit. Across, the stages share two rows, the titles' and the texts', each stage a subgrid of them, so a title running to
    // two lines moves every stage's text down alike.
    list: "grid @2xl:grid-cols-4 @2xl:grid-rows-[auto_1fr] @2xl:gap-4",
    // Each stage is the line's stretch from its point to the next, so the last stage draws none: down the left
    // down the list, along the top across it, through the point's middle either way.
    line: "relative grid grid-cols-[1.5rem_minmax(0,1fr)] content-start gap-x-4 gap-y-1 pb-6 before:top-6 before:bottom-0 before:left-[calc(0.75rem-1px)] last:pb-0 last:before:hidden @2xl:row-span-2 @2xl:grid-cols-1 @2xl:grid-rows-subgrid @2xl:pt-8 @2xl:pb-0 @2xl:before:top-[calc(0.75rem-1px)] @2xl:before:right-[-1rem] @2xl:before:bottom-auto @2xl:before:left-8 @2xl:before:border-t-2 @2xl:before:border-l-0",
    // Beside the title and its text down the list, in their first line; across, over them, on the line, placed in no
    // row, so it is positioned against the stage's own box rather than a row's area.
    point: "row-span-2 @2xl:absolute @2xl:top-0 @2xl:left-0 @2xl:row-auto",
    title: "text-base font-semibold",
    text: "col-start-2 text-sm text-fg-muted @2xl:col-start-1",
  },
});

/**
 * How a season runs: its stages as numbered points on one dotted line, across the block from 42 rem of its own width,
 * down it below.
 */
export function StepsLine({ items }: { items: readonly LineStep[] }) {
  const slots = line();
  return (
    // The container the stages' columns read, since a query reads an ancestor; `w-full`, since a container's width
    // counts none of its content.
    <div className="@container w-full">
      <ol className={slots.list()}>
        {items.map((item, index) => (
          <li
            key={item.title}
            className={slots.line()}>
            <span
              aria-hidden
              className={slots.point()}>
              {formatNumber(index + 1)}
            </span>
            <h3 className={slots.title()}>{item.title}</h3>
            <p className={slots.text()}>{item.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
