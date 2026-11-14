import { COPY } from "@/core/copy";

import { Link } from "./Link";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

/**
 * The league's three ways to write to it, on one line, all three the control's height: the e-mail button led
 * by the mail glyph, then Instagram and Threads as glyphs alone, each named by its tooltip and opening in a new tab, as `Link`
 * opens every other site.
 */
export function SocialButtons({
  email,
  instagram,
  threads,
}: {
  /** The mail link, its words the address. */
  email: { label: Copy; href: Route };
  instagram: Route;
  threads: Route;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={email.href}
        placement="button"
        look="secondary"
        leadingIcon="email"
        label={email.label}
      />
      <Link
        href={instagram}
        placement="icon"
        icon="instagram"
        label={COPY.template.instagram}
      />
      <Link
        href={threads}
        placement="icon"
        icon="threads"
        label={COPY.template.threads}
      />
    </div>
  );
}
