"use client";

import { Select as AriaSelect, Button, SelectValue } from "react-aria-components/Select";

import { textOf } from "@/core/copy";

import { FieldLabel, MessageLine, useFieldLock } from "./FieldParts";
import { fieldFrame, fieldRoot } from "./fieldStyles";
import { hoverLook } from "./hoverStyles";
import { Icon } from "./Icon";
import { OptionList } from "./OptionList";
import { ChosenField } from "./TextField";

import type { Copy } from "@/core/copy";
import type { Option } from "./OptionList";

/**
 * Pick one of five or more choices, or an optional one where „Keines“ is a real answer: a field at the standard
 * width whatever its choices' length, whose trigger keeps its edge while its menu is open. A choice among counts
 * takes `holds`, as a text field holding a count does, and stands as wide as the count and its arrow, so it can stand
 * as a row of `FieldRows` beside the counts typed. Locked or in a closed form it stands read-only as the answer it
 * shows (`ChosenField`), at the trigger's size.
 */
export function Select({
  label,
  labelHidden = false,
  holds,
  description,
  consequence,
  options,
  isRequired = false,
  isDisabled = false,
  isLocked = false,
  name,
  value,
  defaultValue,
  onChange,
}: {
  label: Copy;
  /** Whether the label names the field to a screen reader alone, the title of a section holding this one field. */
  labelHidden?: boolean;
  /** The characters the longest choice holds, where every choice is a count. */
  holds?: 2;
  description?: Copy;
  consequence?: Copy;
  options: readonly Option[];
  isRequired?: boolean;
  isDisabled?: boolean;
  /** Held fixed by its record: read-only, its label marked with the lock (`useFieldLock`). */
  isLocked?: boolean;
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string | null) => void;
}) {
  const lock = useFieldLock(isDisabled, isLocked, isRequired);
  const frame = {
    width: holds === undefined ? "standard" : "short",
    holds,
    figures: holds !== undefined,
    inset: "start",
    layout: "trigger",
  } as const;
  if (lock.isReadOnly && !lock.isDisabled) {
    const chosen = options.find((option) => option.id === (value === undefined ? defaultValue : value));
    return (
      <ChosenField
        label={label}
        labelHidden={labelHidden}
        words={chosen === undefined ? "" : textOf(chosen.label)}
        isRequired={lock.isRequired}
        isMarked={lock.isMarked}
        frame={fieldFrame(frame)}
        description={description}
        consequence={consequence}
      />
    );
  }
  return (
    <AriaSelect
      className={fieldRoot()}
      aria-label={labelHidden ? textOf(label) : undefined}
      name={name}
      value={value}
      defaultValue={defaultValue}
      // Every option's id is a string, so the key handed back is one.
      onChange={onChange && ((key) => onChange(key === null ? null : String(key)))}
      isRequired={lock.isRequired}
      isDisabled={lock.isDisabled}
      // Nothing while none is chosen, as an empty text field shows nothing: no field has a placeholder,
      // and React Aria's own, „Element wählen“, is words outside the catalogue.
      placeholder="">
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={lock.isRequired}
          isLocked={lock.isMarked}
        />
      )}
      <Button
        data-kit-focus="field"
        className={fieldFrame({ ...frame, class: hoverLook({ host: "aria" }) })}>
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
