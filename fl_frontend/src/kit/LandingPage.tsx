import { Suspense } from "react";

import { ClassicPage } from "./ClassicPage";
import { Link } from "./Link";
import { LandingSkeleton } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";

/** One of the hero's two ways on: a label and its address. */
type HeroAct = { label: Copy; href: Route };

/** What the landing reads: the hero's second way on, the season's card beside the hero, and the sections. */
export type LandingContent = {
  /** Applying while a window is open, the league's own page while none is. */
  secondary: HeroAct;
  /** The season's card, `SaisonBlock`. */
  aside: ReactElement;
  /** The sections, each a landing block. */
  sections: ReactNode;
};

const hero = tv({
  slots: {
    // Split from `lg`: the tagline and the words under it at the left, the season card at the right beside both,
    // 48 px between; one column below. Board: the side card's width, 25 rem. The rows part by their items'
    // padding, so the read's parts, which stand in the grid directly, keep the gaps a nested column would.
    root: "grid items-start gap-x-12 lg:grid-cols-[minmax(0,1fr)_25rem]",
    title: "pb-6 font-heading text-3xl tracking-display uppercase lg:col-start-1 lg:row-start-1",
    words: "grid content-start gap-6 pb-8 lg:col-start-1 lg:row-start-2 lg:pb-0",
    lead: "text-base text-fg-muted",
    acts: "flex flex-wrap gap-3",
    aside: "min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1",
    // Board: the gap between the landing's sections, 48 px on a phone and 64 px from `lg`.
    sections: "grid gap-12 pt-12 lg:col-span-2 lg:gap-16 lg:pt-16",
  },
});

/** The three parts under the tagline, each in its place in the hero's grid, read or waited for. */
function Parts({ words, aside, sections }: { words: ReactNode; aside: ReactNode; sections: ReactNode }) {
  const slots = hero();
  return (
    <>
      <div className={slots.words()}>{words}</div>
      <div className={slots.aside()}>{aside}</div>
      <div className={slots.sections()}>{sections}</div>
    </>
  );
}

/** The parts once the read has landed. */
async function Read({ lead, primary, content }: { lead: Copy; primary: HeroAct; content: Promise<LandingContent> }) {
  const { secondary, aside, sections } = await content;
  const slots = hero();
  return (
    <Parts
      words={
        <>
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
        </>
      }
      aside={aside}
      sections={sections}
    />
  );
}

/**
 * The landing's template, in the classic frame's landing column: the split hero, which writes the page's one
 * `h1`, its tagline, over the lead and its two ways on, the season's card beside them; then the page's
 * sections, each one of the landing's blocks.
 *
 * The tagline is the page's title and stands at once, as every template's title stands outside its wait;
 * everything under it waits for the read in the template's one boundary, drawn meanwhile as the skeleton of the
 * first screen, part by part in the place each final block takes, so nothing moves when the read arrives.
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
        <h1 className={slots.title()}>{title}</h1>
        <Suspense
          fallback={
            <Parts
              words={<LandingSkeleton part="words" />}
              aside={<LandingSkeleton part="card" />}
              sections={<LandingSkeleton part="sections" />}
            />
          }>
          <Read
            lead={lead}
            primary={primary}
            content={content}
          />
        </Suspense>
      </div>
    </ClassicPage>
  );
}
