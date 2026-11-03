import { Suspense } from "react";

import { cardSurface } from "./cardStyles";
import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RailPage } from "./RailFrame";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { IconName } from "./Icon";
import type { RailPageHead } from "./RailFrame";

/** What the end says at a glance, in the hues a chip names: done, a fact, a link or a page that is no more, a failure. */
type StatusTone = Exclude<ChipProps["tone"], "neutral">;

/** Each hue's glyph in the card's mark. */
const GLYPH: Readonly<Record<StatusTone, IconName>> = { success: "done", info: "info", warn: "warning", danger: "error" };

/** One end state: its hue, its one sentence, and its one way on, a label and an address per page in the catalogue. */
export type StatusCardProps = {
  tone: StatusTone;
  sentence: Copy;
  next: { label: Copy; href: Route };
};

const card = tv({
  slots: {
    root: `mx-auto grid w-full max-w-card justify-items-center gap-4 ${cardSurface()} px-6 py-8 text-center max-lg:justify-items-stretch`,
    mark: "flex size-10 items-center justify-center justify-self-center rounded-full",
    sentence: "text-base text-fg",
  },
  variants: {
    // The mark's tint is 12 % of its hue over the card, as a chip's.
    tone: {
      success: { mark: "bg-success/12 text-success" },
      info: { mark: "bg-info/12 text-info" },
      warn: { mark: "bg-warn/12 text-warn" },
      danger: { mark: "bg-danger/12 text-danger" },
    },
  },
});

/**
 * The card's words: a title where the frame carries none, and one sentence, which a titled card may leave out where
 * its title says all there is, as an error's does.
 */
type CardWords = { title?: Copy; sentence: Copy } | { title: Copy; sentence?: undefined };

/**
 * The hairline card every end state shares: its mark, the title where the frame carries none, one sentence, one
 * way on; an error's too, which offers no retry. It writes no landmark, so a page inside an old shell's
 * `main` places it alone.
 */
export function StatusCard({ tone, sentence, next, title }: Omit<StatusCardProps, "sentence"> & CardWords) {
  const slots = card({ tone });
  return (
    <div className={slots.root()}>
      <span className={slots.mark()}>
        <Icon
          glyph={GLYPH[tone]}
          size={18}
        />
      </span>
      {title !== undefined && <ClassicTitle text={title} />}
      {sentence !== undefined && <p className={slots.sentence()}>{sentence}</p>}
      <Link
        href={next.href}
        placement="button"
        look="primary"
        label={next.label}
      />
    </div>
  );
}

/** The card once the page's read has said which end it is, in the rail form's boundary. */
async function CardOnceRead({ card }: { card: Promise<StatusCardProps> }) {
  const { tone, sentence, next } = await card;
  return (
    <StatusCard
      tone={tone}
      sentence={sentence}
      next={next}
    />
  );
}

/**
 * The status template: not found, an error, no access, and the end of every process a link or a form
 * finishes, plainly said, in the frame the address belongs to. In the classic frame the card carries the
 * page's title; in the rail frames the strip does, and the card none. The rail form's card is read with the
 * page, as `/saisons` learns that the league has no season yet where it does not send the reader on, so it
 * waits in a boundary of its own under the strip, drawn meanwhile as nothing.
 */
export function StatusPage(
  props:
    | (Omit<StatusCardProps, "sentence"> & { frame: "classic"; title: Copy; sentence?: Copy })
    | ({ frame: "rail"; card: Promise<StatusCardProps> } & RailPageHead),
) {
  if (props.frame === "classic") {
    return (
      <ClassicPage width="card">
        <StatusCard
          tone={props.tone}
          sentence={props.sentence}
          next={props.next}
          title={props.title}
        />
      </ClassicPage>
    );
  }
  return (
    <RailPage
      scope={props.scope}
      title={props.title}
      chip={props.chip}>
      <Suspense fallback={null}>
        <CardOnceRead card={props.card} />
      </Suspense>
    </RailPage>
  );
}
