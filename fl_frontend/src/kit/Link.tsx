import NextLink from "next/link";

import { tv } from "tailwind-variants/lite";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

const link = tv({
  base: "text-brand",
  variants: {
    // Underlined inside running text alone; a link standing on its own is known by its place.
    placement: {
      text: "underline",
      standalone: "",
    },
  },
});

/**
 * The one way to go somewhere: Next's link, prefetching on hover and in view, so a page of links loads
 * no React Aria. Its ring comes from `:focus-visible` in the focus file, hugging the words inside text.
 */
export function Link<T extends string>({
  href,
  label,
  placement,
  newTab = false,
}: {
  href: Route<T>;
  label: Copy;
  placement: "text" | "standalone";
  /** Opens the target in a new tab; nothing else does. */
  newTab?: boolean;
}) {
  return (
    <NextLink
      href={href}
      data-kit-focus={placement === "text" ? "text" : "ring"}
      className={link({ placement })}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}>
      {label}
    </NextLink>
  );
}
