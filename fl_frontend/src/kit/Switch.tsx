"use client";

import { SwitchButton, SwitchField } from "react-aria-components/Switch";

import { MessageLine } from "./FieldParts";
import { switchThumb, switchTrack, toggleLine, toggleRow } from "./fieldStyles";

import type { Copy } from "@/core/copy";

/**
 * A yes or no that takes effect at once, or reveals an optional part of a saved form beneath it. Its
 * label names the action the switch performs, never the state it shows.
 */
export function Switch({
  label,
  description,
  isDisabled = false,
  name,
  isSelected,
  defaultSelected,
  onChange,
}: {
  label: Copy;
  description?: Copy;
  isDisabled?: boolean;
  name?: string;
  isSelected?: boolean;
  defaultSelected?: boolean;
  onChange?: (isSelected: boolean) => void;
}) {
  return (
    <SwitchField
      className="flex flex-col gap-1"
      name={name}
      isSelected={isSelected}
      defaultSelected={defaultSelected}
      onChange={onChange}
      isDisabled={isDisabled}>
      <SwitchButton className={toggleRow()}>
        {({ isSelected: selected }) => (
          <>
            {/* The ring goes around the track alone, so the track is the button's direct child. */}
            <span
              data-kit-focus="box"
              className={switchTrack({ selected })}>
              <span className={switchThumb({ selected })} />
            </span>
            {label}
          </>
        )}
      </SwitchButton>
      {description !== undefined && (
        <div className={toggleLine({ box: "track" })}>
          <MessageLine description={description} />
        </div>
      )}
    </SwitchField>
  );
}
