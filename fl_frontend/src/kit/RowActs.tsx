"use client";

import { useLayoutEffect, useRef } from "react";

import type { ReactNode, RefObject } from "react";

/** What stands around a list's rows and outlives them: a table, a Konto box. The page's `h1` stands behind it. */
const HOME = '[data-kit-focus="home"]';

// Focusable only while it holds the focus, as a skip link's target is, so it is never a stop for Tab or a press.
function takeFocus(home: HTMLElement) {
  home.tabIndex = -1;
  home.addEventListener("blur", () => home.removeAttribute("tabindex"), { once: true });
  home.focus({ preventScroll: true });
}

/**
 * Where the focus goes when a row leaves with what held it: the act that removed the row took its own dialog's return
 * address along, and React Aria then finds nothing to go back to, which drops a keyboard's place on `body`. The APG's
 * dialog pattern asks for the next logical place instead, the list the row stood in, or the page's title where a card
 * left with its last row. The frame after the commit, as React Aria's own restore runs, and only for focus lost to
 * `body`: anywhere else it was moved on purpose. A node still connected was hidden with its page, not removed.
 */
export function useFocusHome(row: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = row.current;
    return () => {
      const homes = [node?.closest<HTMLElement>(HOME), document.querySelector("h1")];
      requestAnimationFrame(() => {
        if (node?.isConnected !== false || document.activeElement !== document.body) return;
        const home = homes.find((candidate) => candidate?.isConnected === true);
        if (home !== undefined && home !== null) takeFocus(home);
      });
    };
  }, [row]);
}

/** The acts of a row a server component draws, which is what can leave with its row. */
export function RowActs({ className, children }: { className: string; children: ReactNode }) {
  const acts = useRef<HTMLSpanElement>(null);
  useFocusHome(acts);
  return (
    <span
      ref={acts}
      className={className}>
      {children}
    </span>
  );
}
