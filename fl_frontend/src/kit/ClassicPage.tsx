import { cardSurface } from "./cardStyles";
import { PageFade } from "./PageFade";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

const page = tv({
  slots: {
    // At least the first screen under the classic header, whose height the frame declares, so on every page
    // the footer starts just below the screen and is reached by scrolling. The gutter stands here, outside
    // the column, so the column's width is its content's.
    main: "flex min-h-[calc(100dvh-var(--classic-header))] w-full flex-1 flex-col px-4 py-8 overflow-anchor-none lg:py-12",
    column: "mx-auto flex w-full flex-1 flex-col gap-6",
  },
  variants: {
    // A form or a mailed page in the form column; a mailed page's question, one card as wide as a dialog holding a
    // form; one card centred on the page as a status page stands; the sign-in's column, which proportions its
    // full-width controls as Vercel's sign-in does; or, as wide as the header's and the footer's row, the landing,
    // its sections farther apart than a form's, and a reading page, its text hanging from the logo's edge while a
    // task stays centred.
    width: {
      form: { column: "max-w-form" },
      mailed: { column: "max-w-dialog" },
      card: { column: "max-w-card justify-center" },
      signin: { column: "max-w-signin justify-center" },
      // The gap between the landing's sections, 48 px on a phone and 64 px from `lg`.
      landing: { column: "max-w-classic gap-12 lg:gap-16" },
      reading: { column: "max-w-classic" },
    },
  },
});

/**
 * A page inside the classic frame: its content in the plain column, filling the first screen. The classic
 * frame's layout places the header and the footer around it; a template places this, which with `RailPage`
 * writes every page's `main`.
 */
export function ClassicPage({
  width,
  children,
}: {
  width: "form" | "mailed" | "card" | "signin" | "landing" | "reading";
  children: ReactNode;
}) {
  const { main, column } = page({ width });
  return (
    <PageFade>
      <main className={main()}>
        <div className={column()}>{children}</div>
      </main>
    </PageFade>
  );
}

/**
 * A classic page's one title's look, which its placeholder's line takes too: in Anton, at 32 px where it stands on the
 * page, the landing's hero's rung, and at 24 px inside a card, a status card's or a mailed question's.
 */
export const classicTitle = tv({
  base: "font-heading tracking-display uppercase",
  variants: {
    place: {
      page: "text-3xl",
      card: "text-2xl",
    },
  },
  defaultVariants: { place: "card" },
});

/** A classic page's one title: at the column's head, or in a card. */
export function ClassicTitle({ text, place = "card" }: { text: Copy; place?: "page" | "card" }) {
  return <h1 className={classicTitle({ place })}>{text}</h1>;
}

/**
 * A mailed page's question as one card, as a Konto box stands: its title, facts, sentences and fields inside the box's
 * 16-px inset, and its acts in the footer's strip across the box's foot. A card holds one topic with its actions, as
 * Material's card guidelines put it, and the page's end, the status card, is a card too.
 */
export const mailedCard = tv({
  slots: {
    root: cardSurface({ class: "grid overflow-hidden" }),
    body: "grid gap-6 p-4",
    // The bot check, where Cloudflare asks the visitor to act, over the strip at the body's inset.
    check: "px-4",
  },
});

/** Landing sections under a reading page's head, as far apart as the landing's: 48 px on a phone and 64 px from `lg`. */
export function ClassicSections({ children }: { children: ReactNode }) {
  return <div className="grid gap-12 lg:gap-16">{children}</div>;
}

const head = tv({
  slots: {
    // Over a hairline across the column, which parts the head from what the page says.
    root: "grid gap-3 border-b border-border pb-6",
    // A lead paragraph a step above the text from `lg`, in the muted grey the landing's lead takes.
    lead: "max-w-measure text-base text-fg-muted lg:text-xl",
    date: "text-sm text-fg-muted",
  },
});

/**
 * A reading page's head: its title at the page's rung, the lead under it, the page's own description or, on About, the
 * landing's paragraphs, and the day its words took effect where the page has one.
 */
export function PageHead({ title, lead, date }: { title: Copy; lead: readonly Copy[]; date?: Copy }) {
  const slots = head();
  return (
    <header className={slots.root()}>
      <ClassicTitle
        text={title}
        place="page"
      />
      {lead.map((paragraph) => (
        <p
          key={paragraph}
          className={slots.lead()}>
          {paragraph}
        </p>
      ))}
      {date !== undefined && <p className={slots.date()}>{date}</p>}
    </header>
  );
}
