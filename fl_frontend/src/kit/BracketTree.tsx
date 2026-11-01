import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { BracketCard } from "./BracketCard";
import { tv } from "./tv";

import type { ComponentProps } from "react";

/** One knockout match in the tree: its card, by its id. */
export type BracketMatch = ComponentProps<typeof BracketCard> & { id: string };

/** One round, its matches in the bracket's order, so a match stands under the two that feed it. */
export type BracketRound = { id: string; label: string; matches: ReadonlyArray<BracketMatch> };

/** How many matches the first round holds, and so how many columns the tree has: the draw allows 2 to 16 qualifiers. */
type Width = 1 | 2 | 4 | 8;

const isWidth = (count: number): count is Width => count === 1 || count === 2 || count === 4 || count === 8;
const key = (count: Width) => String(count) as `${Width}`;

const tree = tv({
  slots: {
    // The rounds 32 px apart on a phone and 48 px on desktop; the third place's dashed lines 24 px inward of the
    // Finale's, meeting on a bus 14 px above its card.
    root: "overflow-x-auto [--bracket-gap:2rem] [--bracket-third-bus:0.875rem] [--bracket-third-inset:1.5rem] lg:[--bracket-gap:3rem]",
    row: "grid",
    cell: "flex justify-center",
    // One column wide whatever its match spans, so every card of the tree is the same size.
    card: "w-bracket-phone px-1 lg:max-w-bracket lg:px-2",
    gap: "block h-(--bracket-gap)",
    feed: "relative h-(--bracket-gap)",
    // From each card of a pair down, across between them, and down to the match they feed.
    feedJoin: "absolute inset-x-1/4 top-0 h-1/2 border-x border-b border-border",
    feedStem: "absolute bottom-0 left-1/2 h-1/2 border-l border-border",
    // The Finale's lines past the third place's row, from the semi-finals' centres.
    finalLeft: "absolute top-0 bottom-[calc(var(--bracket-gap)/2)] left-1/4 border-l border-border",
    finalRight: "absolute top-0 right-1/4 bottom-[calc(var(--bracket-gap)/2)] border-r border-border",
    finalBus: "absolute inset-x-1/4 bottom-[calc(var(--bracket-gap)/2)] border-t border-border",
    finalStem: "absolute bottom-0 left-1/2 h-[calc(var(--bracket-gap)/2)] border-l border-border",
    thirdLeft:
      "absolute top-0 left-[calc(25%+var(--bracket-third-inset))] h-[calc(var(--bracket-gap)-var(--bracket-third-bus))] border-l border-dashed border-border",
    thirdRight:
      "absolute top-0 right-[calc(25%+var(--bracket-third-inset))] h-[calc(var(--bracket-gap)-var(--bracket-third-bus))] border-r border-dashed border-border",
    thirdBus:
      "absolute inset-x-[calc(25%+var(--bracket-third-inset))] top-[calc(var(--bracket-gap)-var(--bracket-third-bus))] border-t border-dashed border-border",
    thirdStem:
      "absolute top-[calc(var(--bracket-gap)-var(--bracket-third-bus))] left-1/2 h-(--bracket-third-bus) border-l border-dashed border-border",
  },
  variants: {
    // Static class names, one per width, since Tailwind reads the source for whole names.
    columns: {
      "1": { row: "grid-cols-1" },
      "2": { row: "grid-cols-2" },
      "4": { row: "grid-cols-4" },
      "8": { row: "grid-cols-8" },
    },
    // How many of the first round's columns a match takes, its card one column of them.
    span: {
      "1": { cell: "col-span-1", card: "lg:w-full", feed: "col-span-1" },
      "2": { cell: "col-span-2", card: "lg:w-1/2", feed: "col-span-2" },
      "4": { cell: "col-span-4", card: "lg:w-1/4", feed: "col-span-4" },
      "8": { cell: "col-span-8", card: "lg:w-1/8", feed: "col-span-8" },
    },
  },
});

/** One round's cards in one row, each centred over the span its match takes of the first round's columns. */
function Row({ label, matches, width }: { label: string; matches: ReadonlyArray<BracketMatch>; width: Width }) {
  const span = width / matches.length;
  if (!isWidth(span)) return null;
  const { row, cell, card } = tree({ columns: key(width), span: key(span) });
  return (
    <ol
      aria-label={label}
      className={row()}>
      {matches.map(({ id, ...match }) => (
        <li
          key={id}
          className={cell()}>
          <div className={card()}>
            <BracketCard {...match} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The solid lines from each pair of a round down to the match they feed. */
function Feeds({ into, width }: { into: number; width: Width }) {
  const span = width / into;
  if (!isWidth(span)) return null;
  const { row, feed, feedJoin, feedStem } = tree({ columns: key(width), span: key(span) });
  return (
    <div
      aria-hidden
      className={row()}>
      {Array.from({ length: into }, (_, index) => (
        <span
          key={index}
          className={feed()}>
          <span className={feedJoin()} />
          <span className={feedStem()} />
        </span>
      ))}
    </div>
  );
}

/**
 * The match for third place on its own row between the semi-finals and the Finale, its card centred. The
 * Finale's solid lines run down past it from the semi-finals' centres; its own dashed lines leave the
 * semi-finals' bottoms further in and meet on a bus just above its card.
 */
function ThirdPlace({ match, width }: { match: BracketMatch; width: Width }) {
  const style = tree();
  return (
    <div className="relative">
      <span
        aria-hidden
        className={style.gap()}
      />
      <Row
        label={SERVER_COPY.season.thirdPlace}
        matches={[match]}
        width={width}
      />
      <span
        aria-hidden
        className={style.gap()}
      />
      <span aria-hidden>
        <span className={style.finalLeft()} />
        <span className={style.finalRight()} />
        <span className={style.finalBus()} />
        <span className={style.finalStem()} />
        <span className={style.thirdLeft()} />
        <span className={style.thirdRight()} />
        <span className={style.thirdBus()} />
        <span className={style.thirdStem()} />
      </span>
    </div>
  );
}

/**
 * The K.-o.-Baum, upright: the first round on top and the Finale at the bottom, each match's card under the two
 * that feed it, joined by hairlines, every card the same size. The match for third place stands on its own row
 * above the Finale. Where the first round is wider than the screen the tree scrolls sideways inside its box.
 */
export function BracketTree({ rounds, third }: { rounds: readonly [BracketRound, ...BracketRound[]]; third?: BracketMatch }) {
  const width = rounds[0].matches.length;
  if (!isWidth(width)) return null;
  // The Finale's index: the third place stands between the round before it, the semi-finals, and it.
  const finale = rounds.length - 1;
  return (
    <section
      aria-label={COPY.shared.kOBaum}
      className={tree().root()}>
      {rounds.map((round, index) => (
        <div key={round.id}>
          {index > 0 &&
            (third !== undefined && index === finale ? (
              <ThirdPlace
                match={third}
                width={width}
              />
            ) : (
              <Feeds
                into={round.matches.length}
                width={width}
              />
            ))}
          <Row
            label={round.label}
            matches={round.matches}
            width={width}
          />
        </div>
      ))}
    </section>
  );
}
