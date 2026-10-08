"use client";

import { Button } from "@heroui/react/button";

import { confirmButton } from "./formButtons";
import { Hint } from "./Hint";
import { NAME_WRAP_CLASSES } from "./nameWrap";
import { STEP_UP_LABEL, STEP_UP_RUNNING } from "./stepUp";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { ReactNode } from "react";

/** Marks the control a cancelled arming hands the focus back to (`ConfirmActionRow`), unless a panel names another. */
export const CONFIRM_PRESS_MARK = "data-confirm-press";

/**
 * The primary control of a two-press confirm: the refusal over it, the armed fill, the dropped glyph
 * and the three labels — every clause `docs/frontend/spec.md` §1.14's, and a panel spelling them out
 * drifts from that one clause at a time.
 */
export function ConfirmPressButton({
  confirm,
  submitting = false,
  held = false,
  reason,
  resting,
  armed,
  running,
  icon,
  onPress,
  type = "button",
  describedBy,
  restingName,
}: {
  confirm: TwoPressConfirm;
  /**
   * A one-press write this control starts at rest, the form's own submit, which runs outside the hook
   * and so is never in its `isPending`. Shown as `running`, as the hook's write is.
   */
  submitting?: boolean;
  /**
   * Held for something that is NOT the write — an arming read the press waits on. Pending-marked as a
   * write is, and the label untouched: `running` names a write nobody has started.
   */
  held?: boolean;
  /** What closes the press, or `null` where nothing does. A running write lifts it: it ends by itself. */
  reason: string | null;
  resting: string;
  /** What the control says once the first press has armed it, which is also its name while armed. */
  armed: string;
  running: string;
  /** Shown at rest alone: the glyph announces the press, and step two announces itself in words. */
  icon: ReactNode;
  onPress?: () => void;
  /** `"submit"` for a panel whose press is its form's, which then carries no `onPress`. */
  type?: "button" | "submit";
  /** A hint the resting control is described by, dropped once armed: the armed label says it. */
  describedBy?: string;
  /**
   * The resting control's name where its label repeats row after row: it names the row after the visible
   * label, which it starts with (WCAG 2.5.3). Dropped once armed, where the armed label is the name.
   */
  restingName?: string;
}) {
  const { isConfirming } = confirm;
  // The prompt's words over the panel's armed ones: this press opens the browser's passkey prompt
  // before it sends anything (`docs/frontend/spec.md :: I431`).
  const label = !isConfirming ? resting : confirm.asksPasskey ? STEP_UP_LABEL : armed;
  const writing = confirm.isPending || submitting;
  // A write in flight HOLDS the control rather than closing it (§1.14).
  const waiting = writing || held;

  return (
    <Hint
      mode="refusal"
      reason={waiting ? null : reason}
      // The overlay over a closed control is its one tab stop, so it takes the row's name as well.
      label={isConfirming ? label : (restingName ?? label)}
      // Free to shrink below the label's longest word in the `sm` row, which it would otherwise push past the card.
      className="min-w-0">
      <Button
        type={type}
        variant="primary"
        {...{ [CONFIRM_PRESS_MARK]: "" }}
        isPending={waiting}
        isDisabled={!waiting && reason !== null}
        onPress={onPress}
        aria-describedby={isConfirming ? undefined : describedBy}
        aria-label={isConfirming || waiting ? undefined : restingName}
        // A button's auto width never drops below its longest word, so the cap is what makes the label wrap.
        className={`${confirmButton(isConfirming)} max-w-full`}>
        {!isConfirming && icon}
        {/* Words the page does not write, an address among them, break mid-word rather than leave the
            button; `min-w-0` makes the label, not the icon, give up the width. */}
        <span className={`min-w-0 ${NAME_WRAP_CLASSES}`}>
          {/* The prompt's words while it is open: nothing has been sent yet. */}
          {confirm.isPrompting ? STEP_UP_RUNNING : writing ? running : label}
        </span>
      </Button>
    </Hint>
  );
}
