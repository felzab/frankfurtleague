import { cardSurface } from "./cardStyles";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { RecordText } from "@/core/copy";

// The box, the gap and the name's size are the first line of `ClubHead`, so a club is headed alike on its public page
// and in its own area.
const teamHead = tv({
  slots: {
    root: cardSurface({ class: "flex min-w-0 items-center gap-3 p-4" }),
    name: "min-w-0 text-base font-semibold break-words",
  },
});

/**
 * A team's head over its own Übersicht: its plaque and its full name, which tell a person holding seats in two teams
 * whose area this is. The name is a heading one rung under the frame's title, as a card's title is, and wraps where
 * it is long: nothing else in the area spells it out, and what a cut name hides no touch can reach.
 */
export function TeamHead({ plaque, name }: { plaque: RecordText; name: RecordText }) {
  const s = teamHead();
  return (
    <div className={s.root()}>
      <TeamPlaque plaque={plaque} />
      <h2 className={s.name()}>{name.record}</h2>
    </div>
  );
}

/** The head while its team is read: the plaque and the name's line, as bars. */
export function TeamHeadPlaceholder() {
  const s = teamHead();
  return (
    <div className={s.root()}>
      <span className={placeholderBar("h-6 w-10")} />
      <PlaceholderLine
        text={s.name()}
        width="w-28"
      />
    </div>
  );
}
