import { useId } from "react";

import { smallCaps } from "./cardStyles";
import { Link } from "./Link";
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
