// @vitest-environment jsdom
import { act } from "react";

import { render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { FormFooter } from "./FormFooter";

const REFUSAL = COPY.shared.failure.unexpected;
const BACK = COPY.shared.back;
const SAVE = COPY.shared.verb.save;

const footer = (
  <FormFooter status={{ tone: "error", text: REFUSAL }}>
    <button type="button">{BACK}</button>
    <button type="submit">{SAVE}</button>
  </FormFooter>
);

/**
 * The layout the page stands in, the rail's width from `lg`, else a phone's; the answer crosses `lg` as a zoom or a
 * resize does it, through the query's `change`.
 */
function standAt(layout: "phone" | "desktop") {
  const query = Object.assign(new EventTarget(), { matches: layout === "desktop" });
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(query, { media }) as MediaQueryList);
  return (to: "phone" | "desktop") => {
    act(() => {
      query.matches = to === "desktop";
      query.dispatchEvent(new Event("change"));
    });
  };
}

/** The acts as the keys meet them. */
const keyOrder = (root: ParentNode) => [...root.querySelectorAll("button")].map((button) => button.textContent);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a form's footer", () => {
  // The harm: a keyboard meeting the acts in another order than the screen shows them, which no layout check sees. jsdom
  // lays nothing out, so the order the CSS draws is a drive's to read.
  it("holds the main act first in the document where its acts stack, under the refusal's line", () => {
    standAt("phone");
    const { container } = render(footer);
    expect(keyOrder(container)).toStrictEqual([SAVE, BACK]);
    const line = screen.getByText(REFUSAL);
    expect(line.textContent).toBe(REFUSAL);
    expect(line.compareDocumentPosition(screen.getByRole("button", { name: SAVE })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("holds the main act last in the document where its acts stand in a row", () => {
    standAt("desktop");
    const { container } = render(footer);
    expect(keyOrder(container)).toStrictEqual([BACK, SAVE]);
  });

  // The harm: the keyboard's place dropped to the page's start when a zoom or a resize crosses `lg` under a focused act.
  // Moving a focused node hands the focus to the viewport, which jsdom does as browsers do; React's commit gives it
  // back to a node it moved, never to one it mounted anew, so the case holds the acts moved rather than remounted.
  it("keeps the focus on the act that holds it as the order turns either way", () => {
    const turn = standAt("desktop");
    render(footer);
    const back = screen.getByRole("button", { name: BACK });
    const save = screen.getByRole("button", { name: SAVE });

    back.focus();
    turn("phone");
    expect(keyOrder(document)).toStrictEqual([SAVE, BACK]);
    expect(document.activeElement).toBe(back);

    save.focus();
    turn("desktop");
    expect(keyOrder(document)).toStrictEqual([BACK, SAVE]);
    expect(document.activeElement).toBe(save);
  });

  it("turns the server's row order to the stack's on a phone as it hydrates, without a mismatch", async () => {
    standAt("phone");
    const container = document.createElement("div");
    container.innerHTML = renderToString(footer);
    document.body.append(container);
    // The server answers the row: its markup holds the row's order, which the CSS draws with the main act on top on a phone.
    expect(keyOrder(container)).toStrictEqual([BACK, SAVE]);
    // An act the keys reached before the page's code ran is the one the turn moves.
    const back = screen.getByRole("button", { name: BACK });
    back.focus();

    const mismatches: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, footer, { onRecoverableError: (error) => mismatches.push(error) });
    });
    expect(mismatches).toStrictEqual([]);
    expect(keyOrder(container)).toStrictEqual([SAVE, BACK]);
    expect(document.activeElement).toBe(back);
    container.remove();
  });
});
