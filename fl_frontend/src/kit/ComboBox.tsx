"use client";

import { useState } from "react";

import { ComboBox as AriaComboBox, Button, Input } from "react-aria-components/ComboBox";
import { Group } from "react-aria-components/Group";

import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldButton, fieldFrame, fieldRoot, groupInput } from "./fieldStyles";
import { Icon } from "./Icon";
import { OptionList } from "./OptionList";

import type { Copy } from "@/core/copy";
import type { Option } from "./OptionList";

/**
 * The entry creating the record the list lacks, such as „Spielort anlegen …“: last in the list whatever is
 * typed, and alone where nothing matches. `onCreate` receives the text typed into the field, which the create
 * dialog starts from, or nothing where the field shows the chosen record's own name.
 */
export type CreateEntry = { label: Copy; onCreate: (typed: string) => void };

/**
 * Pick one of many records by typing part of its name: the field filters its menu as it is typed into,
 * and the whole field shows its edge while it holds the focus. A record the list lacks is created from the
 * list's last entry.
 */
export function ComboBox({
  label,
  description,
  consequence,
  options,
  create,
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
  create?: CreateEntry;
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string | null) => void;
}) {
  // React Aria filters the list itself while the field holds its own text, so the field clears its value when
  // its text is cleared and its arrow opens the whole list; the create entry's own text keeps it in.
  // The field's text and value, followed rather than held, for the create entry to hand on.
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState(defaultValue ?? null);
  const shown = options.find((option) => option.id === (value === undefined ? chosen : value))?.label ?? "";
  return (
    <AriaComboBox
      className={fieldRoot()}
      name={name}
      // The form receives the chosen record's id, not the text typed to find it.
      formValue="key"
      value={value}
      defaultValue={defaultValue}
      onChange={(key) => {
        const id = key === null ? null : String(key);
        setChosen(id);
        onChange?.(id);
      }}
      onInputChange={setText}
      isRequired={isRequired}
      isDisabled={isDisabled}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      <Group
        data-kit-focus="field"
        className={fieldFrame({ width: "W3", inset: "start", layout: "group" })}>
        <Input
          data-kit-focus
          className={groupInput()}
        />
        <Button
          data-kit-focus
          className={fieldButton()}>
          <Icon
            glyph="aufklappen"
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
