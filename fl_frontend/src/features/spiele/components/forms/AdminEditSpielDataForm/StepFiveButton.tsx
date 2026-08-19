"use client";

import { Minus, Plus } from "@gravity-ui/icons";

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
  // slot classes must survive verbatim for the group's grid to place the buttons.
  const slotClass = direction === "decrement" ? "number-field__decrement-button" : "number-field__increment-button";

  return (
    <button
      type="button"
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
