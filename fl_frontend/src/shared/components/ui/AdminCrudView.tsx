"use client";

import { useState } from "react";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { useFuzzySearch } from "../../hooks/useFuzzySearch";
import { SearchBar } from "./SearchBar";

import type { ReactNode } from "react";

/**
 * The admin CRUD page shell: heading, create trigger, search bar, table slot and the edit/delete
 * modal wiring. `AdminSchiedsrichterView` and `AdminSpielorteView` were 87% identical once domain
 * nouns were folded (R2 §3.1); they are now per-entity declarations over this.
 *
 * Built generically at the owner's request (2026-07-30) rather than left as two thin siblings: R2's
 * point is that the third admin resource would otherwise be a third copy, and here it costs a
 * `renderTable` plus two modal renderers.
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
  title,
  description,
  createModal,
  searchLabel,
  searchPlaceholder,
  items,
  searchKeys,
  renderTable,
  renderEditModal,
  renderDeleteModal,
}: {
  title: string;
  description: string;
  /** The slice's Create modal, which owns its own trigger button and overlay state. */
  createModal: ReactNode;
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
    <div className="max-w-page mx-auto flex w-full flex-col gap-8 p-6 sm:p-8">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <h1 className="text-fluid-xl text-foreground font-extrabold tracking-tight">{title}</h1>
          <p className="text-fluid-sm text-foreground-muted mt-1 font-medium">{description}</p>
        </div>
        {createModal}
      </div>

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
    </div>
  );
}
