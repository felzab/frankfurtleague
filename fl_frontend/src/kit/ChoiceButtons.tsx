"use client";

import { Checkbox, CheckboxGroup } from "react-aria-components/CheckboxGroup";
import { Radio, RadioGroup } from "react-aria-components/RadioGroup";
import { Text } from "react-aria-components/Text";

import { textOf } from "@/core/copy";

import { CutText } from "./CutText";
import { FieldLabel, MessageLine, useFieldLock } from "./FieldParts";
import { choiceButton, choiceGroup, fieldRoot, messageLine } from "./fieldStyles";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { Choice } from "./FieldParts";

type Shared = {
  label: Copy;
  choices: readonly Choice[];
  /** The write takes no record without an answer here: the asterisk after the label, and the group heard as required. */
  isRequired?: boolean;
  /**
   * The served refusal of the field, which its line shows and its frame's edge marks: the editor's field errors name a
   * choice by its row's box, which no `name` the group posts under carries.
   */
  errorMessage?: Copy;
};

/**
 * The message line under the answers: the served refusal, else the browser's own check's (`MessageLine`). The refusal
 * stands in React Aria's `errorMessage` slot, so each answer is described by it while the group is invalid, as a
 * field's input is.
 */
function GroupMessage({ errorMessage }: { errorMessage: Copy | undefined }) {
  if (errorMessage === undefined) return <MessageLine />;
  return (
    <Text
      slot="errorMessage"
      data-kit-message
      className={messageLine({ tone: "error" })}>
      {errorMessage}
    </Text>
  );
}

/**
 * An answer whose word a small mark stands before, such as a card's colour before „Gelb“: the mark shows what the word
 * says, so it is drawn for the eye alone and the word stays the answer's name.
 */
type MarkedChoice = Choice & { mark?: ReactNode };

/**
 * One short single choice of two to four answers, such as a goal's side: the answers as segments of one frame, the
 * chosen one raised, the label above and the message line below, or the label naming the group to a screen reader
 * alone (`labelHidden`) where the place around it names it on the screen. React Aria's `RadioGroup`, the segments its
 * radios, so the group is heard as required and as invalid, the browser's own check refuses it left empty at the send,
 * and an arrow key moves the answer as a radio group's does. `null` chooses none while the answer is not yet given, as
 * a new goal's side. Its segments stand on one line, never wrapping out of their frame: a column holding it gives it
 * the frame's whole width.
 */
export function Segmented({
  label,
  labelHidden = false,
  errorMessage,
  choices,
  isRequired = false,
  value,
  onChange,
}: Omit<Shared, "choices"> & {
  choices: readonly MarkedChoice[];
  value?: string | null;
  onChange?: (id: string) => void;
  labelHidden?: boolean;
}) {
  const root = useEarlyEdit();
  const lock = useFieldLock(false, false, isRequired);
  return (
    <RadioGroup
      ref={root}
      className={fieldRoot()}
      aria-label={labelHidden ? label : undefined}
      orientation="horizontal"
      value={value}
      onChange={onChange}
      isRequired={lock.isRequired}
      // Only while refused: a stated `false` would hide the browser's own check, which React Aria then never shows.
      isInvalid={errorMessage === undefined ? undefined : true}
      isDisabled={lock.isDisabled}
      isReadOnly={lock.isReadOnly}>
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={lock.isRequired}
        />
      )}
      <div className={choiceGroup({ kind: "segmented" })}>
        {choices.map((choice) => (
          <Radio
            key={choice.id}
            value={choice.id}
            aria-label={choice.spoken === undefined ? undefined : textOf(choice.spoken)}
            data-kit-focus="ring"
            className={choiceButton({ kind: "segmented" })}>
            {/* 6 px apart, the mark centred on the word's line; the words cut where the frame is held narrower. */}
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {choice.mark}
              <CutText
                text={textOf(choice.label)}
                className="min-w-0 truncate"
              />
            </span>
          </Radio>
        ))}
      </div>
      <GroupMessage errorMessage={errorMessage} />
    </RadioGroup>
  );
}

/**
 * A small multi-select of short words, such as a season's allowed Stufen: the label above, one box per answer,
 * each chosen box edged and tinted in the link green. React Aria's `CheckboxGroup`, the boxes its checkboxes, so the
 * group is heard as required and as invalid, and the browser's own check refuses it left with none chosen at the send.
 */
export function ToggleBoxes({
  label,
  errorMessage,
  choices,
  isRequired = false,
  value,
  onChange,
}: Shared & {
  value?: readonly string[];
  onChange?: (ids: string[]) => void;
}) {
  const root = useEarlyEdit();
  const lock = useFieldLock(false, false, isRequired);
  return (
    <CheckboxGroup
      ref={root}
      className={fieldRoot()}
      value={value === undefined ? undefined : [...value]}
      onChange={onChange}
      isRequired={lock.isRequired}
      // Only while refused, as `Segmented`'s.
      isInvalid={errorMessage === undefined ? undefined : true}
      isDisabled={lock.isDisabled}
      isReadOnly={lock.isReadOnly}>
      <FieldLabel
        label={label}
        isRequired={lock.isRequired}
      />
      <div className={choiceGroup({ kind: "boxes" })}>
        {choices.map((choice) => (
          <Checkbox
            key={choice.id}
            value={choice.id}
            data-kit-focus="ring"
            className={choiceButton({ kind: "boxes" })}>
            {textOf(choice.label)}
          </Checkbox>
        ))}
      </div>
      <GroupMessage errorMessage={errorMessage} />
    </CheckboxGroup>
  );
}
