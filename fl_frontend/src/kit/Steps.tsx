import { formatNumber } from "@/core/format";

import { BlockBox } from "./BlockBox";
import { cardSurface, stacked } from "./cardStyles";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

/** One step: its title and its one paragraph; its number is its place in the list. */
type Step = { title: Copy; text: Copy };

/**
 * The band under the steps: while a window is open, its deadline and the way to apply, the page's primary
 * act; while none is, the day the next opens or the word that none is, and the way to the league's own page, a
 * secondary one.
 */
type StepsBand = { open: boolean; sentence: Copy; act: { label: Copy; href: Route } };

const steps = tv({
  slots: {
    // Four columns from 42 rem of the list's own width, parted by hairlines; one under another below it, the number
    // beside each. Across, the steps share three rows, the numbers', the titles' and the texts', each step a subgrid of them, as the stat
    // tiles share theirs, so a title running to two lines moves every step's text down alike.
    list: "grid @2xl:grid-cols-4 @2xl:grid-rows-[auto_auto_1fr] @2xl:gap-4",
    step: `grid grid-cols-[2.5rem_minmax(0,1fr)] content-start gap-x-4 gap-y-2 ${stacked()} py-4 @2xl:row-span-3 @2xl:grid-cols-1 @2xl:grid-rows-subgrid @2xl:border-t-0 @2xl:border-l @2xl:px-6 @2xl:py-0 @2xl:first:border-l-0 @2xl:first:pl-0`,
    // The number's box, 40 px in the band's green.
    number:
      "row-span-2 flex size-10 items-center justify-center rounded-lg bg-brand-solid font-numeric text-base font-semibold text-on-brand @2xl:row-span-1",
    // Beside the number down the list, centred on it; across, at the top of the titles' row, under the number.
    title: "self-center text-base font-semibold @2xl:self-start",
    text: "col-start-2 text-sm text-fg-muted @2xl:col-start-1",
    band: `flex flex-wrap items-center justify-between gap-4 ${cardSurface()} px-6 py-4`,
    sentence: "text-base",
  },
});

/** The band once the read has landed. */
async function Band({ band }: { band: Promise<StepsBand> }) {
  const slots = steps();
  const { open, sentence, act } = await band;
  return (
    <div className={slots.band()}>
      <p className={slots.sentence()}>{sentence}</p>
      <Link
        href={act.href}
        placement="button"
        look={open ? "primary" : "secondary"}
        label={act.label}
      />
    </div>
  );
}

/** How a school joins: the numbered steps, then the band with the application window's state. */
export function Steps({ items, band }: { items: readonly Step[]; band: Promise<StepsBand> }) {
  const slots = steps();
  return (
    <>
      <BlockBox>
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
      </BlockBox>
      <Band band={band} />
    </>
  );
}
