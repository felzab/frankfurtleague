"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Dispatch, ReactNode, SetStateAction } from "react";

/** What leaving would lose: the editor's count of unsaved changes, and how to drop them. */
type LeaveGuard = { count: number; discard: () => void };

/**
 * The question a way out raised while a guard held: what it would lose, and the way out itself, taken once the person
 * discards. It stays after the question closes, so the question keeps its words while it fades.
 */
type Asked = { guard: LeaveGuard; leave: () => void; isOpen: boolean };

type Held = {
  guard: LeaveGuard | null;
  setGuard: (guard: LeaveGuard | null) => void;
  asked: Asked | null;
  setAsked: Dispatch<SetStateAction<Asked | null>>;
};

const GuardContext = createContext<Held | null>(null);

/**
 * Carries an editor's unsaved changes from the page up to its frame, whose way back a layout renders and the
 * page cannot reach otherwise, and the question a way out of the page raises over them. The rail frame mounts it once
 * around its page, with the question (`LeaveQuestion`).
 */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<LeaveGuard | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const value = useMemo(() => ({ guard, setGuard, asked, setAsked }), [guard, asked]);
  return <GuardContext value={value}>{children}</GuardContext>;
}

/**
 * How a way out asks before it leaves: `null` where leaving loses nothing, so the way out goes at once; else a call
 * raising the frame's question, which takes `leave` only once the person discards the changes.
 */
export function useAskToLeave(): ((leave: () => void) => void) | null {
  const held = useContext(GuardContext);
  if (held?.guard == null) return null;
  const { guard, setAsked } = held;
  return (leave) => setAsked({ guard, leave, isOpen: true });
}

/** The question a way out raised, for the frame drawing it: `null` until one has. */
export function useAsked(): (Asked & { close: () => void }) | null {
  const held = useContext(GuardContext);
  if (held?.asked == null) return null;
  const { asked, setAsked } = held;
  return { ...asked, close: () => setAsked((current) => current && { ...current, isOpen: false }) };
}

/**
 * Holds the way out while `count` changes are unsaved. Hidden by Next's `Activity` or gone, the page lets
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
