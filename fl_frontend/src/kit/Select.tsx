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
        className={fieldFrame({ width: "W3", inset: "start", layout: "trigger" })}>
        <SelectValue className="truncate data-placeholder:text-fg-muted" />
        <Icon
          glyph="aufklappen"
          size={16}
        />
      </Button>
      <MessageLine
        description={description}
        consequence={consequence}
      />
      <OptionList options={options} />
    </AriaSelect>
  );
}
