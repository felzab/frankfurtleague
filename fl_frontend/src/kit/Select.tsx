"use client";

import { Select as AriaSelect, Button, SelectValue } from "react-aria-components/Select";

import { textOf } from "@/core/copy";

import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldFrame, fieldRoot } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { hoverLook } from "./hoverStyles";
import { Icon } from "./Icon";
import { OptionList } from "./OptionList";

import type { Copy } from "@/core/copy";
import type { Option } from "./OptionList";

/**
 * Pick one of five or more choices, or an optional one where „Keines“ is a real answer: a field at the standard
 * width whatever its choices' length, whose trigger keeps its edge while its menu is open.
 */
export function Select({
  label,
  labelHidden = false,
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
  /** Whether the label names the field to a screen reader alone, the title of a section holding this one field. */
  labelHidden?: boolean;
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
      aria-label={labelHidden ? textOf(label) : undefined}
      name={name}
      value={value}
      defaultValue={defaultValue}
      // Every option's id is a string, so the key handed back is one.
      onChange={onChange && ((key) => onChange(key === null ? null : String(key)))}
      isRequired={isRequired}
      isDisabled={useDisabled(isDisabled)}
      // Nothing while none is chosen, as an empty text field shows nothing: no field has a placeholder,
      // and React Aria's own, „Element wählen“, is words outside the catalogue.
      placeholder="">
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={isRequired}
        />
      )}
      <Button
        data-kit-focus="field"
        className={fieldFrame({ width: "standard", inset: "start", layout: "trigger", class: hoverLook({ host: "aria" }) })}>
        <SelectValue className="truncate" />
        <Icon
          glyph="expand"
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
