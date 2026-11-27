"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import type { ReactNode } from "react";

/** What the keys can reach, before the `tabIndex` of each is read. */
const REACHABLE = "a[href], button, input, select, textarea, [tabindex]";

/** A section's own title, which takes the focus once nothing the keys reach is left in it. */
const HEADING = "h1, h2, h3, h4, h5, h6";

/** An open dialog or question, which a control's press can move the focus into while the control stands. */
const OVERLAY = '[role="dialog"], [role="alertdialog"]';

/**
 * Where the focus goes once `left` has left the page: the controls of its scope after it, then those before it,
 * nearest first, as React Stately's grid moves the focus off a deleted row to the nearest row at or after it, else
 * before it (`useGridState`), then the scope's title. The scope is its section, else the page's `main`, where a list's
 * table stands in no section: its next row's controls follow `left` there as they would in the table alone, and once
 * the last row leaves, the table giving way to its empty state, the controls around the table still take the focus.
 * Read before `left` leaves, while it still stands among them.
 */
function placesAfter(left: HTMLElement) {
  const section = left.closest("section") ?? left.closest("main");
  if (section === null) return null;
  const reachable = [...section.querySelectorAll<HTMLElement>(REACHABLE)].filter((place) => place.tabIndex >= 0 && !left.contains(place));
  const after = reachable.filter((place) => left.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING);
  const before = reachable.filter((place) => !after.includes(place)).reverse();
  return { controls: [...after, ...before], heading: section.querySelector<HTMLElement>(HEADING) };
}

/**
 * Gives a title the focus: at `tabIndex` -1, which the keys never reach, and with the kit's resting focus mark, so it
 * shows no ring it never showed before (`app/focus.css`).
 */
function focusTitle(heading: HTMLElement) {
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  if (!heading.hasAttribute("data-kit-focus")) heading.setAttribute("data-kit-focus", "");
  heading.focus();
}

/**
 * Hands the focus to the nearest control still standing, once `left` has left while holding it: only where the focus
 * fell to the page's body, as React Aria's focus scope restores the focus only then, a frame after its unmount. A
 * control the page hides or leaves with takes no focus, so the next is tried; the section's title, where nothing else
 * is left, takes it (`focusTitle`).
 */
function handOn(left: HTMLElement, places: NonNullable<ReturnType<typeof placesAfter>>) {
  const page = left.ownerDocument;
  requestAnimationFrame(() => {
    // Still standing, such as a page Next hides rather than unmounts: nothing left.
    if (left.isConnected || page.activeElement !== page.body) return;
    for (const control of places.controls) {
      if (!control.isConnected) continue;
      control.focus();
      if (page.activeElement === control) return;
    }
    const { heading } = places;
    if (heading !== null && heading.isConnected) focusTitle(heading);
  });
}

/**
 * An end taking the place of the form or the step whose press reached it, such as a one-shot form's done card: its
 * title takes the focus as it arrives. The pressed button leaves with what the end replaces, so the focus would fall to
 * the page's body, or go to whatever control still stands (`FocusOnLeave`), and neither says the outcome (WCAG 2.4.3).
 * It takes the focus as it mounts, ahead of the frame in which a leaving act or dialog looks for a place, and both leave
 * a focus standing off the page's body where it is. A passive effect, not a layout one: a modal closing in the same
 * commit, such as the question whose press reached the end, lifts the `inert` it laid on the page only in its own
 * passive effect's cleanup (`useModalOverlay`), which React runs before any passive effect a mount brings, and an inert
 * title takes no focus. Drawn as no box of its own (`contents`).
 */
export function FocusOnArrival({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const title = box.current?.querySelector<HTMLElement>(HEADING);
    if (title !== null && title !== undefined) focusTitle(title);
  }, []);
  return (
    <div
      ref={box}
      className="contents">
      {children}
    </div>
  );
}

/**
 * An act whose answer can take it off the page, such as „Zusagen“ on a row the answer drops from its card, or the
 * opener of a dialog whose save drops it: should it leave while it, or the dialog it opened, holds the focus, the
 * focus goes to the nearest control of its section still standing (`handOn`), where it would otherwise fall to the
 * page's body and the next Tab would start from the top (WCAG 2.4.3). React's focus events reach it from a dialog's
 * portal too, so it holds the focus while its dialog does, and a move into a dialog drawn elsewhere, which its press
 * opened by an open state, keeps it held. Drawn as no box of its own (`contents`), so the acts lay out as before.
 */
export function FocusOnLeave({ children }: { children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  // Whether the focus stands inside, a dialog it opened included: a move within blurs, then focuses.
  const holds = useRef(false);
  useLayoutEffect(() => {
    const own = box.current;
    return () => {
      // A leaving tree runs this before its elements leave the page, so its neighbours are read where they stood.
      if (own === null || !holds.current) return;
      const places = placesAfter(own);
      if (places !== null) handOn(own, places);
    };
  }, []);
  return (
    <span
      ref={box}
      className="contents"
      onFocus={() => {
        holds.current = true;
      }}
      onBlur={(event) => {
        // A dialog drawn outside this tree, such as a table's one dialog its rows open, takes the focus with no React
        // event reaching here, and an act there can drop the row while it holds the focus.
        const into = event.relatedTarget;
        holds.current = into instanceof Element && into.closest(OVERLAY) !== null;
      }}>
      {children}
    </span>
  );
}
