import Link from "next/link";

import { FLLogo } from "./FLLogo";

/**
 * The Frankfurt-League mark and wordmark, linking home.
 *
 * One component because there is only one of these in the design, and it was drifting across four
 * sites: the topnav and the footer used `fluid-lg tracking-tighter`, the sidemenu's desktop
 * header inherited the body size with `tracking-tight`, and the mobile drawer put a `size-8` logo
 * inside a `h-7 w-7` box so it overflowed its own container. Navigating from a public route into the
 * dashboard visibly shifted the wordmark. The type is now decided here, once.
 *
 * Every use of the logo-plus-name pair is a link to the landing page, so the link is part of the
 * component rather than something each caller re-wires. `title` stays per-caller: "Startseite" is
 * right from a public route, "Zur öffentlichen Website" from inside the dashboard shell.
 */
export function BrandLink({
  title = "Startseite",
  /** Drops the wordmark at every width, for a rail too narrow to hold it. */
  hideName = false,
  /**
   * Classes for the wordmark alone, so a caller can hide it at some widths and not others —
   * `AppTopBar` passes `hidden lg:inline`, because on a phone the page title needs the room the
   * wordmark would take.
   *
   * **One link either way, rather than two rendered at different breakpoints.** A second copy of the
   * mark would be a second stop in the tab order and a second announcement of the same destination.
   */
  nameClassName = "",
  className = "",
  /**
   * Runs as this link navigates, and never on a press the browser turns into a new tab, a new window
   * or a download. Optional because only a caller rendering this inside something dismissable has
   * anything to run — `SidemenuDrawerHeader` is the one that does.
   */
  onNavigate,
}: {
  title?: string;
  hideName?: boolean;
  nameClassName?: string;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href="/"
      title={title}
      onNavigate={onNavigate}
      className={`fluid-lg text-foreground flex items-center font-bold tracking-tight transition-opacity hover:opacity-80 ${
        hideName ? "justify-center" : "gap-2"
      } ${className}`}>
      <FLLogo />
      {!hideName && <span className={nameClassName}>Frankfurt-League</span>}
    </Link>
  );
}
