"use client";

import { SearchField } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";

/**
 * The group owns the focus affordance, a border colour change rather than a ring, which is why the inner input carries
 * `outline-none`. `className` is the caller's outer width only; `attachEnd` is the one chrome exception.
 */
export function SearchBar({
  label,
  placeholder,
  value,
  onChange,
  className,
  attachEnd = false,
}: {
  /** Accessible name, in German — e.g. "Schiedsrichter suchen". */
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  attachEnd?: boolean;
}) {
  return (
    <SearchField
      aria-label={label}
      value={value}
      onChange={onChange}
      className={className}>
      <SearchField.Group
        className={`bg-surface border-border flex h-12 w-full items-center gap-3 rounded-xl border px-4 shadow-sm transition-colors duration-200 lg:h-15 ${
          attachEnd ? "max-sm:rounded-r-none max-sm:border-r-0" : ""
        }`}>
        <SearchField.SearchIcon className="text-foreground-muted shrink-0" />
        <SearchField.Input
          placeholder={placeholder}
          className="fluid-sm w-full bg-transparent outline-none"
        />
        {/* Generic wording: `label` is a whole phrase, so a name derived from it would read as broken German. */}
        <SearchField.ClearButton {...dismissControl({ label: "Suche zurücksetzen" })} />
      </SearchField.Group>
    </SearchField>
  );
}
