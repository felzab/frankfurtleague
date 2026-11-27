import { cardSurface } from "./cardStyles";
import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RetryButton } from "./RetryButton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { IconName } from "./Icon";
import type { RailPageHead } from "./RailFrame";

// The status card in both frames and its classic page, apart from the rail page in `StatusPage.tsx`: what imports this
// module never reaches the rail frame, and the root error and not-found boundaries, which every route loads, and a
// client run that ends inside a rail page import it.

/**
 * What the end says at a glance, in the hues a chip names: done, a fact, a link or a page that is no more, a failure
 * or the person's own decline.
 */
type StatusTone = Exclude<ChipProps["tone"], "neutral">;

const GLYPH: Readonly<Record<StatusTone, IconName>> = { success: "done", info: "info", warn: "warning", danger: "error" };

/**
 * A way on from an end: its label and its address, each per page in the catalogue. The only way on an end that a server
 * words may carry, since a retry is a function, which React cannot send from the server.
 */
export type WayOn = { label: Copy; href: Route };

/**
 * An error card's act: the `retry` Next hands its boundary, which draws the failed part again in place. Its label is
 * the same on every card, so the button holds it.
 */
type Retry = { retry: () => void };

/**
 * One end state: its hue, its title, and its one way on, or an error card's retry; beneath it, where the end points to
 * a page that says more, a quieter second way on, as the deletion's done page leads to the privacy notice.
 */
export type StatusCardProps = {
  tone: StatusTone;
  title: Copy;
  /**
   * One line under the title, only where the end leaves standing what the person may believe changed: a confirmation
   * pressed again, whose earlier choices stand.
   */
  sentence?: Copy;
  next: WayOn | Retry;
  quiet?: WayOn;
};

const statusCard = tv({
  slots: {
    root: "grid w-full justify-items-center gap-4 text-center",
    mark: "flex size-10 items-center justify-center justify-self-center rounded-full",
    // A rail card's title in the Anton of the strip above it, at the strip's rung, below the strip's `h1`.
    railTitle: "font-heading tracking-display uppercase",
    sentence: "text-sm text-pretty text-fg-muted",
  },
  variants: {
    // The glyph in its hue on the chip's opaque tint, a pair the contrast rule measures.
    tone: {
      success: { mark: "bg-success-tint text-success" },
      info: { mark: "bg-info-tint text-info" },
      warn: { mark: "bg-warn-tint text-warn" },
      danger: { mark: "bg-danger-tint text-danger" },
    },
    // At the strip title's size for the same scope.
    scope: {
      saison: { railTitle: "text-2xl" },
      area: { railTitle: "text-xl" },
    },
    // A card of its own on a page; in a route dialog, whose box is its surface, its parts alone, the way on as wide as
    // the dialog, as the match pop-up's act stands.
    place: {
      page: { root: `mx-auto max-w-card ${cardSurface()} px-6 py-8 max-lg:justify-items-stretch` },
      dialog: { root: "justify-items-stretch" },
    },
  },
  defaultVariants: { place: "page" },
});

/**
 * The card's parts: its hue, its ways on, and its title as the frame sets it, or none where the strip says it; on a
 * page, or in a route dialog, whose title names the dialog.
 */
export function StatusCardBody({
  tone,
  next,
  quiet,
  title,
  sentence,
  place,
}: Omit<StatusCardProps, "title"> & { title?: ReactElement; place?: "page" | "dialog" }) {
  const slots = statusCard({ tone, place });
  return (
    <div className={slots.root()}>
      <span className={slots.mark()}>
        <Icon
          glyph={GLYPH[tone]}
          size={18}
        />
      </span>
      {title}
      {sentence !== undefined && <p className={slots.sentence()}>{sentence}</p>}
      {"retry" in next ? (
        <RetryButton retry={next.retry} />
      ) : (
        <Link
          href={next.href}
          placement="button"
          look="primary"
          label={next.label}
        />
      )}
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
 * A rail frame's card. A page with a name of its own keeps that name in the strip and its card carries the end's
 * title, as the referee's Spielbericht for a match with no date says „Termin offen“; a boundary with no page of its
 * own, the not-found and the error page, has its title in the strip, and its card holds no second one.
 */
export type RailCard = Omit<StatusCardProps, "title"> & { title?: Copy };

/** The card in a rail page, under the strip's title: the end's own title where the strip names the page instead. */
export function RailCardBody({ card: { tone, next, quiet, title }, scope }: { card: RailCard; scope: RailPageHead["scope"] }) {
  return (
    <StatusCardBody
      tone={tone}
      next={next}
      quiet={quiet}
      title={title === undefined ? undefined : <h2 className={statusCard({ tone, scope }).railTitle()}>{title}</h2>}
    />
  );
}

/**
 * The status template in the classic frame: not found, an error, and the end of every process a link or a form
 * finishes, plainly said, the card carrying the page's title. The rail frames' form is `StatusPage`.
 */
export function ClassicStatusPage({ tone, title, sentence, next, quiet }: StatusCardProps) {
  return (
    <ClassicPage width="card">
      <StatusCardBody
        tone={tone}
        sentence={sentence}
        next={next}
        quiet={quiet}
        title={<ClassicTitle text={title} />}
      />
    </ClassicPage>
  );
}
