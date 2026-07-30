"use client";

import { SearchField } from "@heroui/react";

/**
 * The app's search input. Three views hand-rolled this from a `<div>` + icon + bare `Input` while
 * the same codebase used HeroUI's `SearchField` correctly three times (R4 §9.1). The hand-built
 * version had no accessible name (its only name came from the placeholder, which disappears as soon
 * as you type), no clear button, no `type="search"` semantics, and it suppressed the input's own
 * focus ring in favour of a 1px border that is near-invisible in dark mode.
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
      <SearchField.Group className="bg-surface border-border focus-within:border-brand flex h-12 w-full items-center gap-3 rounded-xl border px-4 shadow-sm transition-all duration-200 focus-within:ring-0 lg:h-15">
        <SearchField.SearchIcon className="text-foreground-muted shrink-0" />
        <SearchField.Input
          placeholder={placeholder}
          className="text-fluid-sm w-full bg-transparent outline-none"
        />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}
