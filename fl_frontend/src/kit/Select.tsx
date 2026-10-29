"use client";

import { Select as AriaSelect, Button, SelectValue } from "react-aria-components/Select";

import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldFrame, fieldRoot } from "./fieldStyles";
import { Icon } from "./Icon";
import { OptionList } from "./OptionList";

import type { Copy } from "@/core/copy";
import type { Option } from "./OptionList";

/**
 * Pick one of five or more choices, or an optional one where „Keines“ is a real answer: a field whose
 * trigger keeps its edge while its menu is open.
 */
export function Select({
  label,
  description,
  consequence,
  options,
  width = "W3",
  isRequired = false,
  isDisabled = false,
  name,
  value,
  defaultValue,
  onChange,
}: {
  label: Copy;
  description?: Copy;
  consequence?: Copy;
  options: readonly Option[];
  /** The column, or as wide as its longest choice for a few short words. */
  width?: "W3" | "fit";
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string | null) => void;
}) {
  return (
    <AriaSelect
      className={fieldRoot()}
      name={name}
      value={value}
      defaultValue={defaultValue}
      // Every option's id is a string, so the key handed back is one.
      onChange={onChange && ((key) => onChange(key === null ? null : String(key)))}
      isRequired={isRequired}
      isDisabled={isDisabled}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      <Button
        data-kit-focus="field"
        className={fieldFrame({ width, inset: "start", layout: "trigger" })}>
        {width === "fit" ? (
          // Sized to the longest choice, not the chosen one, so choosing never moves the field: every label
          // lies in the value's cell, unseen, and the widest sets the cell's width. The cell's one column may
          // narrow below that widest label, so in a column narrower than it the field stops at the column and the
          // chosen value is cut there, where an `auto` column would hold the widest label and overflow the frame.
          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
            <SelectValue className="col-start-1 row-start-1 truncate data-placeholder:text-fg-muted" />
            {options.map((option) => (
              <span
                key={option.id}
                aria-hidden
                className="invisible col-start-1 row-start-1 whitespace-nowrap">
                {option.label}
              </span>
            ))}
          </span>
        ) : (
          <SelectValue className="truncate data-placeholder:text-fg-muted" />
        )}
        <Icon
          glyph="aufklappen"
          size={16}
        />
      </Button>
      <MessageLine
        description={description}
        consequence={consequence}
      />
      <OptionList
        options={options}
        fit={width === "fit" ? "content" : "field"}
      />
    </AriaSelect>
  );
}
