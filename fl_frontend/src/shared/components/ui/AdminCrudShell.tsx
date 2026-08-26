import type { ReactNode } from "react";

/**
 * The static half of an admin CRUD page, and **it carries no heading** — the sidemenu structure declares the route's name.
 * Deliberately hook-free: it renders outside the `Suspense` covering the data, so anything dynamic pulls the page in.
 */
export function AdminCrudShell({
  search,
  createModal,
  children,
}: {
  /** The slice's search field — an `AdminCrudSearch`, synced with the view through the URL. */
  search: ReactNode;
  /**
   * The slice's Create modal, owning its own trigger and overlay state. Left out rather than passed
   * empty by a surface that creates nothing: the type is what says so, where a placeholder would say
   * only that somebody had to pass something.
   */
  createModal?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The gutter sits outside the cap, so `max-w-page` measures content rather than content plus padding
    // (`EditFormLayout` splits the same way).
    <div className="w-full p-6 sm:p-8">
      {/* The placeholder's minimum runs here because this mounts when the navigation starts, which is the clock
          the region below the boundary cannot read for itself (`globals.css`). It paints nothing, and the property
          it animates inherits to `children`. */}
      <div className="animate-admin-placeholder-hold max-w-page mx-auto flex w-full flex-col gap-8">
        {/* Below `sm` the two are one joined control, sharing a seam with no gap; the corner and label flattening
            live in `SearchBar` and `formButton`'s trigger. From `sm` they separate. */}
        <div className="flex w-full flex-row items-center gap-0 sm:justify-between sm:gap-3">
          {search}
          {createModal}
        </div>

        {children}
      </div>
    </div>
  );
}
