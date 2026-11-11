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

/** The layout the page stands in: the rail's width from `lg`, else a phone's. */
function standAt(layout: "phone" | "desktop") {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (media) => Object.assign(new EventTarget(), { media, matches: layout === "desktop" }) as MediaQueryList,
  );
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
    const line = screen.getByRole("status");
    expect(line.textContent).toBe(REFUSAL);
    expect(line.compareDocumentPosition(screen.getByRole("button", { name: SAVE })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("holds the main act last in the document where its acts stand in a row", () => {
    standAt("desktop");
    const { container } = render(footer);
    expect(keyOrder(container)).toStrictEqual([BACK, SAVE]);
  });

  it("turns the server's row order to the stack's on a phone as it hydrates, without a mismatch", async () => {
    standAt("phone");
    const container = document.createElement("div");
    container.innerHTML = renderToString(footer);
    document.body.append(container);
    // The server answers the row: its markup holds the row's order, which the CSS draws with the main act on top on a phone.
    expect(keyOrder(container)).toStrictEqual([BACK, SAVE]);

    const mismatches: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, footer, { onRecoverableError: (error) => mismatches.push(error) });
    });
    expect(mismatches).toStrictEqual([]);
    expect(keyOrder(container)).toStrictEqual([SAVE, BACK]);
    container.remove();
  });
});
