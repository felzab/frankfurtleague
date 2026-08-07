import type { ReactNode } from "react";

/**
 * The static half of an admin CRUD page: the page frame and the create trigger.
 *
 * Separate from `AdminCrudView` because neither depends on the resource list. Rendered above the
 * data boundary, the trigger paints as soon as the session check resolves and the table streams in
 * behind it.
 *
 * **It carries no heading.** The route's name and its explanation are declared once, in
 * `ADMIN_SIDEMENU_STRUCTURE`, and rendered by the shell's bar — so the title an admin reads and the
 * nav item they clicked cannot say different things.
 *
 * A server component, and deliberately hook-free: it is rendered outside the `Suspense` that covers
 * the data, so anything dynamic in here would pull the whole page back into one hole.
 *
 * **It does not reach the build-time static shell**, and cannot: `AdminAuthGuard` wraps all admin
 * page content, so nothing under `/admin` renders until the session is known. That is the intended
 * trade — one guard that a new route inherits automatically, rather than a per-page guard that can
 * be forgotten.
 */
export function AdminCrudShell({
  search,
  createModal,
  children,
}: {
  /** The slice's search field — an `AdminCrudSearch`, synced with the view through the URL. */
  search: ReactNode;
  /** The slice's Create modal, which owns its own trigger button and overlay state. */
  createModal: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="max-w-page mx-auto flex w-full flex-col gap-8 p-6 sm:p-8">
      {/* One row (owner, 2026-08-07): with the page descriptions gone, nothing separates the search
          from the create trigger, and neither depends on the resource list — the whole row paints
          before the table streams in. Stacked on a phone, side by side from `sm`. */}
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {search}
        {createModal}
      </div>

      {children}
    </div>
  );
}
