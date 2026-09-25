"use client";

import Minus from "@gravity-ui/icons/Minus";
import Plus from "@gravity-ui/icons/Plus";

/**
 * react-aria's `step` drives the buttons AND snaps typed values to the nearest multiple on commit,
 * silently turning a typed 12 into 10, so the field carries no `step` and these step themselves.
 */
export function StepFiveButton({
  direction,
  isDisabled,
  onStep,
}: {
  direction: "decrement" | "increment";
  isDisabled: boolean;
  onStep: () => void;
}) {
  const Icon = direction === "decrement" ? Minus : Plus;
  // Spelled out, not templated: the class linter cannot see through `${direction}`, and the HeroUI
  // slot classes must survive verbatim to draw the buttons as HeroUI's own.
  const slotClass = direction === "decrement" ? "number-field__decrement-button" : "number-field__increment-button";

  return (
    <button
      type="button"
      // The attribute HeroUI's own steppers carry, which its group sizes a stepper's column from: without
      // it the group has one column and stacks the three.
      slot={direction}
      // As react-aria's own steppers are: the spinbutton already offers arrow-key stepping, making
      // these a pointer convenience.
      aria-hidden="true"
      tabIndex={-1}
      disabled={isDisabled}
      onClick={onStep}
      className={`${slotClass} text-foreground-muted hover:text-foreground flex cursor-pointer items-center justify-center transition-colors disabled:cursor-default disabled:opacity-40`}>
      <Icon className="size-4" />
    </button>
  );
}
