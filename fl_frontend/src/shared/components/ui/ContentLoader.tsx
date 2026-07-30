/**
 * The layout-level Suspense fallback (ledger NEW-T3, owner decision 2026-07-31).
 *
 * `loading.tsx` and the layout boundary cover different transitions — segment navigation vs
 * streaming within a render — but both used to show the identical full-page `PageLoader`. At the
 * layout level the shell is already painted, so this is `PageLoader`'s quieter sibling: the same
 * brand spinner at reduced size, no ping ring, one line of text. Same family, clearly lighter.
 */
export function ContentLoader() {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-y-3 px-4 py-16 text-center">
      <div className="border-border border-t-brand size-8 animate-spin rounded-full border-[3px]" />
      <p className="text-fluid-xs text-foreground-muted font-medium">Inhalte werden geladen...</p>
    </div>
  );
}
