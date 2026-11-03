import { textOf } from "@/core/copy";

import { cardSurface } from "./cardStyles";
import { Link } from "./Link";
import { figures, Goal, look, sideMarks } from "./SpielRow";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { Figures, SpielRowProps, SpielSide } from "./SpielRow";

const card = tv({
  extend: sideMarks,
  slots: {
    // 6 px between the plaque and the figure on a phone, so a two-digit figure fits the card inside its padding.
    line: "flex min-h-6 min-w-0 items-center justify-between gap-1.5 lg:gap-2",
    name: "flex min-w-0 items-center gap-2",
    goals: "whitespace-nowrap",
  },
});

function Line({ side, score, part }: { side: SpielSide; score: Figures; part: "home" | "away" }) {
  const marks = look(score, part);
  // A card sets both figures bold whatever the outcome, a shoot-out loser's included, where a match row sets
  // that loser's goals regular: with the shoot-out's goals added, the higher figure is the winner's.
  const style = card({ ...marks, goals: marks.goals === "lost" ? "counted" : marks.goals });
  const name = textOf(side.name);
  return (
    <span className={style.line()}>
      <span className={style.name()}>
        <TeamPlaque plaque={side.plaque} />
        {/* A phone's card draws the plaque alone, the name still the link's words for a screen reader; desktop
            sets the name, or a side's source, beside it, cut with „…“ and whole in its title. */}
        <span
          title={name}
          className="min-w-0 truncate max-lg:sr-only">
          {name}
        </span>
      </span>
      <Goal
        score={score}
        part={part}
        className={style.goals()}
      />
    </span>
  );
}

/**
 * A knockout match in the bracket, the whole card a link to it. Every card is the same size: one figure
 * per side, a shoot-out's goals added, with no mark for it, both figures bold; on desktop the date under a
 * hairline.
 */
export function BracketCard({
  href,
  when,
  home,
  away,
  result,
  anchor,
}: {
  /** The card's fragment, so a link elsewhere, such as a club's line in a match head, opens the tree at it. */
  anchor?: string;
  href: Route;
  when: Copy;
  home: SpielSide;
  away: SpielSide;
  result?: SpielRowProps["result"];
}) {
  const score = figures(result);
  return (
    <div
      id={anchor}
      className={cardSurface({ class: "kit-target overflow-hidden text-sm" })}>
      <Link
        href={href}
        placement="card">
        <span className="grid gap-1 p-2 lg:px-3 lg:py-3">
          <Line
            side={home}
            score={score}
            part="home"
          />
          <Line
            side={away}
            score={score}
            part="away"
          />
          <span className="mt-1 border-t border-border pt-2 font-numeric text-xs text-fg-muted max-lg:hidden">{when}</span>
        </span>
      </Link>
    </div>
  );
}
