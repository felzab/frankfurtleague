"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ReactNode } from "react";

/** What leaving would lose: the editor's count of unsaved changes, and how to drop them. */
export type LeaveGuard = { count: number; discard: () => void };

type Held = { guard: LeaveGuard | null; setGuard: (guard: LeaveGuard | null) => void };

const GuardContext = createContext<Held | null>(null);

/**
 * Carries an editor's unsaved changes from the page up to its frame, whose way back a layout renders and the
 * page cannot reach otherwise. The rail frame mounts it once around its page.
 */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<LeaveGuard | null>(null);
  const value = useMemo(() => ({ guard, setGuard }), [guard]);
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>;
}

/** The changes the way back would lose, or `null` where leaving loses nothing. */
export function useLeaveGuard() {
  return useContext(GuardContext)?.guard ?? null;
}

/**
 * Holds the way back while `count` changes are unsaved. Hidden by Next's `Activity` or gone, the page lets
 * go of it in the same layout-effect cleanup, so the frame never asks for a page no longer shown.
 */
export function useHoldLeave(count: number, discard: () => void) {
  const setGuard = useContext(GuardContext)?.setGuard;
  // The latest discard, read only when the person confirms, so a new closure does not re-register.
  const latest = useRef(discard);
  useLayoutEffect(() => {
    latest.current = discard;
  });

  useLayoutEffect(() => {
    if (setGuard === undefined || count === 0) return undefined;
    setGuard({ count, discard: () => latest.current() });
    return () => setGuard(null);
  }, [setGuard, count]);
}
