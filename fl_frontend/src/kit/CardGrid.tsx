import { BlockBox } from "./BlockBox";
import { CardLink } from "./Card";
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
 * Cards side by side: one column in a box narrower than 42 rem, `across` from it. The box decides, not the screen,
 * since the rail resizes it under one viewport.
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
    <BlockBox>
      <div className={grid({ across })}>{children}</div>
    </BlockBox>
  );
}

/** The role chooser's places, each a card linking it, the page arriving whole with them. */
export async function RoleChoices({ choices }: { choices: Promise<ReadonlyArray<CardLinkProps>> }) {
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
