/**
 * The bypass link every layout renders first.
 *
 * Without it a keyboard user on a dashboard route Tabs the logo, the season selector, all seven nav
 * items and both footer controls — eleven stops — before reaching the page content, and repeats the
 * whole run on every navigation.
 *
 * `sr-only` until focused, then `not-sr-only` plus absolute positioning so it appears over the
 * chrome rather than displacing it. The fill uses `brand-solid`/`brand-solid-foreground`, not
 * `brand`: the convention is that opaque fills behind text take the solid pair, and `brand`
 * is the light dark-mode value that would carry white text at ~2:1.
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
