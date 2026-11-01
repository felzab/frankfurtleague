import { COPY } from "@/core/copy";

import { Link } from "./Link";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { IconName } from "./Icon";

/**
 * The league's three ways to write to it, on one line, all three the control's height: the e-mail button,
 * then Instagram and Threads as glyphs alone, each named by its tooltip and opening in a new tab, as the
 * kit's other links to another site do.
 */
export function SocialButtons({
  email,
  instagram,
  threads,
}: {
  /**
   * The mail link, its words the address. Board: whether it leads with a glyph, and which, is owed; it
   * ships without one.
   */
  email: { label: Copy; href: Route; glyph?: IconName };
  instagram: Route;
  threads: Route;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={email.href}
        placement="button"
        look="secondary"
        leadingIcon={email.glyph}
        label={email.label}
      />
      <Link
        href={instagram}
        placement="icon"
        newTab
        icon="instagram"
        label={COPY.template.instagram}
      />
      <Link
        href={threads}
        placement="icon"
        newTab
        icon="threads"
        label={COPY.template.threads}
      />
    </div>
  );
}
