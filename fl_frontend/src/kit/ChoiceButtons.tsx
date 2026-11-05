"use client";

import { useId } from "react";

import { TextContext } from "react-aria-components/Text";
import { ToggleButton } from "react-aria-components/ToggleButton";
import { ToggleButtonGroup } from "react-aria-components/ToggleButtonGroup";

import { textOf } from "@/core/copy";

import { MessageLine, RequiredMark } from "./FieldParts";
import { choiceButton, choiceGroup, fieldLabel, fieldRoot, messageLine } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

import type { Copy } from "@/core/copy";
import type { Choice } from "./FieldParts";
import type { IconName } from "./Icon";

/** An answer drawn as a glyph alone, such as a theme's: `label` names it for assistive technology and in its tooltip. */
export type GlyphChoice = { id: string; glyph: IconName; label: Copy };

type Shared = {
  label: Copy;
  description?: Copy;
  choices: readonly Choice[];
  isDisabled?: boolean;
  /** The write takes no record without an answer here: the asterisk after the label, as every required field shows. */
  isRequired?: boolean;
};

/**
 * The label above the buttons, its asterisk after it where the write requires an answer, as a field's label carries
 * it. React Aria's button group takes no `Label`, so the group is named by this line's id. The mark says the rule
 * alone: a segmented choice is never empty, and a group of boxes left empty is answered by the write's refusal.
 */
function Head({ id, label, isRequired }: { id: string; label: Copy; isRequired: boolean }) {
  return (
    <span
      id={id}
      className={fieldLabel()}>
      {label}
      <RequiredMark isRequired={isRequired} />
    </span>
  );
}

/**
 * The message line under the buttons. React Aria's button group provides no description slot and no validation, as a
 * field does, so this one provides the id the group's `aria-describedby` names to the description and the error alike:
 * the error the editor's served field errors name the group by, in a field's error line, else the description.
 */
function GroupMessage({ id, description, errorMessage }: { id: string; description: Copy | undefined; errorMessage?: Copy }) {
  if (errorMessage !== undefined) {
    return (
      <span
        id={id}
        data-kit-message
        className={messageLine({ tone: "error" })}>
        {errorMessage}
      </span>
    );
  }
  return (
    <TextContext.Provider value={{ slots: { description: { id } } }}>
      <MessageLine description={description} />
    </TextContext.Provider>
  );
}

/** One segment: its words, or its glyph alone with its name in the tooltip. */
function Segment({ choice }: { choice: Choice | GlyphChoice }) {
  if ("glyph" in choice) {
    return (
      <Tooltip label={choice.label}>
        <ToggleButton
          id={choice.id}
          aria-label={choice.label}
          data-kit-focus="ring"
          className={choiceButton({ kind: "segmented", content: "glyph" })}>
          <Icon
            glyph={choice.glyph}
            size={16}
          />
        </ToggleButton>
      </Tooltip>
    );
  }
  return (
    <ToggleButton
      id={choice.id}
      data-kit-focus="ring"
      className={choiceButton({ kind: "segmented" })}>
      {textOf(choice.label)}
    </ToggleButton>
  );
}

/**
 * One short single choice of two to four answers, such as the theme: the answers as segments of one frame, the
 * chosen one raised, each a word or a glyph alone. As a field, the label stands above and the message line below;
 * `inline`, the segments stand alone, named by the label for assistive technology, in a row the caller writes
 * such as the account menu's theme row. React Aria's `ToggleButtonGroup` in single selection, which never lets
 * the choice go empty; `null` chooses none while the answer is not known, as a theme is not before the page
 * hydrates.
 */
export function Segmented({
  label,
  description,
  choices,
  isDisabled = false,
  isRequired = false,
  value,
  defaultValue,
  onChange,
  placement = "field",
}: Omit<Shared, "choices"> & {
  choices: readonly Choice[] | readonly GlyphChoice[];
  value?: string | null;
  defaultValue?: string;
  onChange?: (id: string) => void;
  placement?: "field" | "inline";
}) {
  const labelId = useId();
  const descriptionId = useId();
  const group = (
    <ToggleButtonGroup
      aria-label={placement === "inline" ? label : undefined}
      aria-labelledby={placement === "inline" ? undefined : labelId}
      aria-describedby={placement === "inline" || description === undefined ? undefined : descriptionId}
      selectionMode="single"
      disallowEmptySelection
      isDisabled={useDisabled(isDisabled)}
      selectedKeys={value === undefined ? undefined : value === null ? [] : [value]}
      defaultSelectedKeys={defaultValue === undefined ? undefined : [defaultValue]}
      // Every choice's id is a string, and a single choice never goes empty, so one string comes back.
      onSelectionChange={onChange && ((keys) => onChange(String([...keys][0])))}
      className={choiceGroup({ kind: "segmented" })}>
      {choices.map((choice) => (
        <Segment
          key={choice.id}
          choice={choice}
        />
      ))}
    </ToggleButtonGroup>
  );
  if (placement === "inline") return group;
  return (
    <div className={fieldRoot()}>
      <Head
        id={labelId}
        label={label}
        isRequired={isRequired}
      />
      {group}
      <GroupMessage
        id={descriptionId}
        description={description}
      />
    </div>
  );
}

/**
 * A small multi-select of short words, such as a season's allowed Stufen: the label above, one box per answer,
 * each chosen box edged and tinted in the link green. React Aria's `ToggleButtonGroup` in multiple selection. It
 * posts no form value, so its served refusal comes as `errorMessage`, which its line shows as a field's shows its own.
 */
export function ToggleBoxes({
  label,
  description,
  errorMessage,
  choices,
  isDisabled = false,
  isRequired = false,
  value,
  defaultValue,
  onChange,
}: Shared & {
  /**
   * The served refusal of the group, which the editor's field errors name it by: the boxes post no form value, so the
   * form's own `validationErrors` cannot reach them as they reach a field.
   */
  errorMessage?: Copy;
  value?: readonly string[];
  defaultValue?: readonly string[];
  onChange?: (ids: string[]) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className={fieldRoot()}>
      <Head
        id={labelId}
        label={label}
        isRequired={isRequired}
      />
      <ToggleButtonGroup
        aria-labelledby={labelId}
        aria-describedby={description === undefined && errorMessage === undefined ? undefined : descriptionId}
        selectionMode="multiple"
        isDisabled={useDisabled(isDisabled)}
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
            {textOf(choice.label)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <GroupMessage
        id={descriptionId}
        description={description}
        errorMessage={errorMessage}
      />
    </div>
  );
}
