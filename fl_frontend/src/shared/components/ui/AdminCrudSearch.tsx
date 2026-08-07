"use client";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { SearchBar } from "./SearchBar";

/**
 * The CRUD pages' search field, as its own client island in the shell's header row.
 *
 * Separate from `AdminCrudView` so the row holding it and the create trigger renders IMMEDIATELY —
 * neither depends on the resource list, and the two used to sit in different containers only
 * because the search state lived inside the data-dependent view. The two halves stay in step
 * through the URL: this writes the debounced `?q=`, and the view's own `useDebouncedUrlQuery`
 * reads the same parameter, so no state has to cross the Suspense boundary between them.
 */
export function AdminCrudSearch({ searchLabel, searchPlaceholder }: { searchLabel: string; searchPlaceholder: string }) {
  const { inputValue, setInputValue } = useDebouncedUrlQuery();

  return (
    <SearchBar
      label={searchLabel}
      placeholder={searchPlaceholder}
      value={inputValue}
      onChange={setInputValue}
      className="w-full sm:max-w-md"
    />
  );
}
