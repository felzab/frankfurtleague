"use client";

import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";

import { textOf } from "@/core/copy";

import { MessageLine, useFieldLock, useFieldWait } from "./FieldParts";
import { toggleBox, toggleField, toggleLine, toggleRow } from "./fieldStyles";
import { Icon } from "./Icon";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { CheckboxFieldProps } from "react-aria-components/Checkbox";

/**
 * The field either box stands in, React Aria's, waiting for the page's code (`useFieldWait`), and read-only in a closed
 * form (`useFieldLock`).
 */
function BoxField(field: Omit<CheckboxFieldProps, "isReadOnly">) {
  const lock = useFieldLock(false);
  return (
    <CheckboxField
      inert={useFieldWait()}
      {...field}
      isReadOnly={lock.isReadOnly}
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

// A box alone is its own press target, the kit's control size by the touch rule, the box centred in it.
const tick = tv({
  slots: {
    root: "flex justify-center",
    target:
      "group/toggle flex size-8 cursor-pointer items-center justify-center data-disabled:cursor-default data-disabled:opacity-50 data-readonly:cursor-default pointer-coarse:size-10",
  },
  variants: {
    // Dimmed as a locked act is, yet keeping the pointing hand a locked act drops, since its row answers a press with the reason.
    columnFull: { true: { target: "opacity-50" } },
  },
});

/**
 * A yes or no standing alone in a column whose head says what it is, such as „Startelf“ in a line-up's table: the
 * drawn box with no words beside it. `aria-labelledby` names it for assistive technology by the ids of the column's
 * head and of its row's name, in that order (React Aria's Checkbox page, API, `CheckboxField`).
 */
export function Tick({
  name,
  isSelected,
  isDisabled = false,
  columnFull = false,
  onChange,
  ...named
}: {
  /** The box the tick posts under, by which the form's served refusal marks it and the form's report focuses it. */
  name?: string;
  "aria-labelledby": string;
  /** The line saying why a press changed nothing, by its id. */
  "aria-describedby"?: string;
  isSelected: boolean;
  isDisabled?: boolean;
  /**
   * No further box of its column may be taken as things stand, such as a twelfth starter: dimmed and still pressed,
   * the press asking its owner, who keeps the box empty and says why on the line `aria-describedby` names.
   */
  columnFull?: boolean;
  onChange: (isSelected: boolean) => void;
}) {
  const look = tick({ columnFull });
  return (
    <BoxField
      className={look.root()}
      aria-labelledby={named["aria-labelledby"]}
      aria-describedby={named["aria-describedby"]}
      name={name}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}>
      <CheckboxButton className={look.target()}>
        {({ isSelected: selected, isInvalid: invalid }) => (
          <Box
            selected={selected}
            invalid={invalid}
            alone
          />
        )}
      </CheckboxButton>
    </BoxField>
  );
}

/** A saved yes or no, such as a consent. */
export function Checkbox({
  label,
  description,
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
      isDisabled={isDisabled}>
      <CheckboxButton className={toggleRow({ in: "field" })}>
        {({ isSelected: selected, isInvalid: invalid }) => (
          <>
            <Box
              selected={selected}
              invalid={invalid}
            />
            <span>{textOf(label)}</span>
          </>
        )}
      </CheckboxButton>
      {description !== undefined && (
        <div className={toggleLine()}>
          <MessageLine description={description} />
        </div>
      )}
    </BoxField>
  );
}
