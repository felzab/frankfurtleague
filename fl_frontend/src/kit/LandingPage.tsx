import { ClassicPage, classicTitle } from "./ClassicPage";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";

type HeroAct = { label: Copy; href: Route };

export type LandingContent = {
  /** The Spielplan, in every state. */
  primary: HeroAct;
  /** Applying while a window is open, the league's own page while none is. */
  secondary: HeroAct;
  /** The season's card, `SaisonBlock`. */
  aside: ReactElement;
};

/** The space between the landing's sections, the same on every page that places them. */
const sectionGap = tv({ base: "grid gap-12 lg:gap-16" });

const hero = tv({
  slots: {
    // Split from `lg`: the tagline and the words under it at the left, the season card at the right beside both; one
    // column below. The rows part by their items' padding. From `lg` the words' row takes what the card adds beyond the
    // text, and the words fill it with the lead at its top and the
    // acts at its foot, so the lead stays under the title and the acts' foot meets the card's.
    root: "grid items-start gap-x-12 lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-[auto_1fr]",
    // A classic page's title at the page's rung.
    title: classicTitle({ place: "page", class: "pb-6 lg:col-start-1 lg:row-start-1" }),
    words: "grid content-start gap-6 pb-8 lg:col-start-1 lg:row-start-2 lg:content-between lg:self-stretch lg:pb-0",
    lead: "grid gap-3 text-base text-fg-muted",
    acts: "flex flex-wrap gap-3",
    // From `lg` the card stands beside both rows, from the title's top to the words' foot, the taller of the two setting
    // the hero's height. A grid of one, so the card fills it.
    aside: "min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid lg:self-stretch",
    sections: sectionGap({ class: "pt-12 lg:col-span-2 lg:pt-16" }),
  },
});

/** The landing's sections on a page of their own, under its head, as far apart as on the landing. */
export function SectionStack({ children }: { children: ReactNode }) {
  return <div className={sectionGap()}>{children}</div>;
}

async function Acts({ content }: { content: Promise<LandingContent> }) {
  const { primary, secondary } = await content;
  return (
    <div className={hero().acts()}>
      {/* The Spielplan arrives whole: the hero's one likely next page, its reads cached for every visitor. */}
      <Link
        href={primary.href}
        placement="button"
        look="primary"
        label={primary.label}
        prefetch
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

async function Aside({ content }: { content: Promise<LandingContent> }) {
  const { aside } = await content;
  return aside;
}

/**
 * The landing's template, in the classic frame's landing column: the split hero, which writes the page's one
 * `h1`, its tagline, over the lead and its two ways on, the season's card beside them; then the page's
 * sections, each one of the landing's blocks. The page arrives whole, its static parts and what its read decides
 * together.
 */
export function LandingPage({
  title,
  lead,
  content,
  sections,
}: {
  /** The tagline, the page's one heading. */
  title: Copy;
  lead: ReadonlyArray<Copy>;
  content: Promise<LandingContent>;
  sections: ReactNode;
}) {
  const slots = hero();
  return (
    <ClassicPage width="frame">
      <div className={slots.root()}>
        <h1 className={slots.title()}>{title}</h1>
        <div className={slots.words()}>
          <div className={slots.lead()}>
            {lead.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <Acts content={content} />
        </div>
        <div className={slots.aside()}>
          <Aside content={content} />
        </div>
        <div className={slots.sections()}>{sections}</div>
      </div>
    </ClassicPage>
  );
}
