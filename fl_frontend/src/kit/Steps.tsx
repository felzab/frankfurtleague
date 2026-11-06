import { COPY } from "@/core/copy";
import { formatNumber } from "@/core/format";

import { buttonPlaceholder } from "./buttonStyles";
import { cardSurface, stacked } from "./cardStyles";
import { Link } from "./Link";
import { PageWait } from "./PageFade";
import { Placeholder, PlaceholderSentence } from "./Skeleton";
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
    // Four columns from `lg`, parted by hairlines; one under another below it, the number beside each. From `lg` the
    // steps share three rows, the numbers', the titles' and the texts', each step a subgrid of them, as the stat
    // tiles share theirs, so a title running to two lines moves every step's text down alike.
    list: "grid lg:grid-cols-4 lg:grid-rows-[auto_auto_1fr] lg:gap-4",
    step: `grid grid-cols-[2.5rem_minmax(0,1fr)] content-start gap-x-4 gap-y-2 ${stacked()} py-4 lg:row-span-3 lg:grid-cols-1 lg:grid-rows-subgrid lg:border-t-0 lg:border-l lg:px-6 lg:py-0 lg:first:border-l-0 lg:first:pl-0`,
    // Board: the number's box, 40 px in the band's green.
    number:
      "row-span-2 flex size-10 items-center justify-center rounded-lg bg-brand-solid font-numeric text-base font-semibold text-on-brand lg:row-span-1",
    // Beside the number on a phone, centred on it; from `lg` at the top of the titles' row, under the number.
    title: "self-center text-base font-semibold lg:self-start",
    text: "col-start-2 text-sm text-fg-muted lg:col-start-1",
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

/**
 * The band while the read says whether a window is open: `sentence` is the words of the state most days are in, so
 * the box is that sentence's height at every width.
 */
function BandPlaceholder({ sentence }: { sentence: Copy }) {
  const slots = steps();
  return (
    <Placeholder layout={slots.band()}>
      <PlaceholderSentence
        text={slots.sentence()}
        words={sentence}
      />
      <span className={buttonPlaceholder()}>{COPY.page.about}</span>
    </Placeholder>
  );
}

/** How a school joins: the numbered steps, which stand at once, then the band with the application window's state. */
export function Steps({ items, band, closed }: { items: readonly Step[]; band: Promise<StepsBand>; closed: Copy }) {
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
      <PageWait fallback={<BandPlaceholder sentence={closed} />}>
        <Band band={band} />
      </PageWait>
    </>
  );
}
