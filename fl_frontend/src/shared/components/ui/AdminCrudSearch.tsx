"use client";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { SearchBar } from "./SearchBar";

/**
 * The CRUD pages' search field, as its own client island in the shell's header row.
 *
 * Separate from `AdminCrudView` so the row holding it and the create trigger renders IMMEDIATELY —
 * neither depends on the resource list. The two halves stay in step through the URL: this writes the
 * debounced `?q=` and the view reads the same parameter with `useUrlQuery`, so no state has to cross
 * the Suspense boundary between them.
 */
export function AdminCrudSearch({ searchLabel, searchPlaceholder }: { searchLabel: string; searchPlaceholder: string }) {
  const { inputValue, setInputValue } = useDebouncedUrlQuery();

  return (
    <SearchBar
      label={searchLabel}
      placeholder={searchPlaceholder}
      value={inputValue}
      onChange={setInputValue}
      // `flex-1 min-w-0` below `sm`: the bar fills whatever the joined plus-trigger leaves of the
      // row; from `sm` the familiar capped width returns.
      className="min-w-0 flex-1 sm:max-w-md"
      attachEnd
    />
  );
}
