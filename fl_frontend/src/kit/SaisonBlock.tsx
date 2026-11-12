import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { Card, CardPlaceholder } from "./Card";
import { Countdown } from "./Countdown";
import { Link } from "./Link";
import { Podium } from "./Podium";
import { SAISON_CHIP } from "./saisonChip";
import { placeholderBar } from "./Skeleton";
import { SpielGroup } from "./SpielGroup";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, RecordText } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { Place } from "./Podium";
import type { SpielRowProps } from "./SpielRow";

/** A match as the season card lists it. */
type Shown = SpielRowProps & { id: string };

/** One side of the opening match: its club's Kürzel, or `null` while its slot is empty. */
type OpeningSide = RecordText | null;

/**
 * The season's first match as the countdown names it: its day and time as its row shows them, its matchday's
 * label and its two sides' plaques, a side whose slot is empty in the dashed open one.
 */
type Opening = { when: Copy; spieltag: Copy; team1: OpeningSide; team2: OpeningSide };

/**
 * An opening side's plaque. An empty slot's dashed open plaque names nothing, so the Spielplan's words for an open
 * side go with it, for a screen reader alone: the line shows plaques only.
 */
function OpeningPlaque({ side }: { side: OpeningSide }) {
  return side === null ? (
    <>
      <TeamPlaque plaque={{ quelle: null }} />
      <span className="sr-only">{COPY.spielplan.quelle.open}</span>
    </>
  ) : (
    <TeamPlaque plaque={side} />
  );
}

/**
 * Where the season stands: before its start, a countdown to it and its opening match once one is dated; while
 * the league has no season on, the next one's application window; while it runs, its last results and its next
 * matches, each side nearest first, an empty side drawing nothing; once decided, its places 1 to 4.
 */
type SaisonState =
  | {
      kind: "countdown";
      /** The season's start, as an instant. */
      start: string;
      opening?: Opening;
    }
  | { kind: "window"; until: CalendarDay; apply: Route }
  | { kind: "running"; last: readonly Shown[]; next: readonly Shown[] }
  | { kind: "decided"; places: readonly [Place, Place, Place, Place] };

/**
 * The chip naming the state in the card's head, from the season's one entry, so the card and the administration draw
 * one chip for one state: a season still ahead, its application window included, as planned.
 */
const STATE_CHIP: Record<SaisonState["kind"], ChipProps> = {
  countdown: SAISON_CHIP.planned,
  window: SAISON_CHIP.planned,
  running: SAISON_CHIP.running,
  decided: SAISON_CHIP.decided,
};

const block = tv({
  slots: {
    // A state worded rather than listed, inside the card's padding.
    padded: "grid gap-4 p-4",
    line: "text-sm text-fg-muted",
    // The plaques alone, one short line a phone never wraps.
    opening: "flex items-center gap-2 text-sm",
    openingLabel: "text-fg-muted",
  },
});

function Body({ state }: { state: SaisonState }) {
  const slots = block();
  switch (state.kind) {
    case "countdown":
      return (
        <div className={slots.padded()}>
          {/* The server's instant seeds the count, so the markup it sends is the markup the page hydrates. */}
          <Countdown
            start={state.start}
            seed={now().getTime()}
          />
          {state.opening !== undefined && (
            <>
              <p className={slots.line()}>{SERVER_COPY.landing.saison.opening(state.opening.when)}</p>
              <p className={slots.opening()}>
                <span className={slots.openingLabel()}>{state.opening.spieltag}</span>
                <OpeningPlaque side={state.opening.team1} />
                <span aria-hidden>{COPY.shared.versus}</span>
                <OpeningPlaque side={state.opening.team2} />
              </p>
            </>
          )}
        </div>
      );
    case "window":
      return (
        <div className={slots.padded()}>
          <p>{SERVER_COPY.landing.saison.windowUntil(state.until)}</p>
          <Link
            href={state.apply}
            placement="button"
            look="primary"
            label={SERVER_COPY.landing.toBewerbung}
          />
        </div>
      );
    case "running":
      return (
        <>
          {state.last.length > 0 && (
            <SpielGroup
              head={SERVER_COPY.landing.saison.last}
              spiele={state.last}
            />
          )}
          {state.next.length > 0 && (
            <SpielGroup
              head={SERVER_COPY.landing.saison.next}
              spiele={state.next}
            />
          )}
        </>
      );
    case "decided":
      return <Podium places={state.places} />;
  }
}

/**
 * The card's body below `lg`, where it stands under the hero's text and nothing beside it sets its height: at least the
 * tallest state's, the running season's last and next match, each a 40-px head over a 100-px match card, three hairlines
 * between and under them, so no state, and not its wait, moves the sections under the card when it lands. From `lg` the
 * hero's grid sets the card's height.
 */
const BODY_CLASSES = "max-lg:min-h-[calc(17.5rem+3px)]";

/**
 * The season's card while the season is read: the card's own head, its name's line and its chip's place, over one plain
 * body, since which state's body lands is what the read tells. The body fills the card wherever the hero's grid
 * stretches it, and stands at the card's one body height below `lg`.
 */
export function SaisonBlockPlaceholder() {
  return (
    <CardPlaceholder
      chip
      fill>
      <div className={`grid p-4 ${BODY_CLASSES}`}>
        <span className={placeholderBar("")} />
      </div>
    </CardPlaceholder>
  );
}

/**
 * The season's card beside the hero, the one part of the landing that changes with the season's state: the kit's
 * card in every state, the season's name in its head with the state's chip, and the state's own content in its
 * body. It carries no link to the matches, since the hero's „Spielplan“ button beside it leads there. Rendered on a
 * request, or in a cached scope, since the countdown reads the server's clock for its first figures.
 */
export function SaisonBlock({ title, state }: { title: Copy; state: SaisonState }) {
  return (
    <Card
      title={title}
      chip={STATE_CHIP[state.kind]}>
      <div className={BODY_CLASSES}>
        <Body state={state} />
      </div>
    </Card>
  );
}
