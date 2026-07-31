"use client";

import { SearchBar } from "./SearchBar";

const noop = () => {};

/**
 * What an admin CRUD page shows while its rows are in flight: the real search field, inert, over a
 * table-shaped skeleton.
 *
 * `"use client"` only because `SearchBar` needs an `onChange` function, which a server component
 * cannot hand it. **It must stay hook-free** — this is a `Suspense` fallback, and a fallback that
 * calls `useSearchParams` (directly or through `useDebouncedUrlQuery`) suspends too, which pushes
 * the bailout back up to the boundary above and undoes NEW-SC10/SC11.
 *
 * The field is deliberately not focusable-and-lossy: typing into it during the swap would be
 * discarded when the live `AdminCrudView` replaces it. The window is one round-trip, and rendering
 * the real control keeps the layout from shifting when the rows arrive.
 */
export function AdminCrudFallback({ searchLabel, searchPlaceholder }: { searchLabel: string; searchPlaceholder: string }) {
  return (
    <>
      <SearchBar
        label={searchLabel}
        placeholder={searchPlaceholder}
        value=""
        onChange={noop}
        className="w-full max-w-md"
      />

      <div
        role="status"
        aria-label="Daten werden geladen"
        className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="bg-muted h-14 w-full animate-pulse rounded-xl"
          />
        ))}
      </div>
    </>
  );
}
