import NextLink from "next/link";

import { tv } from "tailwind-variants/lite";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

const link = tv({
  variants: {
    // Underlined inside running text alone; a link standing on its own is known by its place. A row's
    // link is its record's name, stretched over the row it stands in, so the whole row opens the record.
    // A card's link is the whole card, filling under the pointer as a row does.
    placement: {
      text: "text-brand underline",
      standalone: "text-brand",
      // A row's name takes its row's colour, muted in a row that no longer counts.
      row: "text-inherit after:absolute after:inset-0 after:content-['']",
      card: "block text-fg transition-colors duration-(--motion-state) hover:bg-bg-surface",
    },
  },
});

// The focus file's mark for each placement: a ring hugging the words, a ring with its gap, a ring drawn
// inside the row the link covers, or one inside the card, which a list's card would otherwise clip.
const FOCUS = { text: "text", standalone: "ring", row: "row", card: "inset" } as const;

type Words =
  | { /** Catalogue words. */ label: Copy; text?: never; children?: never }
  | { /** A record's own name, such as a club's or a venue's: data, not catalogue text. */ text: string; label?: never; children?: never };

type Card = {
  placement: "card";
  /**
   * The card's content, which is the link's accessible name, so it is read as one line. Only `MatchRow`
   * and `BracketCard` place a card link, and nothing interactive stands inside one: no button, link or
   * menu, which a link may not contain.
   */
  children: ReactNode;
  label?: never;
  text?: never;
};

/**
 * The one way to go somewhere: Next's link, prefetching on hover and in view, so a page of links loads
 * no React Aria. Its ring comes from `:focus-visible` in the focus file, hugging the words inside text.
 */
export function Link<T extends string>({
  href,
  placement,
  newTab = false,
  ...content
}: {
  href: Route<T>;
  /** Opens the target in a new tab; nothing else does. */
  newTab?: boolean;
} & (
  | ({
      /** `row` only inside a table row, which `Table` writes. */
      placement: "text" | "standalone" | "row";
    } & Words)
  | Card
)) {
  return (
    <NextLink
      href={href}
      data-kit-focus={FOCUS[placement]}
      className={link({ placement })}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}>
      {content.children ?? content.label ?? content.text}
    </NextLink>
  );
}
