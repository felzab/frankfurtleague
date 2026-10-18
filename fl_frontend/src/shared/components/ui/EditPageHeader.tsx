"use client";

import ArrowUturnCwLeft from "@gravity-ui/icons/ArrowUturnCwLeft";

import { Button } from "@heroui/react/button";

import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { Hint } from "@/shared/components/ui/Hint";
import { STEP_UP_RUNNING } from "@/shared/components/ui/stepUp";
import { FOCUS_HEADING, focusSection } from "@/shared/utils/focusAfterWrite";

import type { ReactNode } from "react";

/**
 * A retirable row's two writes, each the row's rather than the draft's. One slot holding both, so an editor offering
 * the return without the retirement does not type-check.
 */
type Stilllegung = {
  isRetired: boolean;
  reactivate: { isPending: boolean; isPrompting?: boolean; onPress: () => void };
  /**
   * Handed the pressed control, which a landing anchors on. `disabledReason` is the refusal the page can already see:
   * offering what the endpoint refuses is one defect whichever control reaches it.
   */
  retire: { onPress: (pressed: Element) => void; disabledReason?: string | null };
};

/** What a slice fills in. The exit is the form's, so it arrives beside this rather than in it. */
export type EditPageHeaderContent = {
  /** A node, so a row with no name of its own can head with its stand-in word in the empty-value grade. */
  title: ReactNode;
  /**
   * At most ONE thing horizontally beside the title — a status badge, a Kürzel, a phase chip. There is no
   * second slot and no line below the title: a free slot is what lets the editors' headers diverge.
   */
  chip?: ReactNode;
  stilllegung?: Stilllegung;
};

/** The place the retirement and its reactivation share, so a landed write hands the focus from one to the other. */
const STILLLEGUNG_PLACE = "stilllegung";

/**
 * Every entity editor's chrome. The pill is above the heading rather than in it: it leaves the page, where the
 * heading only says which row is open.
 *
 * **`h2`, never `h1`** — the shell page owns that one.
 */
export function EditPageHeader({
  title,
  chip,
  stilllegung,
  onLeave,
  isLeaving,
}: EditPageHeaderContent & {
  /** The form's `requestLeave`, so this pill and Abbrechen are one guarded exit. */
  onLeave: () => void;
  /** Raised while the page goes; see `EditFormLayout` for what it clears. */
  isLeaving: boolean;
}) {
  return (
    <>
      {/* Spelled out rather than `BackButton`: this exit is `useEditorExit`'s `requestLeave`, which
          raises the discard latch on a dirty draft. A shared pill taking a bare handler would reopen
          the hole `BackButton` closes. */}
      <Button
        onPress={onLeave}
        isDisabled={isLeaving}
        className={`${formButton({ intent: "nav", size: "sm" })} mb-6 w-fit gap-x-2`}>
        <ArrowUturnCwLeft
          aria-hidden="true"
          className="size-4 shrink-0"
        />
        <span>Zurück</span>
      </Button>

      <header
        className="mb-6 flex w-full flex-col gap-y-2"
        {...focusSection("seitenkopf")}>
        {/* `flex-row` with no wrap at any width: the title truncates and the chip keeps its place, where
            wrapping would drop a phone's chip onto a ragged second line under the heading. */}
        <div className="flex w-full flex-row items-center gap-x-3">
          <h2
            {...FOCUS_HEADING}
            className="min-w-0 truncate fluid-2xl font-extrabold tracking-tight text-foreground">
            {title}
          </h2>
          {chip !== undefined && <div className="flex shrink-0 items-center">{chip}</div>}
          {stilllegung !== undefined && (
            <FocusSlot name={STILLLEGUNG_PLACE}>
              {stilllegung.isRetired ? <Reaktivieren {...stilllegung.reactivate} /> : <Stilllegen {...stilllegung.retire} />}
            </FocusSlot>
          )}
        </div>
        <p className="muted-hint">Änderungen gelten erst, wenn Du speicherst.</p>
      </header>
    </>
  );
}

const HEADER_CONTROL_CLASSES = `${formButton({ intent: "nav", size: "sm" })} shrink-0`;

function Reaktivieren({ isPending, isPrompting, onPress }: Stilllegung["reactivate"]) {
  return (
    <Button
      onPress={onPress}
      isPending={isPending}
      className={HEADER_CONTROL_CLASSES}>
      {isPrompting === true ? STEP_UP_RUNNING : isPending ? "Stellt wieder her..." : "Reaktivieren"}
    </Button>
  );
}

const STILLLEGEN = "Stilllegen";

function Stilllegen({ onPress, disabledReason = null }: Stilllegung["retire"]) {
  return (
    // One tree whether a refusal stands or not, as the save bar's, so a reason arriving never remounts the control.
    <Hint
      mode="refusal"
      reason={disabledReason}
      label={STILLLEGEN}
      className="shrink-0">
      <Button
        onPress={(event) => onPress(event.target)}
        isDisabled={disabledReason !== null}
        className={HEADER_CONTROL_CLASSES}>
        {STILLLEGEN}
      </Button>
    </Hint>
  );
}
