"use client";

import { useContext, useId } from "react";

import { FormValidationContext } from "react-aria-components";
import { FieldErrorContext } from "react-aria-components/FieldError";
import { TextContext } from "react-aria-components/Text";
import { ToggleButton } from "react-aria-components/ToggleButton";
import { ToggleButtonGroup } from "react-aria-components/ToggleButtonGroup";

import { textOf } from "@/core/copy";

import { MessageLine, RequiredMark } from "./FieldParts";
import { choiceButton, choiceGroup, fieldLabel, fieldRoot } from "./fieldStyles";
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

/** No flag of the browser's own check set, which a message the form names for the group carries in place of one. */
const UNFLAGGED: Omit<ValidityState, "customError" | "valid"> = {
  badInput: false,
  patternMismatch: false,
  rangeOverflow: false,
  rangeUnderflow: false,
  stepMismatch: false,
  tooLong: false,
  tooShort: false,
  typeMismatch: false,
  valueMissing: false,
};

/**
 * The message line under the buttons. React Aria's button group provides no description slot and no validation, as a
 * field does, so this one provides the id the group's `aria-describedby` names to the description and the error alike,
 * and hands the line the message the form's `validationErrors` name the group by, as a field's own validation would:
 * marked a custom error, so the line shows it as it came.
 */
function GroupMessage({ id, description, errors }: { id: string; description: Copy | undefined; errors: readonly string[] }) {
  const validation = {
    isInvalid: errors.length > 0,
    validationErrors: [...errors],
    validationDetails: { ...UNFLAGGED, customError: errors.length > 0, valid: errors.length === 0 },
  };
  return (
    <TextContext.Provider value={{ slots: { description: { id }, errorMessage: { id } } }}>
      <FieldErrorContext.Provider value={validation}>
        <MessageLine description={description} />
      </FieldErrorContext.Provider>
    </TextContext.Provider>
  );
}

/** The form's message for the group posting under `name`, as React Aria's `Form` hands every named field its own. */
function useServedErrors(name: string | undefined): readonly string[] {
  const served = useContext(FormValidationContext);
  const errors = name === undefined ? undefined : served[name];
  return errors === undefined ? [] : [errors].flat();
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
        errors={[]}
      />
    </div>
  );
}

/**
 * A small multi-select of short words, such as a season's allowed Stufen: the label above, one box per answer,
 * each chosen box lifted. React Aria's `ToggleButtonGroup` in multiple selection. It posts no form value, so `name`
 * names it alone to the form's `validationErrors`, whose message for it its line shows, as a field's shows its own.
 */
export function ToggleBoxes({
  label,
  name,
  description,
  choices,
  isDisabled = false,
  isRequired = false,
  value,
  defaultValue,
  onChange,
}: Shared & { name?: string; value?: readonly string[]; defaultValue?: readonly string[]; onChange?: (ids: string[]) => void }) {
  const labelId = useId();
  const descriptionId = useId();
  const errors = useServedErrors(name);
  return (
    <div className={fieldRoot()}>
      <Head
        id={labelId}
        label={label}
        isRequired={isRequired}
      />
      <ToggleButtonGroup
        aria-labelledby={labelId}
        aria-describedby={description === undefined && errors.length === 0 ? undefined : descriptionId}
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
        errors={errors}
      />
    </div>
  );
}
