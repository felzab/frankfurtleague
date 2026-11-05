import { useId } from "react";

import { smallCaps } from "./cardStyles";
import { Link } from "./Link";
import { PlaceholderLine } from "./Skeleton";
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

/** A section while the landing is read: its eyebrow's and its title's lines over its block's placeholder. */
export function LandingSectionPlaceholder({ children }: { children: ReactNode }) {
  const slots = section();
  return (
    <div className={slots.root()}>
      <div className={slots.head({ class: "w-full" })}>
        <PlaceholderLine
          text={slots.eyebrow()}
          width="w-24"
        />
        <PlaceholderLine
          text={slots.title()}
          width="w-64 max-w-full"
        />
      </div>
      {children}
    </div>
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
