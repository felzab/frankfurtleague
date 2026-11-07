"use client";

import { SearchField as AriaSearchField, Button, Input } from "react-aria-components/SearchField";

import { fieldFrame, searchClear, searchGlyph, searchInput } from "./fieldStyles";
import { Icon } from "./Icon";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy } from "@/core/copy";

/**
 * Find in a list: one field above it, named by `label` for assistive technology, with the magnifier at
 * its start and a clearing button once something is typed. What is typed stays on the page and never
 * enters the address. A search the server bounds passes that bound as `maxLength`, so the box stops a paste there rather
 * than send a text the read refuses.
 */
export function SearchField({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: Copy;
  value?: string;
  onChange: (text: string) => void;
  maxLength?: number;
}) {
  const root = useEarlyEdit();
  return (
    <AriaSearchField
      ref={root}
      aria-label={label}
      value={value}
      onChange={onChange}
      maxLength={maxLength}
      className="group">
      <div
        data-kit-focus="field"
        className={fieldFrame({ width: "column", inset: "none", layout: "group" })}>
        <span className={searchGlyph()}>
          <Icon
            glyph="search"
            size={16}
          />
        </span>
        <Input
          data-kit-focus
          className={searchInput()}
        />
        <Button
          data-kit-focus
          className={searchClear()}>
          <Icon
            glyph="close"
            size={16}
          />
        </Button>
      </div>
    </AriaSearchField>
  );
}
