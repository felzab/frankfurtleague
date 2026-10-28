"use client";

import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";

import { MessageLine } from "./FieldParts";
import { toggleBox, toggleLine, toggleRow } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Copy } from "@/core/copy";

/**
 * A saved yes or no, such as a consent or „Startelf“ in a line-up: the drawn box, its label to the
 * right. A required box keeps a message line under its label, where „Pflichtfeld“ appears.
 */
export function Checkbox({
  label,
  description,
  isRequired = false,
  isDisabled = false,
  name,
  isSelected,
  defaultSelected,
  onChange,
}: {
  label: Copy;
  description?: Copy;
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  isSelected?: boolean;
  defaultSelected?: boolean;
  onChange?: (isSelected: boolean) => void;
}) {
  return (
    <CheckboxField
      className="flex flex-col gap-1"
      name={name}
      isSelected={isSelected}
      defaultSelected={defaultSelected}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}>
      <CheckboxButton className={toggleRow()}>
        {({ isSelected: selected }) => (
          <>
            {/* The ring goes around the box alone, so the box is the button's direct child. */}
            <span
              data-kit-focus="box"
              className={toggleBox({ shape: "square", selected })}>
              {selected && (
                <Icon
                  glyph="haken"
                  size={16}
                />
              )}
            </span>
            {label}
          </>
        )}
      </CheckboxButton>
      {(isRequired || description !== undefined) && (
        <div className={toggleLine({ box: "square" })}>
          <MessageLine description={description} />
        </div>
      )}
    </CheckboxField>
  );
}
