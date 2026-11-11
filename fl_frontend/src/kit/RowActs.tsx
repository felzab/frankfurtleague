"use client";

import { createContext, useLayoutEffect, useRef } from "react";

import type { ReactNode, RefObject } from "react";

/** What stands around what can leave and outlives it: a table, a Konto box, a toolbar's acts. The page's `h1` stands behind it. */
const HOME = '[data-kit-focus="home"]';

/** One record of a list, whose neighbours take the focus it leaves: a table's row, a card's, a Konto box's. */
const ROW = "[data-kit-row]";

/**
 * What a keyboard reaches in a row: every act and link the kit draws is one of these, a locked act included, and a
 * record row's leading choice, whose radio the Tab key reaches unless its group holds it out (`tabindex="-1"`). A box
 * standing before a row's act, a line-up's tick, is no such place: the person removing rows one by one reaches the
 * next row's act.
 */
const PRESSABLE = 'a[href], button:not(:disabled), input[type="radio"]:not(:disabled, [tabindex="-1"])';

/** A dialog or a question standing over the page, which hands the focus back to what opened it as it closes. */
const DIALOG = '[role="dialog"], [role="alertdialog"]';

/**
 * The first press of each row out from `row` one way, nearest first: a row opening nothing, a squad row taken out, gives
 * none and is passed over, so the focus goes on to the nearest row that opens something.
 */
function pressesFrom(row: Element | null, step: (from: Element) => Element | null) {
  const presses: HTMLElement[] = [];
  for (let other = row === null ? null : step(row); other !== null; other = step(other)) {
    const press = other.querySelector<HTMLElement>(PRESSABLE);
    if (press !== null) presses.push(press);
  }
  return presses;
}

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
 * instead: the nearest row after it that opens something, or before it, so the place in a long list holds; else what
 * stood around it; else the page's title, where a card left with its last row. A row the act kept, which lost only its
 * acts, keeps the focus on its own first link instead. The frame after the commit, as React Aria's own restore runs, and only for
 * focus lost to `body`: anywhere else it was moved on purpose. A node still connected was hidden with its page, not removed.
 *
 * A dialog holding the focus as the node leaves, such as a row's dialog whose act leaves the row opening nothing, hands it
 * back only as it closes, later than that frame, and its restore finds the node gone then. The home waits for each dialog
 * the focus stands in to leave the page, then judges the frame after it as above.
 *
 * The handover acts later than the node leaves, by a frame or by a dialog's life, so it is bound to what the node left.
 * Only a node leaving with the focus hands it on, the focus inside it or in a dialog it handed the focus to, judged as it
 * leaves, since by the frame after the focus stands on `body` either way: a row leaving while the focus stood nowhere
 * would pull it onto the row beside it. And it lands only in the page it left, which a page torn down whole, its root
 * unmounted, takes along: else its frame, arriving after another page stands, would take that page's focus to that
 * page's title, ahead of the handover of that page's own.
 */
export function useFocusHome(held: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = held.current;
    if (node === null) return;
    // The dialog the focus last left the node for: a dialog opened from a press takes the focus straight from it, so
    // the press's `focusout` names the dialog as the focus's new place.
    let opened: Element | null = null;
    const leave = (event: FocusEvent) => {
      opened = event.relatedTarget instanceof Element ? event.relatedTarget.closest(DIALOG) : null;
    };
    node.addEventListener("focusout", leave);
    return () => {
      node.removeEventListener("focusout", leave);
      const focused = document.activeElement;
      // The focus in the dialog the node opened, or in one standing over it, such as a danger row's question over a
      // row's dialog, which hands it back to that dialog as it closes.
      const standing = focused?.closest(DIALOG) ?? null;
      if (!node.contains(focused) && !(opened?.isConnected === true && standing !== null)) return;
      // Read here, while the row still has its neighbours: the frame after, it has none.
      const row = node.closest(ROW);
      // Every row's press after it, then before it, each nearest first: the frame after, a press the same refresh took
      // away is passed over as a row opening nothing is.
      const neighbours = [...pressesFrom(row, (from) => from.nextElementSibling), ...pressesFrom(row, (from) => from.previousElementSibling)];
      const around = node.closest<HTMLElement>(HOME);
      // The page the node stood in: its outermost part under `body`, which stands as long as the page's root is mounted.
      let page: Element = node;
      while (page.parentElement !== null && page.parentElement !== document.body) page = page.parentElement;
      const land = () => {
        // A row the answer kept, such as a booking turned „Zugesagt“ whose acts left with the answer: its own first link,
        // so the keys stay on the record and its new state is heard there, rather than on the next record's.
        const own = row?.isConnected === true ? row.querySelector<HTMLElement>(PRESSABLE) : null;
        const neighbour = own ?? neighbours.find((candidate) => candidate.isConnected);
        if (neighbour !== undefined) {
          neighbour.focus({ preventScroll: true });
          return;
        }
        // The page's title as it stands by then: a one-shot form's end takes the whole page's place, its title included.
        const title = page.isConnected ? page.querySelector<HTMLElement>("h1") : null;
        const home = [around, title].find((candidate) => candidate?.isConnected === true);
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
        if (!node.isConnected) settle();
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
