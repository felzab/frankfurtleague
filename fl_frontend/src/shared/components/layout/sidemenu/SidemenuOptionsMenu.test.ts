import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { KONTO_HREF } from "@/core/kontoHref.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FormState } from "@/shared/types/types.ts";

// `await import`: a static one links the component before the render hooks above can load it.
const { SidemenuOptionsMenu } = await import("./SidemenuOptionsMenu.tsx");

const signOut = (): Promise<FormState> => Promise.resolve(null);

async function openedWith(kontoHref: string | null): Promise<void> {
  render(underNext(h(SidemenuOptionsMenu, { isDesktopCollapsed: false, onSignOut: signOut, kontoHref: kontoHref }), { pathname: "/bereich" }));
  await userEvent.setup().click(screen.getByRole("button", { name: "Weitere Optionen" }));
  await screen.findByRole("menu");
}

describe("the drawer's way to the account page (`docs/frontend/spec.md :: I423`)", () => {
  /* Below `lg` the bar's link is hidden, and this item is the one way to the page there. */
  it("offers „Konto“ as a link to the account page the shell declares", async () => {
    await openedWith(KONTO_HREF);

    assert.equal(screen.getByRole("menuitem", { name: "Konto" }).getAttribute("href"), KONTO_HREF);
  });

  it("offers no account item where the shell declares no account page", async () => {
    await openedWith(null);

    assert.ok(screen.queryByRole("menuitem", { name: "Konto" }) === null);
    assert.ok(screen.getByRole("menuitem", { name: "Abmelden" }), "the control: the section itself stands");
  });
});
