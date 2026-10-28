import NextLink from "next/link";

import { tv } from "tailwind-variants/lite";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

const link = tv({
  variants: {
    // Underlined inside running text alone; a link standing on its own is known by its place. A row's
    // link is its record's name, stretched over the row it stands in, so the whole row opens the record.
    placement: {
      text: "text-brand underline",
      standalone: "text-brand",
      row: "text-fg after:absolute after:inset-0 after:content-['']",
    },
  },
});

// The focus file's mark for each placement: a ring hugging the words, a ring with its gap, or a ring
// drawn inside the row the link covers.
const FOCUS = { text: "text", standalone: "ring", row: "row" } as const;

/**
 * The one way to go somewhere: Next's link, prefetching on hover and in view, so a page of links loads
 * no React Aria. Its ring comes from `:focus-visible` in the focus file, hugging the words inside text.
 */
export function Link<T extends string>({
  href,
  placement,
  newTab = false,
  ...words
}: {
  href: Route<T>;
  /** `row` only inside a table row, which `Table` writes. */
  placement: "text" | "standalone" | "row";
  /** Opens the target in a new tab; nothing else does. */
  newTab?: boolean;
} & (
  | { /** Catalogue words. */ label: Copy; text?: never }
  | { /** A record's own name, such as a club's or a venue's: data, not catalogue text. */ text: string; label?: never }
)) {
  return (
    <NextLink
      href={href}
      data-kit-focus={FOCUS[placement]}
      className={link({ placement })}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}>
      {words.label ?? words.text}
    </NextLink>
  );
}
