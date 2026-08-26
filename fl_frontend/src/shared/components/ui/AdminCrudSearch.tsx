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
   * and squares its right corners against the trigger it joins, so with no trigger the edge is simply missing. It is
   * therefore also the answer to "does a trigger share my row", which is what the width below turns on.
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
      // The `sm` cap is room kept for the trigger beside it. With no trigger the row is the bar's alone, so the bar takes
      // the shell's column and lines up with the table under it — `--container-page`, not the `--container-toolbar` a
      // public toolbar caps at.
      className={attachEnd ? "min-w-0 flex-1 sm:max-w-md" : "w-full min-w-0"}
      attachEnd={attachEnd}
    />
  );
}
