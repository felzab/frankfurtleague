"use client";

import { RadioGroup as AriaRadioGroup, Radio } from "react-aria-components/RadioGroup";

import { textOf } from "@/core/copy";

import { FieldLabel, MessageLine } from "./FieldParts";
import { choiceCard, fieldLabel, fieldRoot, messageLine, radioDot, radioList, toggleBox, toggleRow } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { placeholderBar, PlaceholderSentence } from "./Skeleton";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy, Words } from "@/core/copy";
import type { Choice } from "./FieldParts";

/**
 * An answer of the list: the catalogue's words, or a wording of its own such as a consent's option, which stands as
 * it was shown; one the person may not pick stays in the list, closed.
 */
type ListChoice = { id: string; label: Words; isDisabled?: boolean };

/** An answer that needs describing: its title and the one line under it. */
type DescribedChoice = Choice & { line: Copy };

/**
 * The circle drawn for an answer, the ring's target, so it stays the radio's direct child. Left empty in a
 * required group at the send, it takes the red edge a checkbox and every other field show.
 */
function Circle({ isSelected, isInvalid }: { isSelected: boolean; isInvalid: boolean }) {
  return (
    <span
      data-kit-focus="box"
      className={toggleBox({ shape: "round", selected: isSelected, invalid: isInvalid })}>
      {isSelected && <span className={radioDot()} />}
    </span>
  );
}

/** A listed `RadioGroup` while its record is read: its label's lines, each answer's circle and lines, its message line. */
export function RadioGroupPlaceholder({ label, choices }: { label: string; choices: readonly string[] }) {
  return (
    <div className={fieldRoot()}>
      <PlaceholderSentence
        text={fieldLabel()}
        words={label}
      />
      <div className={radioList({ layout: "list" })}>
        {choices.map((choice) => (
          <span
            key={choice}
            className={toggleRow({ in: "list" })}>
            <span className={placeholderBar(toggleBox({ shape: "round", class: "border-transparent" }))} />
            <PlaceholderSentence
              text=""
              words={choice}
            />
          </span>
        ))}
      </div>
      <span className={messageLine()} />
    </div>
  );
}

/**
 * One required choice of two to four: the label above, one drawn circle per answer, its label right. Where
 * each answer needs describing, the answers are selectable cards: the circle, the title and its line in a box,
 * the chosen box edged in green.
 */
export function RadioGroup({
  label,
  description,
  isRequired = false,
  isDisabled = false,
  name,
  value,
  defaultValue,
  onChange,
  "aria-describedby": describedBy,
  ...answers
}: {
  label: Words;
  description?: Copy;
  /** A line outside the group describing it, such as a consent's, by its id; read with the description's own. */
  "aria-describedby"?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string) => void;
} & ({ layout?: "list"; choices: readonly ListChoice[] } | { layout: "cards"; choices: readonly DescribedChoice[] })) {
  const root = useEarlyEdit();
  return (
    <AriaRadioGroup
      ref={root}
      className={fieldRoot()}
      aria-describedby={describedBy}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={useDisabled(isDisabled)}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      <div className={radioList({ layout: answers.layout ?? "list" })}>
        {answers.layout === "cards"
          ? answers.choices.map((choice) => {
              const card = choiceCard();
              return (
                <Radio
                  key={choice.id}
                  value={choice.id}
                  className={card.card()}>
                  {({ isSelected, isInvalid }) => (
                    <>
                      <Circle
                        isSelected={isSelected}
                        isInvalid={isInvalid}
                      />
                      <span className={card.words()}>
                        <span className={card.title()}>{textOf(choice.label)}</span>
                        <span className={card.line()}>{choice.line}</span>
                      </span>
                    </>
                  )}
                </Radio>
              );
            })
          : answers.choices.map((choice) => (
              <Radio
                key={choice.id}
                value={choice.id}
                isDisabled={choice.isDisabled}
                className={toggleRow({ in: "list" })}>
                {({ isSelected, isInvalid }) => (
                  <>
                    <Circle
                      isSelected={isSelected}
                      isInvalid={isInvalid}
                    />
                    {textOf(choice.label)}
                  </>
                )}
              </Radio>
            ))}
      </div>
      <MessageLine description={description} />
    </AriaRadioGroup>
  );
}
