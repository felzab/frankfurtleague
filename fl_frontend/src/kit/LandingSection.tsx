import { useId } from "react";

import { smallCaps } from "./cardStyles";
import { classicTitle } from "./ClassicPage";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

const section = tv({
  slots: {
    root: "grid min-w-0 gap-6",
    head: "grid max-w-measure justify-items-start gap-2",
    eyebrow: smallCaps(),
    // A classic page's title at a card's rung, one step under the page's.
    title: classicTitle({ place: "card" }),
  },
});

/**
 * One of the landing's sections, the page's second heading step: its eyebrow, its title, a link on to the page
 * that tells more, and its block. No intro: a section's title is its explanation.
 */
export function LandingSection({
  eyebrow,
  title,
  more,
  anchor,
  children,
}: {
  eyebrow?: Copy;
  title: Copy;
  /** The page that tells more, such as „Über die Liga“ under the organisers. */
  more?: { label: Copy; href: Route };
  /** The address's fragment that reaches the section, so a shared address naming it still opens there. */
  anchor?: string;
  children: ReactNode;
}) {
  const id = useId();
  const slots = section();
  return (
    <section
      id={anchor}
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
