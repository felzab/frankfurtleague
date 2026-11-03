import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { Card } from "./Card";
import { Countdown } from "./Countdown";
import { GroupHead } from "./GroupHead";
import { Link } from "./Link";
import { Podium } from "./Podium";
import { SpielList } from "./SpielRow";
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
type Opening = { when: Copy; spieltag: Copy; home: OpeningSide; away: OpeningSide };

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

/** Between the opening match's two plaques, as a fixture's pairing reads. */
const VERSUS = "–";

/**
 * Where the season stands: before its start, a countdown to it and its opening match once one is dated; while
 * the league has no season on, the next one's application window; while it runs, its last result once there is
 * one and its next match; once decided, its places 1 to 4.
 */
type SaisonState =
  | {
      kind: "countdown";
      /** The season's start, as an instant. */
      start: string;
      opening?: Opening;
    }
  | { kind: "window"; until: CalendarDay; apply: Route }
  | { kind: "running"; last?: Shown; next?: Shown }
  | { kind: "decided"; places: readonly [Place, Place, Place, Place] };

/**
 * The chip naming the state in the card's head: a season still ahead, its application window included, in the
 * informing blue, a running one in the green of success, a decided one in the warning's amber, each apart from
 * the others by its hue.
 */
const STATE_CHIP: Record<SaisonState["kind"], ChipProps> = {
  countdown: { tone: "info", label: SERVER_COPY.landing.saison.state.planned },
  window: { tone: "info", label: SERVER_COPY.landing.saison.state.planned },
  running: { tone: "success", label: SERVER_COPY.landing.saison.state.running },
  decided: { tone: "warn", label: SERVER_COPY.landing.saison.state.decided },
};

const block = tv({
  slots: {
    // A state worded rather than listed, inside the card's padding.
    padded: "grid gap-4 p-4",
    line: "text-sm text-fg-muted",
    // The plaques alone, one short line a phone never wraps.
    opening: "flex items-center gap-2 text-sm",
    openingLabel: "text-fg-muted",
    // The last and the next match, each under its head, a hairline between the two.
    group: "border-t border-border first:border-t-0",
  },
});

function Group({ title, spiel }: { title: Copy; spiel: Shown }) {
  const slots = block();
  return (
    <section className={slots.group()}>
      <GroupHead
        text={title}
        inset="rows"
      />
      <SpielList
        matches={[spiel]}
        bare
      />
    </section>
  );
}

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
                <OpeningPlaque side={state.opening.home} />
                <span aria-hidden>{VERSUS}</span>
                <OpeningPlaque side={state.opening.away} />
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
          {state.last !== undefined && (
            <Group
              title={SERVER_COPY.landing.saison.last}
              spiel={state.last}
            />
          )}
          {state.next !== undefined && (
            <Group
              title={SERVER_COPY.landing.saison.next}
              spiel={state.next}
            />
          )}
        </>
      );
    case "decided":
      return <Podium places={state.places} />;
  }
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
      <Body state={state} />
    </Card>
  );
}
