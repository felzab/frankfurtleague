import { cardSurface } from "./cardStyles";
import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { PageWait } from "./PageFade";
import { RailPage } from "./RailFrame";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { IconName } from "./Icon";
import type { RailPageHead } from "./RailFrame";

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

/**
 * A rail frame's card. A page with a name of its own keeps that name in the strip and its card carries the end's
 * title, as `/saisons` says that the league has no season yet; a boundary with no page of its own, the not-found and
 * the error page, has its title in the strip, and its card holds no second one.
 */
type RailCard = Omit<StatusCardProps, "title"> & { title?: Copy };

const statusCard = tv({
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
function CardBody({ tone, next, quiet, title }: Omit<StatusCardProps, "title"> & { title?: ReactElement }) {
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

/** The card in a rail page, under the strip's title: the end's own title where the strip names the page instead. */
function RailCardBody({ card: { tone, next, quiet, title }, scope }: { card: RailCard; scope: RailPageHead["scope"] }) {
  return (
    <CardBody
      tone={tone}
      next={next}
      quiet={quiet}
      title={title === undefined ? undefined : <h2 className={statusCard({ tone, scope }).railTitle()}>{title}</h2>}
    />
  );
}

/** The card once the page's read has said which end it is, in the rail form's boundary. */
async function CardOnceRead({ card, scope }: { card: Promise<RailCard>; scope: RailPageHead["scope"] }) {
  return (
    <RailCardBody
      card={await card}
      scope={scope}
    />
  );
}

/**
 * The status template: not found, an error, no access, and the end of every process a link or a form
 * finishes, plainly said, in the frame the address belongs to: a mark, a title and one way on. In
 * the classic frame the card carries the page's title; in the rail frames the strip carries the page's, and the card
 * the end's where the two differ. The rail form's card is read with the page, as `/saisons` learns that the league
 * has no season yet where it does not send the reader on, so it waits in a boundary of its own under the strip,
 * drawn meanwhile as nothing; a card known before any read, as an error boundary's, which is a Client Component and
 * awaits nothing, is drawn at once.
 */
export function StatusPage(
  props: (StatusCardProps & { frame: "classic" }) | ({ frame: "rail"; card: Promise<RailCard> | RailCard } & RailPageHead),
) {
  if (props.frame === "classic") {
    return (
      <ClassicPage width="card">
        <StatusCard
          tone={props.tone}
          title={props.title}
          next={props.next}
          quiet={props.quiet}
        />
      </ClassicPage>
    );
  }
  return (
    <RailPage
      scope={props.scope}
      title={props.title}
      chip={props.chip}>
      {props.card instanceof Promise ? (
        <PageWait fallback={null}>
          <CardOnceRead
            card={props.card}
            scope={props.scope}
          />
        </PageWait>
      ) : (
        <RailCardBody
          card={props.card}
          scope={props.scope}
        />
      )}
    </RailPage>
  );
}
