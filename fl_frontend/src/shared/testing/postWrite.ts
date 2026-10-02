import { Fragment, createElement as h, startTransition, useEffect, useState } from "react";

import { act, render } from "@testing-library/react";

import type { ReactNode } from "react";

/** One page under a write, whose refresh the case commits by hand. */
export type PageUnderWrite = {
  /** Lets a press's write answer and the work after its `await` run, as the action's answer would. */
  answered: () => Promise<void>;
  /**
   * Commits what the write's refresh carries. `remount` where the page keys its editor on the stored value, as every
   * editor page does, so the refresh draws every element anew.
   */
  refresh: (after: ReactNode, options?: { remount?: boolean }) => Promise<void>;
};

type Drawn = { tree: ReactNode; page: number; committed: () => void };

/** A macrotask, so every microtask queued before it has run first. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * An action double answers and nothing renders after it, so on its own a press never takes its control off the page:
 * this is the render a landed write's refresh commits.
 */
export function renderUnderWrite(before: ReactNode): PageUnderWrite {
  let draw: (next: Drawn) => void = () => undefined;

  function Page(): ReactNode {
    const [drawn, setDrawn] = useState<Drawn>({ tree: before, page: 0, committed: () => undefined });
    draw = setDrawn;
    // The parent's effect runs after every child's, so the page's own effects have run once it resolves.
    useEffect(() => drawn.committed(), [drawn]);
    return h(Fragment, { key: drawn.page }, drawn.tree);
  }

  render(h(Page));
  let page = 0;

  return {
    answered: () => act(macrotask),
    refresh: async (after, { remount = false } = {}) => {
      if (remount) page += 1;
      const committed = new Promise<void>((resolve) => {
        // Outside `act`, as a browser commits a router refresh: a transition whose effects run in a task after the
        // commit, behind the microtasks the commit's own mutations queued. Inside `act` the effects run first.
        Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
        startTransition(() => draw({ tree: after, page, committed: resolve }));
      });
      try {
        await committed;
        await macrotask();
      } finally {
        Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
      }
    },
  };
}
