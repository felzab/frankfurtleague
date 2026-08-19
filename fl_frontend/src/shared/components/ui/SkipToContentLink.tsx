/**
 * The bypass link every layout renders first, without which a keyboard user Tabs the whole chrome on every navigation.
 * The fill is the `brand-solid` pair — `brand` flips per theme and would carry its foreground at about 2:1 in dark.
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
