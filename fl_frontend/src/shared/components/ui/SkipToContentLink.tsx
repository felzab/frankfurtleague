/**
 * SHARED · skip-to-content link
 *
 * The bypass link every layout renders first. Without it a keyboard user Tabs eleven stops of
 * chrome before the content, on every navigation.
 *
 * Invariants:
 * - `sr-only` until focused, then absolute over the chrome rather than displacing it.
 * - The fill is the `brand-solid` pair — `brand` would carry white text at ~2:1 in dark mode.
 */
export function SkipToContentLink() {
  return (
    <a
      href="#main-content"
      className="bg-brand-solid text-brand-solid-foreground fluid-sm sr-only rounded-md px-4 py-2 font-bold focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-60">
      Zum Inhalt springen
    </a>
  );
}
