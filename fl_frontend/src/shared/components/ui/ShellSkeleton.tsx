/**
 * The layout-level Suspense fallback (ledger NEW-T3).
 *
 * `loading.tsx` and the layout's boundary do not conflict — they nest, and cover different
 * transitions: `loading.tsx` covers navigation *between segments*, the boundary covers streaming
 * *within* a render. But both used to render the same full-viewport `PageLoader`, and at the layout
 * level that is the wrong message: the shell is already painted, and what is still assembling is
 * the content region (for `admin/layout.tsx`, `AdminContextWrapper`'s three FastAPI round-trips).
 *
 * A content-shaped skeleton says that instead. Pattern follows the one real skeleton the app
 * already had, `Sidemenu.tsx`'s `bg-muted animate-pulse` block.
 */
export function ShellSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex w-full flex-1 flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col gap-3">
        <div className="bg-muted h-8 w-1/3 animate-pulse rounded-xl" />
        <div className="bg-muted h-4 w-1/2 animate-pulse rounded-lg" />
      </div>
      <div className="bg-muted h-12 w-full max-w-md animate-pulse rounded-xl" />
      <div className="bg-muted h-64 w-full animate-pulse rounded-2xl" />
    </div>
  );
}
