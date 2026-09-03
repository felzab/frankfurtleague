import Link from "next/link";

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
      className={`fluid-lg text-foreground flex items-center font-bold tracking-tight transition-opacity hover:opacity-80 ${
        hideName ? "justify-center" : "gap-2"
      } ${className}`}>
      <FLLogo />
      {!hideName && <span>Frankfurt-League</span>}
    </Link>
  );
}
