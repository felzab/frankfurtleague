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
    width: {
      form: { column: "max-w-form" },
      mailed: { column: "max-w-dialog" },
      card: { column: "max-w-card justify-center" },
      signin: { column: "max-w-signin justify-center" },
      // As wide as the frame's header and footer.
      frame: { column: "max-w-classic" },
    },
  },
});

/**
 * A page inside the classic frame: its content in the plain column, filling the first screen. The classic
 * frame's layout places the header and the footer around it; a template places this, which with `RailColumn`
 * writes every page's `main`.
 */
export function ClassicPage({ width, children }: { width: "form" | "mailed" | "card" | "signin" | "frame"; children: ReactNode }) {
  const { main, column } = page({ width });
  return (
    <PageFade>
      <main className={main()}>
        <div className={column()}>{children}</div>
      </main>
    </PageFade>
  );
}

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
 * inset, and its acts in the footer's strip across the box's foot. A card holds one topic with its actions, as
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

const head = tv({
  slots: {
    // Parted from what the page says by space alone, as the text's sections are from each other.
    root: "grid gap-3 pb-6",
    lead: "max-w-measure text-base text-fg-muted lg:text-xl",
    date: "text-sm text-fg-muted",
  },
});

/**
 * A page's head where its title stands on the page: its title at the page's rung, a lead under it where the page opens
 * on content of its own, as About opens on the landing's paragraphs, and the day its words took effect where the page
 * has one. A page's title is its explanation, so no page writes an intro as its lead.
 */
export function PageHead({ title, lead = [], date }: { title: Copy; lead?: readonly Copy[]; date?: Copy }) {
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
