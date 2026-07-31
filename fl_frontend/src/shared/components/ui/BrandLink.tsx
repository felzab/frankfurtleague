import Link from "next/link";

import { FLLogo } from "./FLLogo";

/**
 * The Frankfurt-League mark and wordmark, linking home.
 *
 * One component because there is only one of these in the design, and it was drifting: the topnav
 * used `text-fluid-lg tracking-tighter`, the sidemenu's desktop header inherited the body size with
 * `tracking-tight`, and the mobile drawer put a `size-8` logo inside a `h-7 w-7` box so it overflowed
 * its own container. Navigating from a public route into the dashboard visibly shifted the wordmark
 * (NEW-R2). The type is now decided here, once.
 *
 * Every use of the logo-plus-name pair is a link to the landing page, so the link is part of the
 * component rather than something each caller re-wires. `title` stays per-caller: "Startseite" is
 * right from a public route, "Zur öffentlichen Website" from inside the dashboard shell.
 */
export function BrandLink({
  title = "Startseite",
  /** The collapsed sidemenu rail is 72px — the mark alone, centred. */
  hideName = false,
  className = "",
}: {
  title?: string;
  hideName?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      title={title}
      className={`text-fluid-lg text-foreground flex items-center font-bold tracking-tight transition-opacity hover:opacity-80 ${
        hideName ? "justify-center" : "gap-2"
      } ${className}`}>
      <FLLogo />
      {!hideName && "Frankfurt-League"}
    </Link>
  );
}
