"use client";

import { SearchField } from "@heroui/react";

/**
 * The app's search input. Three views hand-rolled this from a `<div>` + icon + bare `Input` while
 * the same codebase used HeroUI's `SearchField` correctly three times. The hand-built
 * version had no accessible name (its only name came from the placeholder, which disappears as soon
 * as you type), no clear button and no `type="search"` semantics.
 *
 * Focus is shown as a border colour change on the group rather than a ring — the owner's decision,
 * recorded at `globals.css`'s `--focus` note and applied identically by `FIELD_INPUT`. That is why
 * the input carries `outline-none`: the group owns the focus affordance, so a second indicator on
 * the inner input would double it.
 *
 * `className` is the caller's outer width only — the chrome is deliberately not configurable.
 */
export function SearchBar({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  /** Accessible name, in German — e.g. "Schiedsrichter suchen". */
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <SearchField
      aria-label={label}
      value={value}
      onChange={onChange}
      className={className}>
      <SearchField.Group className="bg-surface border-border flex h-12 w-full items-center gap-3 rounded-xl border px-4 shadow-sm transition-colors duration-200 lg:h-15">
        <SearchField.SearchIcon className="text-foreground-muted shrink-0" />
        <SearchField.Input
          placeholder={placeholder}
          className="fluid-sm w-full bg-transparent outline-none"
        />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}
