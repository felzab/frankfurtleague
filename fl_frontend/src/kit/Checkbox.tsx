"use client";

import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";

import { textOf } from "@/core/copy";

import { MessageLine, RequiredMark } from "./FieldParts";
import { messageLine, toggleBox, toggleField, toggleLine, toggleRow } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { Icon } from "./Icon";
import { placeholderBar, PlaceholderSentence } from "./Skeleton";
import { tv } from "./tv";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy, Words } from "@/core/copy";
import type { CheckboxFieldProps } from "react-aria-components/Checkbox";

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
 * The field either box stands in, React Aria's, holding on its root what a person did to the box before the page
 * hydrated (`useEarlyEdit`) and reading its form's closed state.
 */
function BoxField({ isDisabled, ...field }: Omit<CheckboxFieldProps, "isDisabled"> & { isDisabled: boolean }) {
  const root = useEarlyEdit();
  return (
    <CheckboxField
      ref={root}
      {...field}
      isDisabled={useDisabled(isDisabled)}
    />
  );
}

/** The drawn box. The ring goes around the box alone, so the box is its button's direct child. */
function Box({ selected, invalid, alone = false }: { selected: boolean; invalid: boolean; alone?: boolean }) {
  return (
    <span
      data-kit-focus="box"
      // A box alone centres on its target, with no label's first line to stand a pixel down for.
      className={toggleBox({ shape: "square", selected, invalid, class: alone ? "mt-0" : undefined })}>
      {selected && (
        <Icon
          glyph="check"
          size={12}
        />
      )}
    </span>
  );
}

// A box alone is its own press target, the kit's control size by the touch rule (`fieldStyles.ts`), the box centred in it.
const tick = tv({
  slots: {
    root: "flex justify-center",
    target:
      "group/toggle flex size-8 cursor-pointer items-center justify-center data-disabled:cursor-default data-disabled:opacity-50 pointer-coarse:size-10",
  },
  variants: {
    // Dimmed as a locked act is, the pointing hand kept, since a press is answered with the reason.
    locked: { true: { target: "opacity-50" } },
  },
});

/**
 * A yes or no standing alone in a column whose head says what it is, such as „Startelf“ in a line-up's table: the
 * drawn box with no words beside it. `aria-labelledby` names it for assistive technology by the ids of the column's
 * head and of its row's name, in that order (React Aria's Checkbox page, API, `CheckboxField`).
 */
export function Tick({
  isSelected,
  isDisabled = false,
  locked = false,
  onChange,
  ...named
}: {
  "aria-labelledby": string;
  /** The line saying why a press changed nothing, by its id. */
  "aria-describedby"?: string;
  isSelected: boolean;
  isDisabled?: boolean;
  /**
   * No further box of its column may be taken as things stand, such as a twelfth starter: dimmed and still pressed,
   * the press asking its owner, who keeps the box empty and says why on the line `aria-describedby` names.
   */
  locked?: boolean;
  onChange: (isSelected: boolean) => void;
}) {
  const look = tick({ locked });
  return (
    <BoxField
      className={look.root()}
      aria-labelledby={named["aria-labelledby"]}
      aria-describedby={named["aria-describedby"]}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}>
      <CheckboxButton className={look.target()}>
        {({ isSelected: selected }) => (
          <Box
            selected={selected}
            invalid={false}
            alone
          />
        )}
      </CheckboxButton>
    </BoxField>
  );
}

/**
 * A saved yes or no, such as a consent: the drawn box, its label to the
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
    <BoxField
      className={toggleField()}
      aria-describedby={described["aria-describedby"]}
      name={name}
      isSelected={isSelected}
      defaultSelected={defaultSelected}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}>
      <CheckboxButton className={toggleRow({ in: "field" })}>
        {({ isSelected: selected, isInvalid: invalid }) => (
          <>
            <Box
              selected={selected}
              invalid={invalid}
            />
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
    </BoxField>
  );
}
