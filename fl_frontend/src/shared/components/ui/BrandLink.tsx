import Link from "next/link";

import { WORDMARK } from "./displayType";
import { FLLogo } from "./FLLogo";

/**
 * The mark and wordmark, linking home. The type is decided here so navigating between shells cannot shift it. `title`
 * stays per-caller, since where the reader comes from decides what "home" is called.
 */
export function BrandLink({
  title = "Startseite",
  hideName = false,
  className = "",
  onNavigate,
}: {
  title?: string;
  /**
   * Drops the wordmark at every width, for a rail too narrow to hold it. One link either way: a second copy at
   * another breakpoint would be a second tab stop announcing the same destination.
   */
  hideName?: boolean;
  className?: string;
  /** Runs as this link navigates, and never on a press the browser turns into a new tab or a download. */
  onNavigate?: () => void;
}) {
  return (
    <Link
      href="/"
      title={title}
      onNavigate={onNavigate}
      className={`text-foreground flex items-center transition-opacity hover:opacity-80 ${hideName ? "justify-center" : "gap-2"} ${className}`}>
      <FLLogo className="text-brand-solid dark:text-brand h-8 w-auto" />

      {/* The capitals are CSS, so a copy sweep finds the name as the league spells it. */}
      {!hideName && <span className={`${WORDMARK} fluid-lg`}>Frankfurt League</span>}
    </Link>
  );
}
