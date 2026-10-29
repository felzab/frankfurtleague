"use client";

import { RadioGroup as AriaRadioGroup, Radio } from "react-aria-components/RadioGroup";

import { FieldLabel, MessageLine } from "./FieldParts";
import { choiceCard, fieldRoot, radioDot, radioList, toggleBox, toggleRow } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { Choice } from "./FieldParts";

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
  ...answers
}: {
  label: Copy;
  description?: Copy;
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string) => void;
} & ({ layout?: "list"; choices: readonly Choice[] } | { layout: "cards"; choices: readonly DescribedChoice[] })) {
  return (
    <AriaRadioGroup
      className={fieldRoot()}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}>
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
                        <span className={card.title()}>{choice.label}</span>
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
                className={toggleRow({ in: "list" })}>
                {({ isSelected, isInvalid }) => (
                  <>
                    <Circle
                      isSelected={isSelected}
                      isInvalid={isInvalid}
                    />
                    {choice.label}
                  </>
                )}
              </Radio>
            ))}
      </div>
      <MessageLine description={description} />
    </AriaRadioGroup>
  );
}
