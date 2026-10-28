"use client";

import { ComboBox as AriaComboBox, Button, Input } from "react-aria-components/ComboBox";
import { Group } from "react-aria-components/Group";

import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldButton, fieldFrame, fieldRoot, groupInput } from "./fieldStyles";
import { Icon } from "./Icon";
import { OptionList } from "./OptionList";

import type { Copy } from "@/core/copy";
import type { Option } from "./OptionList";

/**
 * Pick one of many records by typing part of its name: the field filters its menu as it is typed into,
 * and the whole field shows its edge while it holds the focus.
 */
export function ComboBox({
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
    <AriaComboBox
      className={fieldRoot()}
      defaultItems={options}
      name={name}
      // The form receives the chosen record's id, not the text typed to find it.
      formValue="key"
      value={value}
      defaultValue={defaultValue}
      onChange={onChange && ((key) => onChange(key === null ? null : String(key)))}
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
      <OptionList />
    </AriaComboBox>
  );
}
