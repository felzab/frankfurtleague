"use client";

import { Checkbox, CheckboxGroup } from "react-aria-components/CheckboxGroup";
import { Radio, RadioGroup } from "react-aria-components/RadioGroup";
import { Text } from "react-aria-components/Text";
import { ToggleButton } from "react-aria-components/ToggleButton";
import { ToggleButtonGroup } from "react-aria-components/ToggleButtonGroup";

import { textOf } from "@/core/copy";

import { CutText } from "./CutText";
import { FieldLabel, MessageLine } from "./FieldParts";
import { choiceButton, choiceGroup, fieldLabel, fieldRoot, messageLine } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { Icon } from "./Icon";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { Tooltip } from "./Tooltip";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { Choice } from "./FieldParts";
import type { IconName } from "./Icon";

/** An answer drawn as a glyph alone, such as a theme's: `label` names it for assistive technology and in its tooltip. */
export type GlyphChoice = { id: string; glyph: IconName; label: Copy };

type Shared = {
  label: Copy;
  description?: Copy;
  choices: readonly Choice[];
  isDisabled?: boolean;
  /** The write takes no record without an answer here: the asterisk after the label, and the group heard as required. */
  isRequired?: boolean;
  /**
   * The served refusal of the field, which its line shows and its frame's edge marks: the editor's field errors name a
   * choice by its row's box, which no `name` the group posts under carries.
   */
  errorMessage?: Copy;
};

/**
 * The message line under the answers: the served refusal, the browser's own check's (`MessageLine`), else the
 * description. The refusal stands in React Aria's `errorMessage` slot, so each answer is described by it while the
 * group is invalid, as a field's input is.
 */
function GroupMessage({ description, errorMessage }: { description: Copy | undefined; errorMessage: Copy | undefined }) {
  if (errorMessage === undefined) return <MessageLine description={description} />;
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
  description,
  errorMessage,
  choices,
  isDisabled = false,
  isRequired = false,
  name,
  value,
  defaultValue,
  onChange,
}: Omit<Shared, "choices"> & {
  choices: readonly MarkedChoice[];
  /** The name the chosen answer posts under, where the form reads it; React Aria names it otherwise. */
  name?: string;
  value?: string | null;
  defaultValue?: string;
  onChange?: (id: string) => void;
  labelHidden?: boolean;
}) {
  const root = useEarlyEdit();
  return (
    <RadioGroup
      ref={root}
      className={fieldRoot()}
      aria-label={labelHidden ? label : undefined}
      orientation="horizontal"
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      isRequired={isRequired}
      // Only while refused: a stated `false` would hide the browser's own check, which React Aria then never shows.
      isInvalid={errorMessage === undefined ? undefined : true}
      isDisabled={useDisabled(isDisabled)}>
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={isRequired}
        />
      )}
      <div className={choiceGroup({ kind: "segmented" })}>
        {choices.map((choice) => (
          <Radio
            key={choice.id}
            value={choice.id}
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
      <GroupMessage
        description={description}
        errorMessage={errorMessage}
      />
    </RadioGroup>
  );
}

/**
 * A setting acting at once, each answer a glyph alone named by its tooltip, in a row the caller writes, such as the
 * account menu's theme row: the segments of `Segmented`'s frame, named by `label` for assistive technology. React
 * Aria's `ToggleButtonGroup` in single selection, its segments buttons, since a tooltip opens from a button's own
 * hover and focus, which a radio's visually hidden input never takes under a pointer: no form posts it, so nothing
 * here is required or refused. `null` chooses none while the answer is not known, as a theme is not before the page
 * hydrates.
 */
export function GlyphChoices({
  label,
  choices,
  value,
  onChange,
}: {
  label: Copy;
  choices: readonly GlyphChoice[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={value === null ? [] : [value]}
      // Every choice's id is a string, and a single choice never goes empty, so one string comes back.
      onSelectionChange={(keys) => onChange(String([...keys][0]))}
      className={choiceGroup({ kind: "segmented" })}>
      {choices.map((choice) => (
        <Tooltip
          key={choice.id}
          label={choice.label}>
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
      ))}
    </ToggleButtonGroup>
  );
}

/** `GlyphChoices` while it waits: the frame, and each segment's glyph as a bar in its place. */
export function GlyphChoicesPlaceholder({ count }: { count: number }) {
  return (
    <span className={choiceGroup({ kind: "segmented" })}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={choiceButton({ kind: "segmented", content: "glyph" })}>
          <span className={placeholderBar("size-4")} />
        </span>
      ))}
    </span>
  );
}

/**
 * `ToggleBoxes` while its record is read: the label's line, each box at its own edge around a bar for its word, wrapping
 * as the boxes wrap, and the message line.
 */
export function ToggleBoxesPlaceholder({ count }: { count: number }) {
  return (
    <div className={fieldRoot()}>
      <PlaceholderLine
        textClass={fieldLabel()}
        widthClass="w-24"
      />
      <span className={choiceGroup({ kind: "boxes" })}>
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            className={choiceButton({ kind: "boxes" })}>
            <PlaceholderLine
              textClass=""
              widthClass="w-5"
            />
          </span>
        ))}
      </span>
      <span className={messageLine()} />
    </div>
  );
}

/**
 * A small multi-select of short words, such as a season's allowed Stufen: the label above, one box per answer,
 * each chosen box edged and tinted in the link green. React Aria's `CheckboxGroup`, the boxes its checkboxes, so the
 * group is heard as required and as invalid, and the browser's own check refuses it left with none chosen at the send.
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
  value?: readonly string[];
  defaultValue?: readonly string[];
  onChange?: (ids: string[]) => void;
}) {
  const root = useEarlyEdit();
  return (
    <CheckboxGroup
      ref={root}
      className={fieldRoot()}
      value={value === undefined ? undefined : [...value]}
      defaultValue={defaultValue === undefined ? undefined : [...defaultValue]}
      onChange={onChange}
      isRequired={isRequired}
      // Only while refused, as `Segmented`'s.
      isInvalid={errorMessage === undefined ? undefined : true}
      isDisabled={useDisabled(isDisabled)}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
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
      <GroupMessage
        description={description}
        errorMessage={errorMessage}
      />
    </CheckboxGroup>
  );
}
