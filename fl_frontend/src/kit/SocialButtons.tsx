import { COPY } from "@/core/copy";

import { buttonLook, buttonPlaceholder } from "./buttonStyles";
import { Icon } from "./Icon";
import { Link } from "./Link";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

/** The three ways while the page around them is read: the e-mail button by its words, and the two glyphs' places. */
export function SocialButtonsPlaceholder({ email }: { email: Copy }) {
  const glyph = buttonLook({ look: "placeholder", class: "w-8 px-0 pointer-coarse:w-10" });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={buttonPlaceholder()}>
        <Icon
          glyph="email"
          size={16}
        />
        {email}
      </span>
      <span className={glyph} />
      <span className={glyph} />
    </div>
  );
}

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
