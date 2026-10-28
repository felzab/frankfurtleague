"use client";

import { RadioGroup as AriaRadioGroup, Radio } from "react-aria-components/RadioGroup";

import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldRoot, radioDot, radioList, toggleBox, toggleRow } from "./fieldStyles";

import type { Copy } from "@/core/copy";

/** One answer of a radio group, a fixed word or phrase. */
export type Choice = { id: string; label: Copy };

/** One required choice of two to four: the label above, one drawn circle per answer, its label right. */
export function RadioGroup({
  label,
  description,
  choices,
  isRequired = false,
  isDisabled = false,
  name,
  value,
  defaultValue,
  onChange,
}: {
  label: Copy;
  description?: Copy;
  choices: readonly Choice[];
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string) => void;
}) {
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
      <div className={radioList()}>
        {choices.map((choice) => (
          <Radio
            key={choice.id}
            value={choice.id}
            className={toggleRow()}>
            {({ isSelected }) => (
              <>
                {/* The ring goes around the circle alone, so the circle is the radio's direct child. */}
                <span
                  data-kit-focus="box"
                  className={toggleBox({ shape: "round", selected: isSelected })}>
                  {isSelected && <span className={radioDot()} />}
                </span>
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
