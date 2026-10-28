"use client";

import { useId } from "react";

import { ToggleButton } from "react-aria-components/ToggleButton";
import { ToggleButtonGroup } from "react-aria-components/ToggleButtonGroup";

import { MessageLine } from "./FieldParts";
import { choiceButton, choiceGroup, fieldLabel, fieldRoot } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { Choice } from "./RadioGroup";

type Shared = {
  label: Copy;
  description?: Copy;
  choices: readonly Choice[];
  isDisabled?: boolean;
};

/**
 * The label above the buttons. React Aria's button group takes no `Label`, so the group is named by this
 * line's id. It carries no asterisk: a segmented choice is never empty, and a group of boxes is not checked
 * for an answer.
 */
function Head({ id, label }: { id: string; label: Copy }) {
  return (
    <span
      id={id}
      className={fieldLabel()}>
      {label}
    </span>
  );
}

/**
 * One short single choice of two to four words, such as the theme: the label above, the answers as segments
 * of one frame, the chosen one raised. React Aria's `ToggleButtonGroup` in single selection, which never lets
 * the choice go empty.
 */
export function Segmented({
  label,
  description,
  choices,
  isDisabled = false,
  value,
  defaultValue,
  onChange,
}: Shared & { value?: string; defaultValue?: string; onChange?: (id: string) => void }) {
  const labelId = useId();
  return (
    <div className={fieldRoot()}>
      <Head
        id={labelId}
        label={label}
      />
      <ToggleButtonGroup
        aria-labelledby={labelId}
        selectionMode="single"
        disallowEmptySelection
        isDisabled={isDisabled}
        selectedKeys={value === undefined ? undefined : [value]}
        defaultSelectedKeys={defaultValue === undefined ? undefined : [defaultValue]}
        // Every choice's id is a string, and a single choice never goes empty, so one string comes back.
        onSelectionChange={onChange && ((keys) => onChange(String([...keys][0])))}
        className={choiceGroup({ kind: "segmented" })}>
        {choices.map((choice) => (
          <ToggleButton
            key={choice.id}
            id={choice.id}
            data-kit-focus="ring"
            className={choiceButton({ kind: "segmented" })}>
            {choice.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <MessageLine description={description} />
    </div>
  );
}

/**
 * A small multi-select of short words, such as a season's allowed Stufen: the label above, one box per answer,
 * each chosen box lifted. React Aria's `ToggleButtonGroup` in multiple selection.
 */
export function ToggleBoxes({
  label,
  description,
  choices,
  isDisabled = false,
  value,
  defaultValue,
  onChange,
}: Shared & { value?: readonly string[]; defaultValue?: readonly string[]; onChange?: (ids: string[]) => void }) {
  const labelId = useId();
  return (
    <div className={fieldRoot()}>
      <Head
        id={labelId}
        label={label}
      />
      <ToggleButtonGroup
        aria-labelledby={labelId}
        selectionMode="multiple"
        isDisabled={isDisabled}
        selectedKeys={value}
        defaultSelectedKeys={defaultValue}
        onSelectionChange={onChange && ((keys) => onChange([...keys].map(String)))}
        className={choiceGroup({ kind: "boxes" })}>
        {choices.map((choice) => (
          <ToggleButton
            key={choice.id}
            id={choice.id}
            data-kit-focus="ring"
            className={choiceButton({ kind: "boxes" })}>
            {choice.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <MessageLine description={description} />
    </div>
  );
}
