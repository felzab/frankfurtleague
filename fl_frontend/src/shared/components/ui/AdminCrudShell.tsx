import type { ReactNode } from "react";

/**
 * The static half of an admin CRUD page: heading, description, create trigger.
 *
 * Split out of `AdminCrudView`. None of this depends on the resource list, but it used
 * to be props on a client element the page built only *after* `await getSchiedsrichter()` — so the
 * page title waited on a FastAPI round-trip it had no need of. Rendered above the data boundary, it
 * paints as soon as the session check resolves and the table streams in behind it.
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
  title,
  description,
  createModal,
  children,
}: {
  title: string;
  description: string;
  /** The slice's Create modal, which owns its own trigger button and overlay state. */
  createModal: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="max-w-page mx-auto flex w-full flex-col gap-8 p-6 sm:p-8">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <h1 className="text-fluid-xl text-foreground font-extrabold tracking-tight">{title}</h1>
          <p className="text-fluid-sm text-foreground-muted mt-1 font-medium">{description}</p>
        </div>
        {createModal}
      </div>

      {children}
    </div>
  );
}
