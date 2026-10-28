import NextLink from "next/link";

import { tv } from "tailwind-variants/lite";

import { buttonLook } from "./buttonStyles";

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
      // A page's one next step, drawn as the primary button: a status card's and a mailed page's way on.
      button: buttonLook({ look: "primary", host: "link" }),
    },
  },
});

// The focus file's mark for each placement: a ring hugging the words, a ring with its gap, a ring drawn
// inside the row the link covers, or one inside the card, which a list's card would otherwise clip; a link
// drawn as a button rings as a button does.
const FOCUS = { text: "text", standalone: "ring", row: "row", card: "inset", button: "ring" } as const;

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
  fullPage = false,
  ...content
}: {
  href: Route<T>;
  /** Opens the target in a new tab; nothing else does. */
  newTab?: boolean;
  /**
   * Loads the target as a whole document, the plain anchor's navigation, rather than Next's client one. An
   * intercepting route catches every client navigation to its address, so this is the one way from a pop-up
   * to the page it stands for: Next shows that page, not the pop-up, on a full page load.
   */
  fullPage?: boolean;
} & (
  | ({
      /** `row` only inside a table row, which `Table` writes; `button` for a page's one next step. */
      placement: "text" | "standalone" | "row" | "button";
    } & Words)
  | Card
)) {
  const anchor = {
    href,
    "data-kit-focus": FOCUS[placement],
    className: link({ placement }),
    target: newTab ? "_blank" : undefined,
    rel: newTab ? "noopener noreferrer" : undefined,
  };
  const words = content.children ?? content.label ?? content.text;
  return fullPage ? <a {...anchor}>{words}</a> : <NextLink {...anchor}>{words}</NextLink>;
}
