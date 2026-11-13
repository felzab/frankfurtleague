"use client";

import { SwitchButton, SwitchField } from "react-aria-components/Switch";

import { LockMark, MessageLine, useFieldLock } from "./FieldParts";
import { switchThumb, switchTrack, toggleField, toggleLine, toggleRow } from "./fieldStyles";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy } from "@/core/copy";

/**
 * A yes or no that takes effect at once, or reveals an optional part of a saved form beneath it. Its
 * label names the action the switch performs, never the state it shows. Held fixed by its record, it stands read-only
 * with the lock mark after its label, as a field's label carries it (`useFieldLock`).
 */
export function Switch({
  label,
  description,
  isDisabled = false,
  isLocked = false,
  name,
  isSelected,
  onChange,
}: {
  label: Copy;
  description?: Copy;
  isDisabled?: boolean;
  isLocked?: boolean;
  name?: string;
  isSelected?: boolean;
  onChange?: (isSelected: boolean) => void;
}) {
  const root = useEarlyEdit();
  const lock = useFieldLock(isDisabled, isLocked);
  return (
    <SwitchField
      ref={root}
      className={toggleField()}
      name={name}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={lock.isDisabled}
      isReadOnly={lock.isReadOnly}>
      <SwitchButton className={toggleRow({ in: "field" })}>
        {({ isSelected: selected }) => (
          <>
            {/* The ring goes around the track alone, so the track is the button's direct child. */}
            <span
              data-kit-focus="box"
              className={switchTrack({ selected })}>
              <span className={switchThumb({ selected })} />
            </span>
            {/* One grid item, so the lock mark follows the label in its column rather than wrapping under the track. */}
            <span>
              {label}
              {lock.isMarked && <LockMark />}
            </span>
          </>
        )}
      </SwitchButton>
      {description !== undefined && (
        <div className={toggleLine()}>
          <MessageLine description={description} />
        </div>
      )}
    </SwitchField>
  );
}
