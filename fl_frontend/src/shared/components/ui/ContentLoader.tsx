/**
 * SHARED · content-area loader
 *
 * Deliberately a different shape from `PageLoader`'s ringed spinner, so the two are tellable at
 * a glance: `PageLoader` means a whole page is loading; this means the shell is painted and only
 * the content region is streaming. Three staggered bouncing dots in the landing page's
 * `bg-brand-solid` dot language; no text — the a11y name comes from the label.
 */
export function ContentLoader() {
  return (
    <div
      role="status"
      aria-label="Inhalte werden geladen"
      className="flex w-full flex-1 items-center justify-center gap-x-1.5 px-4 py-16">
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.4s]" />
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.2s]" />
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full" />
    </div>
  );
}
