import { formatNumber } from "@/core/format";

import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

/** One step: its title and its one paragraph; its number is its place in the list. */
type Step = { title: Copy; text: Copy };

/**
 * The band under the steps: while a window is open, its deadline and the way to apply, the page's primary
 * act; while none is, the word that none is and the way to the league's own page, a secondary one.
 */
type StepsBand = { open: boolean; sentence: Copy; act: { label: Copy; href: Route } };

const steps = tv({
  slots: {
    // Four columns from `lg`, parted by hairlines; one under another below it, the number beside each.
    list: "grid lg:grid-cols-4 lg:gap-4",
    step: "grid grid-cols-[2.5rem_minmax(0,1fr)] content-start gap-x-4 gap-y-2 border-t border-border py-4 first:border-t-0 lg:grid-cols-1 lg:border-t-0 lg:border-l lg:px-6 lg:py-0 lg:first:border-l-0 lg:first:pl-0",
    // Board: the number's box, 40 px in the band's green.
    number:
      "row-span-2 flex size-10 items-center justify-center rounded-lg bg-brand-solid font-numeric text-base font-semibold text-on-brand lg:row-span-1",
    title: "self-center text-base font-semibold",
    text: "col-start-2 text-sm text-fg-muted lg:col-start-1",
    band: "flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-bg px-6 py-4",
    sentence: "text-base",
  },
});

/** How a school joins: the numbered steps, then the band with the application window's state. */
export function Steps({ items, band }: { items: readonly Step[]; band: StepsBand }) {
  const slots = steps();
  return (
    <>
      <ol className={slots.list()}>
        {items.map((item, index) => (
          <li
            key={item.title}
            className={slots.step()}>
            <span
              aria-hidden
              className={slots.number()}>
              {formatNumber(index + 1)}
            </span>
            <h3 className={slots.title()}>{item.title}</h3>
            <p className={slots.text()}>{item.text}</p>
          </li>
        ))}
      </ol>
      <div className={slots.band()}>
        <p className={slots.sentence()}>{band.sentence}</p>
        <Link
          href={band.act.href}
          placement="button"
          look={band.open ? "primary" : "secondary"}
          label={band.act.label}
        />
      </div>
    </>
  );
}
