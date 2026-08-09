"use client";

import { Minus, Plus } from "@gravity-ui/icons";

/**
 * A ±5 stepper for the two currency fields, replacing react-aria's own stepper buttons.
 *
 * The two wants cannot be had from one `step` prop: react-aria's `step` drives the buttons AND
 * snaps typed values to the nearest multiple on commit, so `step={5}` silently turned a typed 12 €
 * into 10 €. Both are wanted — buttons that move in fives, and any integer typable (seventh
 * review) — so the field carries no `step` at all (typed values stay free; the handlers round
 * non-integers) and these buttons do the fives themselves.
 *
 * `aria-hidden` and out of the tab order, exactly as react-aria's own steppers are: the spinbutton
 * input already offers arrow-key stepping and free typing, so the buttons are a pointer convenience
 * with a keyboard equivalent, not the only route. They reuse the HeroUI stepper classes so the group
 * looks unchanged.
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
  // Spelled out rather than templated: the class linter cannot see through `${direction}`, and the
  // HeroUI slot classes must survive verbatim for the group's grid to place the buttons.
  const slotClass = direction === "decrement" ? "number-field__decrement-button" : "number-field__increment-button";

  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      disabled={isDisabled}
      onClick={onStep}
      className={`${slotClass} text-foreground-muted hover:text-foreground flex cursor-pointer items-center justify-center transition-colors disabled:cursor-default disabled:opacity-40`}>
      <Icon className="size-4" />
    </button>
  );
}
