import { useId } from "react";

import { now } from "@/core/clock";
import { SERVER_COPY } from "@/core/serverCopy";

import { cardSurface } from "./cardStyles";
import { Countdown } from "./Countdown";
import { Link } from "./Link";
import { Podium } from "./Podium";
import { SpielList } from "./SpielRow";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { Route } from "next";
import type { Placed } from "./Podium";
import type { SpielRowProps } from "./SpielRow";

/** A match as the season card lists it. */
type Shown = SpielRowProps & { id: string };

/** The season's first match as the countdown names it: its matchday's label and its two clubs' Kürzel. */
type Opening = { spieltag: Copy; home: string; away: string };

/** Between the opening match's two plaques, as a fixture's pairing reads. */
const VERSUS = "–";

/**
 * Where the season stands: before its start, a countdown to its first kick-off and that match's pairing once
 * one is dated, the application window while none is, and the one sentence saying so while no window is open
 * either; while it runs, its last result and its next match; once decided, its places 1 to 4.
 */
type SaisonState =
  | {
      kind: "countdown";
      /** The first match's instant. */
      kickoff: string;
      /** Its day and time, as its row shows them. */
      when: string;
      opening: Opening;
    }
  | { kind: "window"; until: CalendarDay; apply: Route }
  | { kind: "undated" }
  | { kind: "running"; last?: Shown; next?: Shown }
  | { kind: "decided"; places: readonly [Placed, Placed, Placed, Placed] };

const block = tv({
  slots: {
    root: "grid min-w-0 content-start gap-4",
    head: "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1",
    title: "text-base font-semibold",
    box: `grid gap-4 ${cardSurface()} p-4`,
    line: "text-sm text-fg-muted",
    // The plaques alone, one short line a phone never wraps.
    opening: "flex items-center gap-2 text-sm",
    openingLabel: "text-fg-muted",
    group: "grid gap-2",
    groupTitle: "text-xs font-medium tracking-caps text-fg-muted uppercase",
  },
});

function Group({ title, spiel }: { title: Copy; spiel: Shown }) {
  const slots = block();
  return (
    <div className={slots.group()}>
      <h3 className={slots.groupTitle()}>{title}</h3>
      <SpielList matches={[spiel]} />
    </div>
  );
}

function Body({ state }: { state: SaisonState }) {
  const slots = block();
  switch (state.kind) {
    case "countdown":
      return (
        <div className={slots.box()}>
          {/* The server's instant seeds the count, so the markup it sends is the markup the page hydrates. */}
          <Countdown
            kickoff={state.kickoff}
            seed={now().getTime()}
          />
          <p className={slots.line()}>{SERVER_COPY.landing.saison.kickoff(state.when)}</p>
          <p className={slots.opening()}>
            <span className={slots.openingLabel()}>{state.opening.spieltag}</span>
            <TeamPlaque kuerzel={state.opening.home} />
            <span aria-hidden>{VERSUS}</span>
            <TeamPlaque kuerzel={state.opening.away} />
          </p>
        </div>
      );
    case "window":
      return (
        <div className={slots.box()}>
          <p>{SERVER_COPY.landing.saison.windowUntil(state.until)}</p>
          <Link
            href={state.apply}
            placement="button"
            look="primary"
            label={SERVER_COPY.landing.toBewerbung}
          />
        </div>
      );
    case "undated":
      return (
        <div className={slots.box()}>
          <p className={slots.line()}>{SERVER_COPY.landing.saison.undated}</p>
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
 * The season's card beside the hero, the one part of the landing that changes with the season's state: its
 * name, a link on to its matches, and the state's own content. Rendered on a request, or in a cached scope,
 * since the countdown reads the server's clock for its first figures.
 */
export function SaisonBlock({ title, more, state }: { title: Copy; more?: { label: Copy; href: Route }; state: SaisonState }) {
  const id = useId();
  const slots = block();
  return (
    <section
      aria-labelledby={id}
      className={slots.root()}>
      <div className={slots.head()}>
        <h2
          id={id}
          className={slots.title()}>
          {title}
        </h2>
        {more !== undefined && (
          <Link
            href={more.href}
            placement="standalone"
            label={more.label}
          />
        )}
      </div>
      <Body state={state} />
    </section>
  );
}
