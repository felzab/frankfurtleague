"use client";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { SearchBar } from "./SearchBar";

/**
 * Its own client island in the shell's header row, so that row renders immediately. It writes the debounced `?q=` and
 * `AdminCrudView` reads the same parameter, so no state crosses the Suspense boundary between them.
 */
export function AdminCrudSearch({
  searchLabel,
  searchPlaceholder,
  attachEnd = true,
}: {
  searchLabel: string;
  searchPlaceholder: string;
  /**
   * **False on a shell that passes no `createModal`, and only there.** Below `sm` the seam drops the bar's right border
   * and squares its right corners against the trigger it joins, so with no trigger the edge is simply missing.
   */
  attachEnd?: boolean;
}) {
  const { inputValue, setInputValue } = useDebouncedUrlQuery();

  return (
    <SearchBar
      label={searchLabel}
      placeholder={searchPlaceholder}
      value={inputValue}
      onChange={setInputValue}
      // Below `sm` the bar fills whatever the joined trigger leaves of the row; from `sm` the cap returns.
      className="min-w-0 flex-1 sm:max-w-md"
      attachEnd={attachEnd}
    />
  );
}
