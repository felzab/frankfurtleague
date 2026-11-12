import { cardSurface } from "./cardStyles";
import { tv } from "./tv";

import type { Copy, RecordText } from "@/core/copy";

/** One of the people running the league: their first name and what they do. */
type Organiser = { name: RecordText; role: Copy };

const row = tv({
  slots: {
    // The box's own width decides its columns (`@container` on its holder): two on a phone, four from 32 rem, so the
    // eight people stand in rows that each fill, every entry under the one above it. A phone's 360 px holds two only at
    // the 16-px inset, where a longer name is cut with „…“ rather than widening its column.
    box: "@container",
    root: `grid grid-cols-2 gap-x-4 gap-y-4 ${cardSurface()} p-4 @lg:grid-cols-4 @lg:gap-x-6 @lg:p-6`,
    person: "flex min-w-0 items-center gap-2.5",
    // The avatar, the first letter of the name in a 40-px circle, as the account row draws one.
    avatar: "flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-muted font-numeric text-sm font-semibold",
    words: "grid min-w-0",
    name: "truncate text-sm font-semibold",
    role: "truncate text-xs text-fg-muted",
  },
});

/** The people who run the league, in columns of one width, each beside a mark of their first letter: on the landing and on About. */
export function Organisers({ people }: { people: readonly Organiser[] }) {
  const slots = row();
  return (
    <div className={slots.box()}>
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
            <span className={slots.words()}>
              <span className={slots.name()}>{person.name.record}</span>
              <span className={slots.role()}>{person.role}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
