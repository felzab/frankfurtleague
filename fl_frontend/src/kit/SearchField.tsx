"use client";

import { Group } from "react-aria-components/Group";
import { SearchField as AriaSearchField, Button, Input } from "react-aria-components/SearchField";

import { textOf } from "@/core/copy";

import { useFieldWait } from "./FieldParts";
import { fieldFrame, searchClear, searchGlyph, searchInput } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Words } from "@/core/copy";

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
  label: Words;
  value?: string;
  onChange: (text: string) => void;
  maxLength?: number;
}) {
  return (
    <AriaSearchField
      inert={useFieldWait()}
      aria-label={textOf(label)}
      value={value}
      onChange={onChange}
      maxLength={maxLength}
      className="group">
      {/* React Aria's group for its hover over the whole frame, the magnifier included; presentational, since the field
          is one control and a group would add an unnamed stop to a screen reader's walk. */}
      <Group
        role="presentation"
        data-kit-focus="field"
        className={fieldFrame({ width: "standard", inset: "none", layout: "group" })}>
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
      </Group>
    </AriaSearchField>
  );
}
