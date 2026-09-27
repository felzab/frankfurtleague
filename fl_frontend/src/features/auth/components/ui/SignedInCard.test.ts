import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

/** The sign-out, replaced at the module boundary: the real one needs a session store. */
doubleActions({ modules: ["/src/features/auth/actions.ts"] });
doubleToasts();

const { SignedInCard } = await import("./SignedInCard.tsx");

const ADDRESS = "spielerin@example.org";

describe("the sign-in page for somebody already signed in", () => {
  /* Who they are, the way on and the way out, and no second sign-in beside them. */
  it("names the address, leads on to the landing and offers the sign-out, with no sign-in field", () => {
    const { router } = recordingRouter();
    render(underNext(h(SignedInCard, { address: ADDRESS }), { router }));

    assert.ok(screen.getByText(ADDRESS));
    assert.equal(screen.getByRole("link", { name: "Weiter zu Deinem Bereich" }).getAttribute("href"), "/signin/weiter");
    assert.ok(screen.getByRole("button", { name: "Abmelden" }));
    assert.ok(screen.queryByRole("textbox") === null, "a sign-in field stands beside the signed-in card");
  });
});
