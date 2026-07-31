"use client";

import { useState } from "react";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { useFuzzySearch } from "../../hooks/useFuzzySearch";
import { SearchBar } from "./SearchBar";

import type { ReactNode } from "react";

/**
 * The data-dependent half of an admin CRUD page: search bar, table slot and the edit/delete modal
 * wiring. `AdminSchiedsrichterView` and `AdminSpielorteView` were 87% identical once domain nouns
 * were folded (R2 §3.1); they are now per-entity declarations over this.
 *
 * Built generically at the owner's request (2026-07-30) rather than left as two thin siblings: R2's
 * point is that the third admin resource would otherwise be a third copy, and here it costs a
 * `renderTable` plus two modal renderers.
 *
 * The heading, description and create trigger moved to `AdminCrudShell` (NEW-SC11), which the page
 * renders *above* the boundary this sits behind — they never depended on the resource list, so they
 * should not have waited on it. Returns a fragment: the surrounding column is the shell's.
 *
 * **NEW-T1 constraint.** This component calls `useSearchParams()` via `useDebouncedUrlQuery`, so it
 * re-renders on every navigation — including while it sits in a hidden Activity tree, where a
 * react-aria collection that re-renders can stop committing rows. The table passed to `renderTable`
 * must therefore be `React.memo`'d and must use `Table.Body`'s `items` + render-function form.
 * `filteredItems` is memoised here and the two setters are `useState` setters; **do not add an
 * inline lambda or a fresh array** to the `renderTable` call. Note that `query` is inherently
 * unstable — a navigation to a route with a different `q` changes it and defeats the memo — so the
 * `items` form is the load-bearing half, not the memo.
 */
export function AdminCrudView<TItem extends { id: string }>({
  searchLabel,
  searchPlaceholder,
  items,
  searchKeys,
  renderTable,
  renderEditModal,
  renderDeleteModal,
}: {
  searchLabel: string;
  searchPlaceholder: string;
  items: TItem[];
  /** Must be a module-scope constant, or `useFuzzySearch`'s memo is defeated. */
  searchKeys: readonly string[];
  renderTable: (args: { query: string; filteredItems: TItem[]; onEdit: (item: TItem) => void; onDelete: (item: TItem) => void }) => ReactNode;
  renderEditModal: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
  renderDeleteModal: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
}) {
  const { urlValue: query, inputValue, setInputValue } = useDebouncedUrlQuery();
  const [editingItem, setEditingItem] = useState<TItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<TItem | null>(null);

  const filteredItems = useFuzzySearch({ items, keys: searchKeys, query });

  return (
    <>
      <SearchBar
        label={searchLabel}
        placeholder={searchPlaceholder}
        value={inputValue}
        onChange={setInputValue}
        className="w-full max-w-md"
      />

      {renderTable({ query, filteredItems, onEdit: setEditingItem, onDelete: setDeletingItem })}

      {renderEditModal({ item: editingItem, isOpen: editingItem !== null, onClose: () => setEditingItem(null) })}
      {renderDeleteModal({ item: deletingItem, isOpen: deletingItem !== null, onClose: () => setDeletingItem(null) })}
    </>
  );
}
