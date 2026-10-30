import { Link } from "./Link";
import { figures, look, NONE, sideMarks } from "./MatchRow";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Route } from "next";
import type { Figures, SpielRowProps, SpielSide } from "./MatchRow";

const card = tv({
  extend: sideMarks,
  slots: {
    line: "flex min-h-6 min-w-0 items-center justify-between gap-2",
    name: "flex min-w-0 items-center gap-2",
    goals: "whitespace-nowrap",
  },
});

function Line({ side, score, part }: { side: SpielSide; score: Figures; part: "home" | "away" }) {
  const style = card(look(score, part));
  return (
    <span className={style.line()}>
      <span className={style.name()}>
        <TeamPlaque {...side.plaque} />
        {/* A phone's card shows the plaque alone; desktop sets the name, or a side's source, beside it. */}
        <span className="min-w-0 truncate max-lg:hidden">{side.name}</span>
      </span>
      <span className={style.goals()}>{score === null ? NONE : score[part]}</span>
    </span>
  );
}

/**
 * A knockout match in the bracket, the whole card a link to it. Every card is the same size: one figure
 * per side, a shoot-out's goals added, with no mark for it; on desktop the date under a hairline.
 */
export function BracketCard({
  href,
  when,
  home,
  away,
  result,
}: {
  href: Route;
  when: string;
  home: SpielSide;
  away: SpielSide;
  result?: SpielRowProps["result"];
}) {
  const score = figures(result);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg text-sm">
      <Link
        href={href}
        placement="card">
        <span className="grid gap-1 p-2 max-[23.125rem]:px-1 lg:px-3 lg:py-3">
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
