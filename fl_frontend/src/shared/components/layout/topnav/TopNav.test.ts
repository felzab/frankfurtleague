import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import`, never a static import beside the render hooks (`docs/frontend/spec.md` §1.9). */
const { TopNav } = await import("./TopNav.tsx");

describe("the public bar's way into the person area", () => {
  /* The public chrome knows no session: the link is the same for every visitor, and the area's own
     guard sends one signed in nowhere on to the sign-in. Rendered here with no request at all. */
  it("links „Dein Bereich“ to the area's landing for every visitor", () => {
    const html = renderTree(underNext(h(TopNav), { pathname: "/dashboard" }));

    assert.match(html, /<a[^>]*href="\/bereich"[^>]*>Dein Bereich<\/a>/);
  });

  /* Below `lg` the bar's link is hidden and the menu's item is the one way in, rendered by a second
     element the link's case above never reaches. */
  it("links the menu's „Dein Bereich“ item to the area's landing", async () => {
    render(underNext(h(TopNav), { pathname: "/dashboard" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Navigationsmenü öffnen" }));

    const item = await screen.findByRole("menuitem", { name: "Dein Bereich" });
    assert.equal(item.getAttribute("href"), "/bereich");
  });

  it("renders without a request to read a session from", () => {
    assert.ok(!(TopNav() instanceof Promise), "the public bar waits on a request, and every public page with it");
  });
});
