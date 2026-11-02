import { Suspense } from "react";

import { ClassicPage } from "./ClassicPage";
import { Link } from "./Link";
import { Skeleton } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

/** One of the hero's two ways on: a label and its address. */
type HeroAct = { label: Copy; href: Route };

/** What the landing reads: the hero's second way on, the season's card beside the hero, and the sections. */
export type LandingContent = {
  /** Applying while a window is open, the league's own page while none is. */
  secondary: HeroAct;
  /** The season's card, `SaisonBlock`. */
  aside: ReactNode;
  /** The sections, each a landing block. */
  sections: ReactNode;
};

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

/** The hero's second way on, once the read says which. */
async function Secondary({ content }: { content: Promise<LandingContent> }) {
  const { secondary } = await content;
  return (
    <Link
      href={secondary.href}
      placement="button"
      look="secondary"
      label={secondary.label}
    />
  );
}

async function Aside({ content }: { content: Promise<LandingContent> }) {
  return (await content).aside;
}

async function Sections({ content }: { content: Promise<LandingContent> }) {
  return (await content).sections;
}

/**
 * The landing's template, in the classic frame's landing column: the split hero, which writes the page's one
 * `h1`, its tagline, over the lead and its two ways on, the season's card beside it; then the page's sections,
 * each one of the landing's blocks.
 *
 * Everything but the tagline, the lead and the first way on is read, so the template waits for it here: the
 * hero's words and the Spielplan's way stand at once, the second way on holds no width until it lands, the
 * season's card stands as the skeleton of its box, and the sections follow the read. The three parts read one
 * promise, so they land together.
 */
export function LandingPage({
  title,
  lead,
  primary,
  content,
}: {
  /** The tagline, the page's one heading. */
  title: Copy;
  lead: Copy;
  /** The first way on, the Spielplan in every state. */
  primary: HeroAct;
  content: Promise<LandingContent>;
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
            <Suspense fallback={null}>
              <Secondary content={content} />
            </Suspense>
          </div>
        </div>
        {/* Board: the season card's wait, the skeleton of a box of facts until the owner rules its shape. */}
        <Suspense fallback={<Skeleton shape="facts" />}>
          <Aside content={content} />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <Sections content={content} />
      </Suspense>
    </ClassicPage>
  );
}
