import { useId } from "react";

import { smallCaps } from "./cardStyles";
import { Link } from "./Link";
import { PageWait } from "./PageFade";
import { Placeholder, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

const section = tv({
  slots: {
    root: "grid min-w-0 gap-6",
    head: "grid max-w-measure justify-items-start gap-2",
    // The eyebrow over a section's title, in the kit's small capitals.
    eyebrow: smallCaps(),
    title: "font-heading text-2xl tracking-display uppercase",
  },
});

/**
 * A section while the read decides it: its eyebrow's and its title's lines, the line of its link on where it has one,
 * over its block's placeholder.
 */
export function LandingSectionPlaceholder({ more, children }: { more?: Copy; children: ReactNode }) {
  const slots = section();
  return (
    <Placeholder layout={slots.root()}>
      <div className={slots.head({ class: "w-full" })}>
        <PlaceholderLine
          text={slots.eyebrow()}
          width="w-24"
        />
        <PlaceholderLine
          text={slots.title()}
          width="w-64 max-w-full"
        />
        {more !== undefined && (
          <PlaceholderLine
            text="text-base"
            words={more}
          />
        )}
      </div>
      {children}
    </Placeholder>
  );
}

/** A section once the read has landed: the block the page built from it, or nothing where the read leaves it out. */
async function Decided({ block }: { block: Promise<ReactNode> }) {
  return await block;
}

/**
 * A section the read decides, standing as `fallback` until then in a boundary of its own: its placeholder, or the block
 * itself in the state the page can state before the read.
 */
export function LandingSectionWait({ block, fallback }: { block: Promise<ReactNode>; fallback: ReactNode }) {
  return (
    <PageWait fallback={fallback}>
      <Decided block={block} />
    </PageWait>
  );
}

/**
 * One of the landing's sections, the page's second heading step: its eyebrow, its title in Anton at 24 px, a
 * link on to the page that tells more, and its block. No intro: a section's title is its explanation.
 */
export function LandingSection({
  eyebrow,
  title,
  more,
  children,
}: {
  eyebrow?: Copy;
  title: Copy;
  /** The page that tells more, such as „Über die Liga“ under the organisers. */
  more?: { label: Copy; href: Route };
  children: ReactNode;
}) {
  const id = useId();
  const slots = section();
  return (
    <section
      aria-labelledby={id}
      className={slots.root()}>
      <div className={slots.head()}>
        {eyebrow !== undefined && <p className={slots.eyebrow()}>{eyebrow}</p>}
        <h2
          id={id}
          className={slots.title()}>
          {title}
        </h2>
        {more !== undefined && (
          <Link
            href={more.href}
            placement="standalone"
            label={more.label}
          />
        )}
      </div>
      {children}
    </section>
  );
}
