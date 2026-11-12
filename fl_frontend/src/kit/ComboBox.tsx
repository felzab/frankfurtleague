"use client";

import { useState } from "react";

import { ComboBox as AriaComboBox, Button, Input } from "react-aria-components/ComboBox";
import { Group } from "react-aria-components/Group";

import { textOf } from "@/core/copy";

import { FieldLabel, MessageLine, useFieldLock } from "./FieldParts";
import { fieldButton, fieldFrame, fieldRoot, groupInput } from "./fieldStyles";
import { Icon } from "./Icon";
import { OptionList } from "./OptionList";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy } from "@/core/copy";
import type { Option } from "./OptionList";

/**
 * The entry creating the record the list lacks, such as „Spielort anlegen“: last in the list whatever is
 * typed, and alone where nothing matches. `onCreate` receives the text typed into the field, which the create
 * dialog starts from, or nothing where the field shows the chosen record's own name.
 */
export type CreateEntry = { label: Copy; onCreate: (typed: string) => void };

/**
 * A combo box whose answer is its text, the options suggestions rather than the set, as a school may wish to play one
 * no list holds yet: the form receives what is typed, up to `maxLength`, and `arrow` names the button opening the list.
 */
export type FreeText = { arrow: Copy; maxLength?: number };

/**
 * Pick one of many records by typing part of its name: the field filters its menu as it is typed into,
 * and the whole field shows its edge while it holds the focus. A record the list lacks is created from the
 * list's last entry.
 */
export function ComboBox({
  label,
  labelHidden = false,
  description,
  consequence,
  options,
  create,
  free,
  isRequired = false,
  isDisabled = false,
  isLocked = false,
  name,
  value,
  onChange,
}: {
  label: Copy;
  /** Whether the label names the field to a screen reader alone, the place around it naming it on the screen. */
  labelHidden?: boolean;
  description?: Copy;
  consequence?: Copy;
  options: readonly Option[];
  create?: CreateEntry;
  free?: FreeText;
  isRequired?: boolean;
  isDisabled?: boolean;
  /** Held fixed by its record: disabled, its label marked with the lock (`useFieldLock`). */
  isLocked?: boolean;
  name?: string;
  value?: string | null;
  onChange?: (id: string | null) => void;
}) {
  // React Aria filters the list itself while the field holds its own text, so the field clears its value when
  // its text is cleared and its arrow opens the whole list; the create entry's own text keeps it in.
  // The field's text and value, followed rather than held, for the create entry to hand on.
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const chosenLabel = options.find((option) => option.id === (value === undefined ? chosen : value))?.label;
  const shown = chosenLabel === undefined ? "" : textOf(chosenLabel);
  const root = useEarlyEdit();
  const lock = useFieldLock(isDisabled, isLocked);
  return (
    <AriaComboBox
      ref={root}
      className={fieldRoot()}
      aria-label={labelHidden ? label : undefined}
      name={name}
      // The form receives the chosen record's id, not the text typed to find it, unless the text is the answer.
      formValue="key"
      allowsCustomValue={free !== undefined}
      value={value}
      onChange={(key) => {
        const id = key === null ? null : String(key);
        setChosen(id);
        onChange?.(id);
      }}
      onInputChange={setText}
      isRequired={isRequired}
      isDisabled={lock.isDisabled}>
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={isRequired}
          isLocked={lock.isMarked}
        />
      )}
      <Group
        data-kit-focus="field"
        className={fieldFrame({ width: "standard", inset: "start", layout: "group" })}>
        <Input
          data-kit-focus
          maxLength={free?.maxLength}
          className={groupInput()}
        />
        <Button
          data-kit-focus
          aria-label={free?.arrow}
          className={fieldButton()}>
          <Icon
            glyph="expand"
            size={16}
          />
        </Button>
      </Group>
      <MessageLine
        description={description}
        consequence={consequence}
      />
      <OptionList
        options={options}
        act={create && { label: create.label, typed: text, onAction: () => create.onCreate(text === shown ? "" : text) }}
      />
    </AriaComboBox>
  );
}
