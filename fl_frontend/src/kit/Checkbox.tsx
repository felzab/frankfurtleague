"use client";

import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";

import { textOf } from "@/core/copy";

import { MessageLine, RequiredMark } from "./FieldParts";
import { messageLine, toggleBox, toggleField, toggleLine, toggleRow } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { Icon } from "./Icon";
import { placeholderBar, PlaceholderSentence } from "./Skeleton";

import type { Copy, Words } from "@/core/copy";

/**
 * A box while its record is read: the drawn box as a bar, its label as lines, wrapping as the label will, and its
 * description's line where its record shows one.
 */
export function CheckboxPlaceholder({ label, description }: { label: string; description?: Copy }) {
  return (
    <div className={toggleField()}>
      <span className={toggleRow({ in: "field" })}>
        <span className={placeholderBar(toggleBox({ shape: "square", class: "border-transparent" }))} />
        <PlaceholderSentence
          text=""
          words={label}
        />
      </span>
      {description !== undefined && (
        <div className={toggleLine()}>
          <PlaceholderSentence
            text={messageLine()}
            words={description}
          />
        </div>
      )}
    </div>
  );
}

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
  ...described
}: {
  label: Words;
  description?: Copy;
  /** A line outside the field describing it, such as a consent's, by its id; read with the description's own. */
  "aria-describedby"?: string;
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
      aria-describedby={described["aria-describedby"]}
      name={name}
      isSelected={isSelected}
      defaultSelected={defaultSelected}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={useDisabled(isDisabled)}>
      <CheckboxButton className={toggleRow({ in: "field" })}>
        {({ isSelected: selected, isInvalid: invalid }) => (
          <>
            {/* The ring goes around the box alone, so the box is the button's direct child. */}
            <span
              data-kit-focus="box"
              className={toggleBox({ shape: "square", selected, invalid })}>
              {selected && (
                <Icon
                  glyph="check"
                  size={12}
                />
              )}
            </span>
            <span>
              {textOf(label)}
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
