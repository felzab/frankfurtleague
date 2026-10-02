import { Fragment, createElement as h } from "react";

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

/**
 * An action double answers and nothing renders after it, so on its own a press never takes its control off the page:
 * this is the render a landed write's refresh commits.
 */
export function renderUnderWrite(before: ReactNode): PageUnderWrite {
  let page = 0;
  const view = render(h(Fragment, { key: page }, before));

  // A macrotask, so every microtask the answer queued has run first.
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  return {
    answered: settle,
    refresh: async (after, { remount = false } = {}) => {
      if (remount) page += 1;
      view.rerender(h(Fragment, { key: page }, after));
      await settle();
    },
  };
}
