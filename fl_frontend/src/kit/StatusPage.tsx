import { Button } from "./Button";
import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RailPage } from "./RailFrame";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { RailPageHead } from "./RailFrame";

/** What the end says at a glance: done, a fact, a link or a page that is no more, a failure; each names its glyph. */
type StatusMark = "done" | "info" | "warning" | "error";

/** One end state: its mark, its one sentence, and its one way on, a label and an address per page in the catalogue. */
export type StatusCardProps = {
  mark: StatusMark;
  sentence: Copy;
  next: { label: Copy; href: Route };
};

/**
 * An error page's one act, which the card takes in place of its way on: trying again what failed, from the
 * error boundary's own retry, so only a client error page can hand it.
 */
type Retry = { label: Copy; onRetry: () => void };

/** The card's one act: a link on, or a retry where the page is an error's. */
type Act = StatusCardProps["next"] | Retry;

const card = tv({
  slots: {
    root: "mx-auto grid w-full max-w-card justify-items-center gap-4 rounded-lg border border-border bg-bg px-6 py-8 text-center max-lg:justify-items-stretch",
    mark: "flex size-10 items-center justify-center justify-self-center rounded-full",
    sentence: "text-base text-fg",
  },
  variants: {
    // The mark's tint is 12 % of its hue over the card, as a chip's.
    mark: {
      done: { mark: "bg-success/12 text-success" },
      info: { mark: "bg-info/12 text-info" },
      warning: { mark: "bg-warn/12 text-warn" },
      error: { mark: "bg-danger/12 text-danger" },
    },
  },
});

/**
 * The hairline card every end state shares: its mark, the title where the frame carries none, one sentence, one
 * act. It writes no landmark, so a page inside an old shell's `main` places it alone.
 */
export function StatusCard({ mark, sentence, next, title }: Omit<StatusCardProps, "next"> & { next: Act; title?: Copy | string }) {
  const slots = card({ mark });
  return (
    <div className={slots.root()}>
      <span className={slots.mark()}>
        <Icon
          glyph={mark}
          size={18}
        />
      </span>
      {title !== undefined && <ClassicTitle text={title} />}
      <p className={slots.sentence()}>{sentence}</p>
      {"href" in next ? (
        <Link
          href={next.href}
          placement="button"
          look="primary"
          label={next.label}
        />
      ) : (
        <Button
          variant="primary"
          label={next.label}
          onPress={next.onRetry}
        />
      )}
    </div>
  );
}

/**
 * The status template: not found, an error, no access, and the end of every process a link or a form
 * finishes, plainly said, in the frame the address belongs to. In the classic frame the card carries the
 * page's title; in the rail frames the strip does, and the card none.
 */
export function StatusPage(
  props: Omit<StatusCardProps, "next"> & { next: Act } & ({ frame: "classic"; title: Copy } | ({ frame: "rail" } & RailPageHead)),
) {
  const card = (
    <StatusCard
      mark={props.mark}
      sentence={props.sentence}
      next={props.next}
      title={props.frame === "classic" ? props.title : undefined}
    />
  );
  if (props.frame === "classic") {
    return <ClassicPage width="card">{card}</ClassicPage>;
  }
  return (
    <RailPage
      scope={props.scope}
      title={props.title}
      chip={props.chip}>
      {card}
    </RailPage>
  );
}
