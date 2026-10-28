import { AdminCrudPrivateQuery } from "./AdminCrudPrivateQuery";

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
  /** The slice's search field — an `AdminCrudSearch`, joined to the view through the query this shell holds. */
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
      {/* The placeholder's minimum runs here because this mounts when the page arrives, ahead of the rows the
          boundary below waits on, which mount too late to start it (`globals.css`). It paints nothing; the property
          it animates inherits to `children`. */}
      <div className="mx-auto flex w-full max-w-page animate-admin-placeholder-hold flex-col gap-8">
        {/* Around both halves on every page, the only ancestor the bar and the list share: what is typed stays
            in the page and never reaches the URL. */}
        <AdminCrudPrivateQuery>
          {/* Below `sm` the two are one joined control, sharing a seam with no gap; the corner and label flattening
              live in `SearchBar` and `formButton`'s trigger. From `sm` they separate. */}
          <div className="flex w-full flex-row items-center gap-0 sm:justify-between sm:gap-3">
            {search}
            {createModal}
          </div>

          {children}
        </AdminCrudPrivateQuery>
      </div>
    </div>
  );
}
