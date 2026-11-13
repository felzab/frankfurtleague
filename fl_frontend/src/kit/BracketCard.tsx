import { textOf } from "@/core/copy";

import { cardSurface } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { Link } from "./Link";
import { figures, goalsOf, look, sideMarks } from "./SpielRow";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { Figures, SpielRowProps, SpielSide } from "./SpielRow";

/*
 * The card takes its form from the box of the tree it stands in, never from its own, since its own width is the
 * form's result: a tree narrower than 42 rem draws the narrow card, of plaques alone.
 */
const card = tv({
  extend: sideMarks,
  slots: {
    // 6 px between the plaque and the figure on the narrow card, so a two-digit figure fits the card inside its padding.
    line: "flex min-h-6 min-w-0 items-center justify-between gap-1.5 @2xl:gap-2",
    side: "flex min-w-0 items-center gap-2",
    // The narrow card draws the plaque alone, the name still the link's words for a screen reader.
    name: "min-w-0 truncate @max-2xl:sr-only",
    goals: "whitespace-nowrap",
    // One column the card's width and no wider, so a long name, or a date beside a chip, is cut rather than pushing the
    // figures out of the card.
    body: "grid grid-cols-[minmax(0,1fr)] gap-1 p-2 @2xl:px-3 @2xl:py-3",
    // The narrow card has no room for the line, which a screen reader still hears there: the date and what befell the
    // match.
    when: "mt-1 border-t border-border pt-2 font-numeric text-xs text-fg-muted @max-2xl:sr-only",
    // A chip's height whether a chip stands on it or not, so every card of the tree stays one size.
    whenLine: "flex h-5 items-center justify-between gap-2",
    date: "min-w-0 truncate",
  },
});

type LineProps = { side: SpielSide; score: Figures; part: "team1" | "team2" } & Pick<SpielRowProps, "muted" | "absent">;

function Line({ side, score, part, muted = false, absent }: LineProps) {
  const marks = look(score, part);
  const struck = absent === part;
  // A card sets both figures bold whatever the outcome, a shoot-out loser's included, where a match row sets
  // that loser's goals regular: with the shoot-out's goals added, the higher figure is the winner's.
  const style = card({ ...marks, goals: marks.goals === "lost" ? "counted" : marks.goals, muted, struck });
  const name = textOf(side.name);
  return (
    <span className={style.line()}>
      <span className={style.side()}>
        <TeamPlaque
          plaque={side.plaque}
          muted={muted}
          struck={struck}
        />
        {/* The wide card sets the name, or a side's source, beside the plaque, cut with „…“ and whole in its title while
            it is cut. */}
        <CutText
          text={name}
          className={style.name()}
        />
      </span>
      <span className={style.goals()}>{goalsOf(score, part)}</span>
    </span>
  );
}

/**
 * A knockout match in the bracket, the whole card a link to it, or opening nothing where it has no `href`. Every card is the same size: one figure
 * per side, a shoot-out's goals added, with no mark for it, both figures bold; on the wide card the date under a
 * hairline. Something befell the match as a match row draws it (`SpielRow`): both sides muted, the side that did not
 * turn up struck, and on the wide card the event's chip at the date line's end, the date cut with „…“ beside a long
 * one; the narrow card, of plaques alone, has no room for a chip, so its plaques carry the muting and the strike, and
 * its date line, chip included, is heard by a screen reader alone.
 */
export function BracketCard({
  href,
  when,
  team1,
  team2,
  result,
  chip,
  muted,
  absent,
  anchor,
}: {
  /** The card's fragment, so a link elsewhere, such as a club's line in a match head, opens the tree at it. */
  anchor?: string;
  /** The match's page; absent where it has none to open yet, as a match row's (`SpielRow`), the card then opening nothing. */
  href?: Route;
  when: Copy;
  team1: SpielSide;
  team2: SpielSide;
} & Pick<SpielRowProps, "result" | "chip" | "muted" | "absent">) {
  const score = figures(result);
  const style = card();
  const event = { muted, absent };
  const body = (
    <span className={style.body()}>
      <Line
        side={team1}
        score={score}
        part="team1"
        {...event}
      />
      <Line
        side={team2}
        score={score}
        part="team2"
        {...event}
      />
      <span className={style.when()}>
        <span className={style.whenLine()}>
          <span className={style.date()}>{when}</span>
          {chip !== undefined && <Chip {...chip} />}
        </span>
      </span>
    </span>
  );
  return (
    <div
      id={anchor}
      className={cardSurface({ class: "kit-target overflow-hidden text-sm" })}>
      {href === undefined ? (
        body
      ) : (
        <Link
          href={href}
          placement="card">
          {body}
        </Link>
      )}
    </div>
  );
}
