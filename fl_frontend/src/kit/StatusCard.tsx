import { buttonPlaceholder } from "./buttonStyles";
import { cardSurface } from "./cardStyles";
import { ClassicPage, ClassicTitle, classicTitle } from "./ClassicPage";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { placeholderBar, PlaceholderSentence, Waiting } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { IconName } from "./Icon";

// The status card and its classic page, apart from the rail form in `StatusPage.tsx`: what imports this module never
// reaches the rail frame, and the root error and not-found boundaries, which every route loads, import it.

/** What the end says at a glance, in the hues a chip names: done, a fact, a link or a page that is no more, a failure. */
type StatusTone = Exclude<ChipProps["tone"], "neutral">;

/** Each hue's glyph in the card's mark. */
const GLYPH: Readonly<Record<StatusTone, IconName>> = { success: "done", info: "info", warn: "warning", danger: "error" };

/** A way on from an end: its label and its address, each per page in the catalogue. */
type WayOn = { label: Copy; href: Route };

/**
 * One end state: its hue, its title, and its one way on; beneath it, where the end points to a page that says more,
 * a quieter second way on, as the deletion's done page leads to the privacy notice.
 */
export type StatusCardProps = {
  tone: StatusTone;
  title: Copy;
  next: WayOn;
  quiet?: WayOn;
};

export const statusCard = tv({
  slots: {
    root: `mx-auto grid w-full max-w-card justify-items-center gap-4 ${cardSurface()} px-6 py-8 text-center max-lg:justify-items-stretch`,
    mark: "flex size-10 items-center justify-center justify-self-center rounded-full",
    // A rail card's title in the Anton of the strip above it, at the strip's rung, below the strip's `h1`.
    railTitle: "font-heading tracking-display uppercase",
  },
  variants: {
    // The mark's tint is 12 % of its hue over the card, as a chip's.
    tone: {
      success: { mark: "bg-success/12 text-success" },
      info: { mark: "bg-info/12 text-info" },
      warn: { mark: "bg-warn/12 text-warn" },
      danger: { mark: "bg-danger/12 text-danger" },
    },
    // A public season page's title at 24 px, a signed-in page's at 20 px, as the strip's.
    scope: {
      saison: { railTitle: "text-2xl" },
      area: { railTitle: "text-xl" },
    },
  },
});

/** The card's parts: its hue, its ways on, and its title as the frame sets it, or none where the strip says it. */
export function CardBody({ tone, next, quiet, title }: Omit<StatusCardProps, "title"> & { title?: ReactElement }) {
  const slots = statusCard({ tone });
  return (
    <div className={slots.root()}>
      <span className={slots.mark()}>
        <Icon
          glyph={GLYPH[tone]}
          size={18}
        />
      </span>
      {title}
      <Link
        href={next.href}
        placement="button"
        look="primary"
        label={next.label}
      />
      {quiet !== undefined && (
        <Link
          href={quiet.href}
          placement="button"
          look="quiet"
          label={quiet.label}
        />
      )}
    </div>
  );
}

/**
 * The hairline card every end state shares, in the classic frame: its mark, its title, one way on; an error's too,
 * which offers no retry. It writes no landmark, so a page inside an old shell's `main` places it alone.
 */
export function StatusCard({ tone, title, next, quiet }: StatusCardProps) {
  return (
    <CardBody
      tone={tone}
      next={next}
      quiet={quiet}
      title={<ClassicTitle text={title} />}
    />
  );
}

/**
 * The classic page's card while its read says which end it is, on a page that lands an end most days: its mark, its
 * title's lines and its way on as bars. `title` and `next` are the likeliest end's words, set unseen, so the card stands
 * as that end will at every width and shows none of them.
 */
export function StatusPagePlaceholder({ title, next }: { title: Copy; next: Copy }) {
  const slots = statusCard();
  return (
    <ClassicPage width="card">
      <Waiting>
        <div className={slots.root()}>
          <span className={placeholderBar(slots.mark())} />
          <PlaceholderSentence
            textClass={`w-full ${classicTitle()}`}
            words={title}
          />
          <span className={buttonPlaceholder()}>{next}</span>
        </div>
      </Waiting>
    </ClassicPage>
  );
}

/**
 * The status template in the classic frame: not found, an error, and the end of every process a link or a form
 * finishes, plainly said, the card carrying the page's title. The rail frames' form is `StatusPage.tsx :: StatusPage`.
 */
export function ClassicStatusPage({ tone, title, next, quiet }: StatusCardProps) {
  return (
    <ClassicPage width="card">
      <StatusCard
        tone={tone}
        title={title}
        next={next}
        quiet={quiet}
      />
    </ClassicPage>
  );
}
