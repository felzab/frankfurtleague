import { COPY } from "@/core/copy";

import { buttonPlaceholder } from "./buttonStyles";
import { ClassicPage } from "./ClassicPage";
import { Link } from "./Link";
import { PageWait } from "./PageFade";
import { SaisonBlockPlaceholder } from "./SaisonBlock";
import { Placeholder, Waiting } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";

/** One of the hero's two ways on: a label and its address. */
type HeroAct = { label: Copy; href: Route };

/** What the hero reads: its two ways on and the season's card beside it. */
export type LandingContent = {
  /** The Spielplan, in every state. */
  primary: HeroAct;
  /** Applying while a window is open, the league's own page while none is. */
  secondary: HeroAct;
  /** The season's card, `SaisonBlock`. */
  aside: ReactElement;
};

const hero = tv({
  slots: {
    // Split from `lg`: the tagline and the words under it at the left, the season card at the right beside both,
    // 48 px between; one column below. Board: the side card's width, 25 rem. The rows part by their items' padding.
    root: "grid items-start gap-x-12 lg:grid-cols-[minmax(0,1fr)_25rem]",
    title: "pb-6 font-heading text-3xl tracking-display uppercase lg:col-start-1 lg:row-start-1",
    words: "grid content-start gap-6 pb-8 lg:col-start-1 lg:row-start-2 lg:pb-0",
    // The lead's paragraphs, 12 px apart, a step closer than the words and the acts under them.
    lead: "grid gap-3 text-base text-fg-muted",
    acts: "flex flex-wrap gap-3",
    aside: "min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1",
    // Board: the gap between the landing's sections, 48 px on a phone and 64 px from `lg`.
    sections: "grid gap-12 pt-12 lg:col-span-2 lg:gap-16 lg:pt-16",
  },
});

/** The hero's two ways on, once the read has landed. */
async function Acts({ content }: { content: Promise<LandingContent> }) {
  const { primary, secondary } = await content;
  return (
    <div className={hero().acts()}>
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
  );
}

/** The season's card, once the read has landed. */
async function Aside({ content }: { content: Promise<LandingContent> }) {
  const { aside } = await content;
  return aside;
}

/**
 * The landing's template, in the classic frame's landing column: the split hero, which writes the page's one
 * `h1`, its tagline, over the lead and its two ways on, the season's card beside them; then the page's
 * sections, each one of the landing's blocks.
 *
 * What the page knows before its read stands at once, and that is every static part: the tagline, the lead and the
 * sections' words, so the first paint has the page's real height at every width, a phone's too, and the browser's
 * restored scroll lands where the person was. What the read decides waits in place, each part in a boundary of its own
 * drawn as its block's placeholder: here the two ways on and the season's card, in `sections` the band under the steps,
 * the figures, the doors and the schools, the one read landing them together.
 */
export function LandingPage({
  title,
  lead,
  content,
  sections,
}: {
  /** The tagline, the page's one heading. */
  title: Copy;
  /** The paragraphs under the tagline. */
  lead: ReadonlyArray<Copy>;
  content: Promise<LandingContent>;
  /** The sections, each a landing block, each part the read decides in a boundary of its own. */
  sections: ReactNode;
}) {
  const slots = hero();
  return (
    <ClassicPage width="landing">
      <div className={slots.root()}>
        <h1 className={slots.title()}>{title}</h1>
        <div className={slots.words()}>
          <div className={slots.lead()}>
            {lead.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <PageWait
            fallback={
              <Waiting layout={slots.acts()}>
                <span className={buttonPlaceholder()}>{COPY.page.spielplan}</span>
                {/* The resting word: an open application window's lands in the read. */}
                <span className={buttonPlaceholder()}>{COPY.page.about}</span>
              </Waiting>
            }>
            <Acts content={content} />
          </PageWait>
        </div>
        <div className={slots.aside()}>
          <PageWait
            fallback={
              <Placeholder>
                <SaisonBlockPlaceholder />
              </Placeholder>
            }>
            <Aside content={content} />
          </PageWait>
        </div>
        <div className={slots.sections()}>{sections}</div>
      </div>
    </ClassicPage>
  );
}
