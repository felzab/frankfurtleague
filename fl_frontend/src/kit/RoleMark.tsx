import { tv } from "./tv";

import type { Copy } from "@/core/copy";

// The chip's height, so the mark stands on a name's line as a chip does, and square at one letter. The fill is the
// primary button's and its letters white, which keep their light values in the dark theme, so the mark is the same in
// both and wears no status hue.
const roleMark = tv({
  base: "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-brand-solid px-1 font-numeric text-xs font-semibold text-on-brand",
});

/** What a block carrying a person's name takes in its `mark` prop: the letters drawn, and the role they stand for. */
export type RoleMarkProps = {
  /** The role's letters, „C“ or „Co“. */
  letters: Copy;
  /** The role in a word, „Kapitän“, which a screen reader hears in the letters' place. */
  label: Copy;
};

/**
 * The role a player holds in a squad, as the armband says it: a small boxed letter directly after the name, before any
 * chip, which stays whole where a long name is cut. A page never places one: the blocks that carry a name render it
 * from their `mark` prop.
 */
export function RoleMark({ letters, label }: RoleMarkProps) {
  return (
    <span className={roleMark()}>
      <span aria-hidden>{letters}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
