"use client";

import { createContext, useLayoutEffect, useRef } from "react";

import type { ReactNode, RefObject } from "react";

/** What stands around what can leave and outlives it: a table, a Konto box, a toolbar's acts. The page's `h1` stands behind it. */
const HOME = '[data-kit-focus="home"]';

/** One record of a list, whose neighbours take the focus it leaves: a table's row, a card's, a Konto box's. */
const ROW = "[data-kit-row]";

/** What a keyboard reaches in a row: every act and link the kit draws is one of these, a locked act included. */
const PRESSABLE = "a[href], button:not(:disabled)";

/** A dialog or a question standing over the page, which hands the focus back to what opened it as it closes. */
const DIALOG = '[role="dialog"], [role="alertdialog"]';

// Focusable only while it holds the focus, as a skip link's target is, so it is never a stop for Tab or a press.
function takeFocus(home: HTMLElement) {
  home.tabIndex = -1;
  home.addEventListener("blur", () => home.removeAttribute("tabindex"), { once: true });
  home.focus({ preventScroll: true });
}

/**
 * Where the focus goes when a row or a lone act leaves with what held it: the act that removed it took its own dialog's
 * return address along, and React Aria's `FocusScope` documents a restore to the element that opened it and nothing for
 * one that is gone, which drops a keyboard's place on `body`. The APG's dialog pattern asks for the next logical place
 * instead: the row after it, or before it, so the place in a long list holds; else what stood around it; else the page's
 * title, where a card left with its last row. A row the act kept, which lost only its acts, keeps the focus on its own
 * first link instead. The frame after the commit, as React Aria's own restore runs, and only for
 * focus lost to `body`: anywhere else it was moved on purpose. A node still connected was hidden with its page, not removed.
 *
 * A dialog holding the focus as the node leaves, such as a row's dialog whose act leaves the row opening nothing, hands it
 * back only as it closes, later than that frame, and its restore finds the node gone then. The home waits for each dialog
 * the focus stands in to leave the page, then judges the frame after it as above.
 */
export function useFocusHome(held: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = held.current;
    return () => {
      // Read here, while the row still has its neighbours: the frame after, it has none.
      const row = node?.closest(ROW);
      const neighbours = [row?.nextElementSibling, row?.previousElementSibling].map((other) => other?.querySelector<HTMLElement>(PRESSABLE));
      const around = node?.closest<HTMLElement>(HOME);
      const land = () => {
        // A row the answer kept, such as a booking turned „Zugesagt“ whose acts left with the answer: its own first link,
        // so the keys stay on the record and its new state is heard there, rather than on the next record's.
        const own = row?.isConnected === true ? row.querySelector<HTMLElement>(PRESSABLE) : null;
        const neighbour = own ?? neighbours.find((candidate) => candidate?.isConnected === true);
        if (neighbour !== undefined && neighbour !== null) {
          neighbour.focus({ preventScroll: true });
          return;
        }
        // The page's title as it stands by then: a one-shot form's end takes the whole page's place, its title included.
        const home = [around, document.querySelector<HTMLElement>("h1")].find((candidate) => candidate?.isConnected === true);
        if (home !== undefined && home !== null) takeFocus(home);
      };
      const settle = () => {
        if (document.activeElement === document.body) {
          land();
          return;
        }
        const dialog = document.activeElement?.closest(DIALOG);
        if (dialog === null || dialog === undefined) return;
        // Its removal is a mutation in the commit whose layout effects queue React Aria's restore, so the frame asked for
        // here runs after that restore's.
        const watch = new MutationObserver(() => {
          if (dialog.isConnected) return;
          watch.disconnect();
          requestAnimationFrame(settle);
        });
        watch.observe(document.body, { childList: true, subtree: true });
      };
      requestAnimationFrame(() => {
        if (node?.isConnected === false) settle();
      });
    };
  }, [held]);
}

/**
 * The id of the name of the row whose acts stand inside, which every button there is described by: each row's carries
 * the same label, „Zusagen“ or „Aufnehmen“, so a screen reader hears whose it is only from its row. A dialog opened from
 * the row stands outside the row's words and sets it back to none (`DialogOverlay`).
 */
export const RowName = createContext<string | undefined>(undefined);

/**
 * What a server component draws that can leave with the focus on it: a row's acts, or a lone act that goes, as a dialog's
 * trigger giving way to its locked button does. `contents` where the span is to lay nothing out. `describedBy` is the
 * id of the row's name, which each of its buttons is described by (`RowName`).
 */
export function RowActs({ className, describedBy, children }: { className: string; describedBy?: string; children: ReactNode }) {
  const acts = useRef<HTMLSpanElement>(null);
  useFocusHome(acts);
  return (
    <span
      ref={acts}
      className={className}>
      <RowName value={describedBy}>{children}</RowName>
    </span>
  );
}
