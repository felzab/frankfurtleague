"use client";

import { useRef, useState, useTransition } from "react";

import { useStepUp } from "./useStepUp";

import type { StepUpDemand } from "@/shared/components/ui/stepUp";

// Windows ships 500 ms as its double-click threshold and browsers pair a dblclick at about the
// same distance, so anything under it is one motor action rather than two read decisions.
export const DOUBLE_PRESS_MS = 500;

/**
 * Handed whole to `ConfirmActionRow` and `ConfirmPressButton`, never as flags a panel spells: a literal
 * `isPending` typechecks, and its control then never says the write is running.
 */
export interface TwoPressConfirm {
  isConfirming: boolean;
  isPending: boolean;
  /** Armed, and the armed press runs the passkey prompt before it sends (`docs/frontend/spec.md :: I431`). */
  asksPasskey: boolean;
  /** The prompt the armed press opened is open, and nothing has been sent. */
  isPrompting: boolean;
  /** Armed, and the last prompt was refused, so nothing was sent. */
  passkeyRefused: boolean;
  press: (write: () => Promise<void>) => void;
  cancel: () => void;
}

/** What a panel declares about its control. */
type TwoPressOptions = {
  guard?: () => boolean;
  /**
   * The write the armed press sends is one the server refuses from a session past the step-up window.
   * Read at each press, so a panel offering two writes declares the one it is armed on.
   */
  stepUp?: StepUpDemand;
};

/**
 * The confirm-then-write control: the first press arms, the second writes — unless it lands within
 * `DOUBLE_PRESS_MS` of the arming press — and a `guard` returning false does neither. Every
 * arming panel shares it, so no two drift apart.
 */
export function useTwoPressConfirm({ guard, stepUp = false }: TwoPressOptions = {}): TwoPressConfirm {
  // Whether the arming asked for the passkey, `null` at rest: one cell, so a render never reads the
  // arming without the label it armed on.
  const [armed, setArmed] = useState<{ readonly asksPasskey: boolean } | null>(null);
  const [isPending, startWriting] = useTransition();
  const gate = useStepUp();
  // A ref, not state: the timestamp decides inside the handler and renders nothing.
  const armedAt = useRef(0);
  // Set in the handler that starts the write, so a press landing before the render that reports
  // `isPending` is refused as surely as one landing after it.
  const isWritingRef = useRef(false);
  // The prompt counts as the press in flight: a cancel or a guard's refusal under it would disarm the
  // control over a write the prompt is about to send.
  const isInFlight = () => isPending || isWritingRef.current || gate.isPrompting;
  const isConfirming = armed !== null;

  // `write` runs inside this hook's transition, so an update it makes after its own `await` takes
  // React's standalone `startTransition` at that site, or it commits before the press lets go.
  const press = (write: () => Promise<void>) => {
    // Nothing while the write flies, whatever the panel hands its control: a press would send it
    // twice. Ahead of the guard, whose refusal would disarm the alert over a write already sent.
    if (isInFlight()) return;

    // Run on BOTH presses, not just the arming one: an editor's fields stay live between arming and
    // confirming, so a draft typed in that window would go with the revalidation the write ends on.
    if (guard !== undefined && !guard()) {
      // Disarmed as well as stopped, or the alert stands claiming a write is one press away that the
      // next press refuses again.
      setArmed(null);
      return;
    }

    if (!isConfirming) {
      armedAt.current = Date.now();
      setArmed({ asksPasskey: gate.isDue(stepUp) });
      return;
    }

    // A double-click reaches here armed: React re-renders between the clicks, so the second reads
    // `isConfirming` as true before the alert was readable. Ignored rather than disarmed, so the
    // alert stands and a press taken after reading it still confirms.
    if (Date.now() - armedAt.current < DOUBLE_PRESS_MS) return;

    // The gate reads the window again: a label that still said the write's own words when it closed
    // asks anyway. A refused prompt leaves the control armed, so the next press asks again.
    gate.confirmThen(stepUp, () => {
      isWritingRef.current = true;
      startWriting(async () => {
        try {
          await write();
        } finally {
          // Cleared under the transition's own `isPending`, which holds the press until the refresh lands.
          isWritingRef.current = false;
        }
        // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
        // so a bare clear commits while the write's refresh still holds the press.
        startWriting(() => {
          // After the response and never before it: the open alert, the destructive fill and the closed
          // cancel are what say a press is in flight, and clearing early drops all three at once.
          setArmed(null);
        });
      });
    });
  };

  // Refused in flight for the reason `press` is: disarming would drop the alert over a write already sent.
  const cancel = () => {
    if (!isInFlight()) setArmed(null);
  };

  const passkeyRefused = isConfirming && gate.refused;

  return {
    isConfirming,
    // Pending while the prompt is open too, which holds the press and the cancel as a write does.
    isPending: isPending || gate.isPrompting,
    asksPasskey: (armed?.asksPasskey ?? false) || passkeyRefused,
    isPrompting: gate.isPrompting,
    passkeyRefused,
    press,
    cancel,
  };
}
