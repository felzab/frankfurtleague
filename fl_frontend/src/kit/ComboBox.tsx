"use client";

import { useState } from "react";

import { ComboBox as AriaComboBox, Button, Input } from "react-aria-components/ComboBox";
import { Group } from "react-aria-components/Group";

import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { FieldLabel, MessageLine, useFieldLock, useFieldWait } from "./FieldParts";
import { fieldButton, fieldFrame, fieldRoot, groupInput } from "./fieldStyles";
import { useBoxRule } from "./HeldForm";
import { Icon } from "./Icon";
import { OptionList } from "./OptionList";

import type { Copy, Words } from "@/core/copy";
import type { Option } from "./OptionList";

/**
 * The entry creating the record the list lacks, such as „Spielort anlegen“: last in the list whatever is
 * typed, and alone where nothing matches. `onCreate` receives the text typed into the field, which the create
 * dialog starts from, or nothing where the field shows the chosen record's own name.
 */
type CreateEntry = { label: Copy; onCreate: (typed: string) => void };

/**
 * What the list shows where the text typed matches no option: the create entry standing alone, nothing for a box whose
 * text is the answer, and otherwise one row saying the search found none of the list's `plural`, so a name the list
 * lacks says so while it is typed rather than vanishing as the field is left.
 */
type Unmatched =
  | { create: CreateEntry; free?: never; plural?: never }
  /**
   * A combo box whose answer is its text, the options suggestions rather than the set, as a school may wish to play one
   * no list holds yet: the form receives what is typed, up to its lane's length.
   */
  | { free: true; create?: never; plural?: never }
  | { plural: Copy; create?: never; free?: never };

/**
 * Pick one of many records by typing part of its name: the field filters its menu as it is typed into. A record the
 * list lacks is created from the list's last entry.
 */
export function ComboBox({
  label,
  labelHidden = false,
  description,
  consequence,
  options,
  create,
  free,
  plural,
  isDisabled = false,
  isLocked = false,
  name,
  value,
  onChange,
}: {
  label: Words;
  /** Whether the label names the field to a screen reader alone, the place around it naming it on the screen. */
  labelHidden?: boolean;
  description?: Copy;
  consequence?: Copy;
  options: readonly Option[];
  isDisabled?: boolean;
  /** Held fixed by its record: read-only, its label marked with the lock (`useFieldLock`). */
  isLocked?: boolean;
  name?: string;
  value?: string | null;
  onChange?: (id: string | null) => void;
} & Unmatched) {
  // React Aria filters the list itself while the field holds its own text, so the field clears its value when
  // its text is cleared and its arrow opens the whole list; the create entry's own text keeps it in.
  // The field's text and value, followed rather than held, for the create entry to hand on.
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const chosenLabel = options.find((option) => option.id === (value === undefined ? chosen : value))?.label;
  const shown = chosenLabel === undefined ? "" : textOf(chosenLabel);
  const rule = useBoxRule(name);
  const lock = useFieldLock(isLocked, rule.required);
  return (
    <AriaComboBox
      inert={useFieldWait()}
      className={fieldRoot()}
      aria-label={labelHidden ? textOf(label) : undefined}
      name={name}
      // The form receives the chosen record's id, not the text typed to find it, unless the text is the answer.
      formValue="key"
      allowsCustomValue={free !== undefined}
      // Open on a search that matched nothing, to say so; a list with no options at all opens on nothing to search.
      allowsEmptyCollection={plural !== undefined && options.length > 0}
      value={value}
      onChange={(key) => {
        const id = key === null ? null : String(key);
        setChosen(id);
        onChange?.(id);
      }}
      onInputChange={setText}
      isRequired={lock.isRequired}
      isDisabled={isDisabled}
      isReadOnly={lock.isReadOnly}>
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={lock.isRequired}
          isLocked={lock.isMarked}
        />
      )}
      <Group
        data-kit-focus="field"
        className={fieldFrame({ width: "standard", inset: "start", layout: "group" })}>
        <Input
          data-kit-focus
          maxLength={free === true ? rule.maxLength : undefined}
          className={groupInput()}
        />
        <Button
          data-kit-focus
          // Named by the catalogue in every box, since React Aria's own name for it is a wording of its own.
          aria-label={COPY.shared.showSuggestions}
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
        empty={plural === undefined ? undefined : COPY.shared.empty.search(plural)}
        act={create && { label: create.label, typed: text, onAction: () => create.onCreate(text === shown ? "" : text) }}
      />
    </AriaComboBox>
  );
}
