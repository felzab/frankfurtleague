"use client";

import { useCrudSearchField } from "./AdminCrudPrivateQuery";
import { SearchBar } from "./SearchBar";

/**
 * Its own client island in the shell's header row, so that row renders immediately. Where it meets `AdminCrudView` is
 * the shell's to decide: the debounced `?q=` on every ordinary list, and a held value on a page that passes
 * `privateQuery`.
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
  const { inputValue, setInputValue } = useCrudSearchField();

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
