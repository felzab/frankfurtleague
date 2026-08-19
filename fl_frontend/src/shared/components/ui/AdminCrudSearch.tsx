"use client";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { SearchBar } from "./SearchBar";

/**
 * Its own client island in the shell's header row, so that row renders immediately. It writes the debounced `?q=` and
 * `AdminCrudView` reads the same parameter, so no state crosses the Suspense boundary between them.
 */
export function AdminCrudSearch({ searchLabel, searchPlaceholder }: { searchLabel: string; searchPlaceholder: string }) {
  const { inputValue, setInputValue } = useDebouncedUrlQuery();

  return (
    <SearchBar
      label={searchLabel}
      placeholder={searchPlaceholder}
      value={inputValue}
      onChange={setInputValue}
      // Below `sm` the bar fills whatever the joined trigger leaves of the row; from `sm` the cap returns.
      className="min-w-0 flex-1 sm:max-w-md"
      attachEnd
    />
  );
}
