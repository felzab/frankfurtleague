import { ClassicPage } from "./ClassicPage";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

/** One of the hero's two ways on: a label and its address. */
type HeroAct = { label: Copy; href: Route };

const hero = tv({
  slots: {
    // Split from `lg`: the words at the left, the season card at the right, 48 px between; one column below.
    // Board: the side card's width, 25 rem.
    root: "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12",
    words: "grid content-start gap-6",
    title: "font-heading text-3xl tracking-display uppercase",
    lead: "text-base text-fg-muted",
    acts: "flex flex-wrap gap-3",
  },
});

/**
 * The landing's template, in the classic frame's landing column: the split hero, which writes the page's one
 * `h1`, its tagline, over the lead and its two ways on, the season's card beside it; then the page's sections,
 * each one of the landing's blocks.
 */
export function LandingPage({
  title,
  lead,
  primary,
  secondary,
  aside,
  children,
}: {
  /** The tagline, the page's one heading. */
  title: Copy;
  lead: Copy;
  /** The first way on, the Spielplan in every state. */
  primary: HeroAct;
  /** The second: applying while a window is open, the league's own page while none is. */
  secondary: HeroAct;
  /** The season's card, `SaisonBlock`. */
  aside: ReactNode;
  /** The sections, each a landing block. */
  children: ReactNode;
}) {
  const slots = hero();
  return (
    <ClassicPage width="landing">
      <div className={slots.root()}>
        <div className={slots.words()}>
          <h1 className={slots.title()}>{title}</h1>
          <p className={slots.lead()}>{lead}</p>
          <div className={slots.acts()}>
            <Link
              href={primary.href}
              placement="button"
              look="primary"
              label={primary.label}
            />
            <Link
              href={secondary.href}
              placement="button"
              look="secondary"
              label={secondary.label}
            />
          </div>
        </div>
        {aside}
      </div>
      {children}
    </ClassicPage>
  );
}
