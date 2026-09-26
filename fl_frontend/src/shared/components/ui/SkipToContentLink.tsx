/**
 * The bypass link every layout renders first, without which a keyboard user Tabs the whole chrome on every navigation.
 * The fill is the `brand-solid` pair — `brand` flips per theme and would carry its foreground at about 2:1 in dark.
 */
export function SkipToContentLink({
  isTargetInert,
}: {
  /**
   * A bypass into an inert target takes the reader nowhere and reports nothing, so the link goes
   * inert with `#main-content` wherever a shell covers it.
   */
  isTargetInert: boolean;
}) {
  return (
    <a
      href="#main-content"
      inert={isTargetInert}
      className="sr-only rounded-md bg-brand-solid px-4 py-2 fluid-sm font-bold text-brand-solid-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-60">
      Zum Inhalt springen
    </a>
  );
}
