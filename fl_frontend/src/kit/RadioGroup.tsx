"use client";

import { RadioGroup as AriaRadioGroup, RadioButton, RadioField } from "react-aria-components/RadioGroup";

import { textOf } from "@/core/copy";

import { FieldLabel, MessageLine, useFieldLock, useFieldWait } from "./FieldParts";
import { choiceCard, choiceField, fieldRoot, radioDot, radioList, toggleBox, toggleRow } from "./fieldStyles";

import type { Copy, Words } from "@/core/copy";
import type { Choice } from "./FieldParts";

/**
 * An answer of the list: the catalogue's words, or a wording of its own such as a consent's option, which stands as
 * it was shown; one the person may not pick stays in the list, closed.
 */
type ListChoice = { id: string; label: Words; isDisabled?: boolean };

/**
 * An answer that needs describing: its title and the one line under it, or its title alone where the title says the
 * whole answer, as the same-person question's „Als … aufnehmen“ does.
 */
type DescribedChoice = Choice & { line?: Copy };

/**
 * The circle drawn for an answer, the ring's target, so it stays its answer's button's direct child. Left empty in a
 * required group at the send, it takes the red edge a checkbox and every other field show.
 */
function Circle({ isSelected, invalid }: { isSelected: boolean; invalid: boolean }) {
  return (
    <span
      data-kit-focus="box"
      className={toggleBox({ shape: "round", selected: isSelected, invalid })}>
      {isSelected && <span className={radioDot()} />}
    </span>
  );
}

/**
 * One required choice of two to four, one drawn circle per answer. Where each answer needs describing, the answers are
 * selectable cards.
 */
export function RadioGroup({
  label,
  isRequired = false,
  name,
  defaultValue,
  "aria-describedby": describedBy,
  ...answers
}: {
  label: Words;
  /** A line outside the group describing it, such as a consent's, by its id. */
  "aria-describedby"?: string;
  isRequired?: boolean;
  name?: string;
  defaultValue?: string | null;
} & ({ layout?: "list"; choices: readonly ListChoice[] } | { layout: "cards"; choices: readonly DescribedChoice[] })) {
  const lock = useFieldLock(false, isRequired);
  return (
    <AriaRadioGroup
      inert={useFieldWait()}
      className={fieldRoot()}
      aria-describedby={describedBy}
      name={name}
      defaultValue={defaultValue}
      isRequired={lock.isRequired}
      isReadOnly={lock.isReadOnly}>
      <FieldLabel
        label={label}
        isRequired={lock.isRequired}
      />
      <div className={radioList()}>
        {answers.layout === "cards"
          ? answers.choices.map((choice) => {
              const card = choiceCard();
              return (
                <RadioField
                  key={choice.id}
                  value={choice.id}
                  className={choiceField()}>
                  <RadioButton className={card.card()}>
                    {({ isSelected, isInvalid }) => (
                      <>
                        <Circle
                          isSelected={isSelected}
                          invalid={isInvalid}
                        />
                        <span className={card.words()}>
                          <span className={card.title()}>{textOf(choice.label)}</span>
                          {/* None without a line: an empty one would still take the grid's gap under the title. */}
                          {choice.line !== undefined && <span className={card.line()}>{choice.line}</span>}
                        </span>
                      </>
                    )}
                  </RadioButton>
                </RadioField>
              );
            })
          : answers.choices.map((choice) => (
              <RadioField
                key={choice.id}
                value={choice.id}
                isDisabled={choice.isDisabled}
                className={choiceField()}>
                <RadioButton className={toggleRow({ in: "list" })}>
                  {({ isSelected, isInvalid }) => (
                    <>
                      <Circle
                        isSelected={isSelected}
                        invalid={isInvalid}
                      />
                      {textOf(choice.label)}
                    </>
                  )}
                </RadioButton>
              </RadioField>
            ))}
      </div>
      <MessageLine />
    </AriaRadioGroup>
  );
}
