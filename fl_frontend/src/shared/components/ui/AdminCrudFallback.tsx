"use client";

import { card } from "./card";
import { SearchBar } from "./SearchBar";

const noop = () => {};

/** Header cells are label-width, body cells are content-width — enough variation to read as a table. */
const HEADER_CELL_WIDTHS = ["w-28", "w-24", "w-32", "w-20", "w-16"];
const BODY_CELL_WIDTHS = ["w-40", "w-36", "w-44", "w-28", "w-10"];

/**
 * What an admin CRUD page shows while its rows are in flight.
 *
 * `"use client"` only because `SearchBar` needs an `onChange` function, which a server component
 * cannot hand it. **It must stay hook-free** — this is a `Suspense` fallback, and a fallback that
 * calls `useSearchParams` (directly or through `useDebouncedUrlQuery`) suspends too, which pushes
 * the bailout back up to the boundary above and undoes NEW-SC10/SC11.
 *
 * **Two things stop it reading as a flicker (NEW-R5).**
 *
 * First, it is invisible unless the wait is real. `delay-200 fill-mode-both` applies the `enter`
 * keyframe's opening state — `opacity: 0`, from `fade-in` — for the first 200 ms, so a navigation
 * whose data is already cached server-side swaps straight to the table and this is never painted.
 * Verified in `tw-animate-css`: `@utility delay-*` sets `animation-delay`, not `transition-delay`.
 *
 * Second, it is the same shape as what replaces it. It used to be five bare 56px bars in a plain
 * column, so the swap to a bordered card with a header strip visibly resized the page. The skeleton
 * now mirrors `AdminSchiedsrichterTable` / `AdminSpielorteTable`: the same `card()` shell, a
 * `bg-muted` header strip with a bottom border, and rows on the same `px-6 py-4` rhythm.
 */
export function AdminCrudFallback({ searchLabel, searchPlaceholder }: { searchLabel: string; searchPlaceholder: string }) {
  return (
    <div
      role="status"
      aria-label="Daten werden geladen"
      className="animate-in fade-in fill-mode-both flex flex-col gap-8 delay-200 duration-150">
      <SearchBar
        label={searchLabel}
        placeholder={searchPlaceholder}
        value=""
        onChange={noop}
        className="w-full max-w-md"
      />

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
