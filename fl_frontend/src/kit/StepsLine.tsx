import { formatNumber } from "@/core/format";

import { checkpoint } from "./Timeline";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/** One stage of the line: when it falls, where the page knows it, its title and its one paragraph. */
type LineStep = { when?: Copy; title: Copy; text: Copy };

const line = tv({
  extend: checkpoint,
  slots: {
    // Laid along the line across four columns from `lg`; one under another below it, where four do not fit.
    list: "grid lg:grid-cols-4 lg:gap-4",
    // Each stage is the line's stretch from its point to the next, so the last stage draws none: down the left
    // on a phone, along the top from `lg`, through the point's middle either way.
    line: "relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-4 pb-6 before:top-6 before:bottom-0 before:left-[calc(0.75rem-1px)] last:pb-0 last:before:hidden lg:grid-cols-1 lg:pt-8 lg:pb-0 lg:before:top-[calc(0.75rem-1px)] lg:before:right-[-1rem] lg:before:bottom-auto lg:before:left-8 lg:before:border-t-2 lg:before:border-l-0",
    point: "lg:absolute lg:top-0 lg:left-0",
    body: "grid gap-1",
    when: "text-xs font-medium tracking-caps text-fg-muted uppercase",
    title: "text-base font-semibold",
    text: "text-sm text-fg-muted",
  },
});

/** How a season runs: its stages as numbered points on one dotted line, across the page from `lg`, down it below. */
export function StepsLine({ items }: { items: readonly LineStep[] }) {
  const slots = line();
  return (
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
          <div className={slots.body()}>
            {item.when !== undefined && <p className={slots.when()}>{item.when}</p>}
            <h3 className={slots.title()}>{item.title}</h3>
            <p className={slots.text()}>{item.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
