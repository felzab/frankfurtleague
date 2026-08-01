import { card } from "./card";

/** Header cells are label-width, body cells are content-width — enough variation to read as a table. */
const HEADER_CELL_WIDTHS = ["w-28", "w-24", "w-32", "w-20", "w-16"];
const BODY_CELL_WIDTHS = ["w-40", "w-36", "w-44", "w-28", "w-10"];

/**
 * What an admin CRUD page shows while its rows are in flight.
 *
 * **Everything here is inert on purpose**, which is also why it needs no `"use client"`. A working-
 * looking control that swallows input is worse than no control.
 *
 * **It must not call a request-dynamic hook.** This is a `Suspense` fallback, and one that reaches
 * for `useSearchParams` suspends too — pushing the bailout up to the boundary above and undoing the
 * split that keeps the static chrome outside the data hole.
 *
 * Three things keep the hand-over from reading as a flicker: `AdminCrudView` animates in rather than
 * appearing; `delay-200 fill-mode-both` holds this at `opacity: 0` so a fast navigation never paints
 * it; and it mirrors the real table's shell, header strip and row rhythm so nothing resizes.
 */
export function AdminCrudFallback() {
  return (
    <div
      role="status"
      aria-label="Daten werden geladen"
      className="animate-in fade-in fill-mode-both flex flex-col gap-8 delay-200 duration-150">
      {/* The search field's silhouette — same height, radius, border and width cap as `SearchBar`. */}
      <div className="bg-surface border-border h-12 w-full max-w-md rounded-xl border shadow-sm lg:h-15" />

      <div className={`${card()} h-fit w-full overflow-hidden p-0`}>
        <div className="bg-muted border-border flex items-center gap-6 border-b px-6 py-4">
          {HEADER_CELL_WIDTHS.map((width) => (
            <div
              key={width}
              className={`bg-foreground-muted/25 h-3 rounded ${width}`}
            />
          ))}
        </div>

        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="border-border/50 flex items-center gap-6 border-b px-6 py-4 last:border-b-0">
            {BODY_CELL_WIDTHS.map((width) => (
              <div
                key={width}
                className={`bg-muted h-4 animate-pulse rounded ${width}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
