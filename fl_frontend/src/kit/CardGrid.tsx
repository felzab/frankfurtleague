import { Suspense } from "react";

import { CardLink, CardPlaceholder } from "./Card";
import { Waiting } from "./Skeleton";
import { tv } from "./tv";

import type { ReactNode } from "react";
import type { CardLinkProps } from "./Card";

const grid = tv({
  base: "grid gap-6",
  variants: {
    across: {
      2: "@2xl:grid-cols-2",
      3: "@2xl:grid-cols-3",
    },
  },
});

/**
 * Cards side by side, as the administrator's Übersicht sets its four kinds of open work: one column in a box narrower
 * than 42 rem, `across` from it, two by default and three for the role chooser's short cards, 24 px apart as a page's
 * sections are. The box decides, not the screen, since the rail resizes it under one viewport. Two cards sharing a row
 * stand as tall as each other, each packing its rows at its top (`card`), the spare height left empty
 * under them.
 */
export function CardGrid({
  across = 2,
  children,
}: {
  across?: 2 | 3;
  /** The kit's `Card`s, in their order of reading. */
  children: ReactNode;
}) {
  return (
    // The container the grid's columns read, since a query reads an ancestor; `w-full`, since a container's width counts
    // none of its content, and a parent starting its children would shrink it to nothing.
    <div className="@container w-full">
      <div className={grid({ across })}>{children}</div>
    </div>
  );
}

/** The chooser's cards once the person's places are read. */
async function RoleChoicesOnceRead({ choices }: { choices: Promise<ReadonlyArray<CardLinkProps>> }) {
  return (
    <CardGrid across={3}>
      {(await choices).map((choice) => (
        <CardLink
          key={choice.href}
          {...choice}
        />
      ))}
    </CardGrid>
  );
}

/**
 * The role chooser's places, each a card linking it, read in a boundary of their own under the titled strip. Meanwhile
 * two cards stand, the fewest a person reaching the chooser holds, each its title's bar over its line's.
 */
export function RoleChoices({ choices }: { choices: Promise<ReadonlyArray<CardLinkProps>> }) {
  return (
    <Suspense
      fallback={
        <Waiting>
          <CardGrid across={3}>
            <CardPlaceholder line />
            <CardPlaceholder line />
          </CardGrid>
        </Waiting>
      }>
      <RoleChoicesOnceRead choices={choices} />
    </Suspense>
  );
}
