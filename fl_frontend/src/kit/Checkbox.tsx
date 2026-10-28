"use client";

import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";

import { MessageLine, RequiredMark } from "./FieldParts";
import { toggleBox, toggleField, toggleLine, toggleRow } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Copy } from "@/core/copy";

/**
 * A saved yes or no, such as a consent or „Startelf“ in a line-up: the drawn box, its label to the
 * right, an asterisk after a required box's label as after every required field's. A required box keeps a
 * message line under its label, where „Pflichtfeld“ appears.
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
      className={toggleField()}
      name={name}
      isSelected={isSelected}
      defaultSelected={defaultSelected}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}>
      <CheckboxButton className={toggleRow({ in: "field" })}>
        {({ isSelected: selected, isInvalid: invalid }) => (
          <>
            {/* The ring goes around the box alone, so the box is the button's direct child. */}
            <span
              data-kit-focus="box"
              className={toggleBox({ shape: "square", selected, invalid })}>
              {selected && (
                <Icon
                  glyph="haken"
                  size={12}
                />
              )}
            </span>
            <span>
              {label}
              <RequiredMark isRequired={isRequired} />
            </span>
          </>
        )}
      </CheckboxButton>
      {(isRequired || description !== undefined) && (
        <div className={toggleLine()}>
          <MessageLine description={description} />
        </div>
      )}
    </CheckboxField>
  );
}
