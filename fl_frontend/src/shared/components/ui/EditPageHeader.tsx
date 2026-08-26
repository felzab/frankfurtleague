"use client";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";

import type { ReactNode } from "react";

/** What a slice fills in. The exit is the form's, so it arrives beside this rather than in it. */
export type EditPageHeaderContent = {
  title: string;
  /**
   * At most ONE thing horizontally beside the title — a status badge, a Kürzel, a phase chip. There is no
   * second slot and no line below the title: a free slot is what lets seven editors' headers diverge.
   */
  chip?: ReactNode;
  /** Only where the entity can be retired; the write is the row's, not the draft's. */
  reactivate?: { isPending: boolean; onPress: () => void };
};

/**
 * Every entity editor's chrome. The pill is above the heading rather than in it: it leaves the page, where the
 * heading only says which row is open.
 *
 * **`h2`, never `h1`** — the shell page owns that one.
 */
export function EditPageHeader({
  title,
  chip,
  reactivate,
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
      <Button
        onPress={onLeave}
        isDisabled={isLeaving}
        className={`${formButton({ intent: "nav", size: "sm" })} mb-6 w-fit gap-x-2`}>
        <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
        <span>Zurück</span>
      </Button>

      <header className="mb-6 flex w-full flex-col gap-y-2">
        {/* `flex-row` with no wrap at any width: the title truncates and the chip keeps its place, where
            wrapping would drop a phone's chip onto a ragged second line under the heading. */}
        <div className="flex w-full flex-row items-center gap-x-3">
          <h2 className="fluid-2xl text-foreground min-w-0 truncate font-extrabold tracking-tight">{title}</h2>
          {chip !== undefined && <div className="flex shrink-0 items-center">{chip}</div>}
          {reactivate !== undefined && (
            <Button
              onPress={reactivate.onPress}
              isDisabled={reactivate.isPending}
              className={`${formButton({ intent: "nav", size: "sm" })} shrink-0`}>
              {reactivate.isPending ? "Reaktiviert..." : "Reaktivieren"}
            </Button>
          )}
        </div>
        <p className="muted-hint">Änderungen gelten erst, wenn Du speicherst.</p>
      </header>
    </>
  );
}
