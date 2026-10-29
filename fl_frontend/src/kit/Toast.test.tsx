// @vitest-environment jsdom
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { act, render, screen } from "@testing-library/react";
import { Dialog } from "react-aria-components/Dialog";
import { Modal } from "react-aria-components/Modal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { appToast, ToastRegion } from "./Toast";

const TITLE = COPY.shared.toast.fehler;

const compiled = compiledGlobals();

// The queue is the module's own, shared by every test here: each toast runs out before the next test, on
// the timer its region started.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => vi.runAllTimers());
  vi.useRealTimers();
});

/** The region a drawn toast stands in. */
function regionOf(toast: HTMLElement): HTMLElement {
  const region = toast.closest<HTMLElement>("[data-react-aria-top-layer]");
  if (region === null) throw new Error("the toast stands in no region");
  return region;
}

describe("the toast region", () => {
  // An open modal or menu hides everything outside itself but React Aria's top-level nodes, and a node
  // added under an element it already hid stays hidden: a toast there would be silent to a screen reader.
  it("draws a toast raised under an open modal outside every hidden or inert element", () => {
    render(
      <div>
        <ToastRegion frame="rail" />
      </div>,
    );
    render(
      <Modal isOpen>
        <Dialog aria-label="Dialog">Inhalt</Dialog>
      </Modal>,
    );

    act(() => appToast("danger", TITLE));

    const hiding: string[] = [];
    for (let node: HTMLElement | null = screen.getByText(TITLE); node !== null; node = node.parentElement) {
      if (node.inert || node.getAttribute("aria-hidden") === "true") hiding.push(node.tagName);
    }
    expect(hiding).toStrictEqual([]);
  });

  // A navigation from one frame to the other mounts the other frame's region while a toast is still showing.
  it("draws a toast raised before its region mounts", () => {
    act(() => appToast("danger", TITLE));
    render(<ToastRegion frame="classic" />);

    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  // React Aria draws the region in the document's body, outside either frame: a measure that places it
  // declared on a frame alone is undefined there, and the toast falls below the screen, which nothing reports.
  it("is placed by measures the root declares", async () => {
    render(
      <>
        <ToastRegion frame="rail" />
        <ToastRegion frame="classic" />
      </>,
    );
    act(() => appToast("danger", TITLE));
    const classes = new Set(screen.getAllByText(TITLE).flatMap((toast) => [...regionOf(toast).classList]));

    const stylesheet = await compiled;
    const onRoot = new Set<string>();
    const read = new Set<string>();
    stylesheet.walkDecls((decl) => {
      if (decl.parent?.type !== "rule") return;
      const selectors = selectorsOf(decl.parent).map((selector) => selector.replace(/\\(.)/g, "$1"));
      if (selectors.some((selector) => selector.split(",").some((part) => part.trim() === ":root"))) onRoot.add(decl.prop);
      if (!selectors.some((selector) => [...classes].some((name) => selector.includes(`.${name}`)))) return;
      // A `var()` with no fallback is the one that leaves its property invalid where the name is undefined.
      for (const [, name] of decl.value.matchAll(/var\((--[\w-]+)\)/g)) read.add(name!);
    });

    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((name) => !onRoot.has(name))).toStrictEqual([]);
  });
});
