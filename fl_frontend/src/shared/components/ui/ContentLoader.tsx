/**
 * The content-area loader (ledger NEW-T3/NEW-F5) — deliberately a different shape from
 * `PageLoader`'s ringed spinner, because the two appear in different situations and the owner
 * wants them tellable at a glance: `PageLoader` = a whole page is loading (root `loading.tsx`);
 * this = the shell is already painted and only the content region is streaming (the dashboard and
 * admin `loading.tsx` files plus the two layout-level Suspense boundaries).
 *
 * Three staggered bouncing dots in the landing page's `bg-brand-solid` dot language. No text —
 * the a11y name comes from the label; sighted users get the distinct shape instead.
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
