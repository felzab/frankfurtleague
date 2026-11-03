import { cardSurface } from "./cardStyles";
import { tv } from "./tv";

import type { Copy, RecordText } from "@/core/copy";

/** One of the people running the league: their first name and what they do. */
type Organiser = { name: RecordText; role: Copy };

const row = tv({
  slots: {
    root: `flex flex-wrap items-center gap-x-6 gap-y-4 ${cardSurface()} p-6`,
    person: "flex items-center gap-2.5",
    // Board: the avatar, the first letter of the name in a 40-px circle, as the account row draws one.
    avatar: "flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-muted font-numeric text-sm font-semibold",
    name: "text-sm font-semibold",
    role: "text-xs text-fg-muted",
  },
});

/** The people who run the league, in one row that wraps, each beside a mark of their first letter: on the landing and on About. */
export function Organisers({ people }: { people: readonly Organiser[] }) {
  const slots = row();
  return (
    <ul className={slots.root()}>
      {people.map((person) => (
        <li
          key={person.name.record}
          className={slots.person()}>
          <span
            aria-hidden
            className={slots.avatar()}>
            {person.name.record.charAt(0)}
          </span>
          <span className="grid">
            <span className={slots.name()}>{person.name.record}</span>
            <span className={slots.role()}>{person.role}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
