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

  /* The page's header carries the league's mark; the card under it carries no glyph of its own. */
  it("draws no glyph above its title", () => {
    render(underNext(h(SignedInCard, { address: ADDRESS }), { router: recordingRouter().router }));

    assert.doesNotMatch(document.body.textContent ?? "", /\p{Extended_Pictographic}/u);
  });

  /* A border colour alone draws nothing: the rule under the title is a filled hairline, HeroUI's separator in the app's grey. */
  it("draws a rule under its title", () => {
    render(underNext(h(SignedInCard, { address: ADDRESS }), { router: recordingRouter().router }));

    const rule = document.querySelector('[data-slot="separator"]') ?? assert.fail("the card draws no rule under its title");
    assert.ok(rule.classList.contains("separator--horizontal"), "the rule is not HeroUI's one-pixel horizontal separator");
    assert.ok(rule.classList.contains("bg-border"), "the rule is drawn in HeroUI's grey rather than the app's border colour");
  });

  /* A link is given no `data-hovered`, so a hover keyed on it never shows; a HeroUI button latches CSS
     `:hover` after a tap (`fl_frontend/src/shared/components/ui/formButtons.ts :: ctaButton`). */
  it("hovers the link by CSS and the sign-out by the attribute its button sets", () => {
    render(underNext(h(SignedInCard, { address: ADDRESS }), { router: recordingRouter().router }));

    const hovers = (element: HTMLElement, prefix: string): string[] => [...element.classList].filter((name) => name.startsWith(prefix));
    const link = screen.getByRole("link", { name: "Weiter zu Deinem Bereich" });
    const signOut = screen.getByRole("button", { name: "Abmelden" });

    assert.notDeepEqual(hovers(link, "hover:"), [], "the link shows no hover at all");
    assert.deepEqual(hovers(link, "data-hovered:"), [], "the link hovers on an attribute no link is given");
    assert.notDeepEqual(hovers(signOut, "data-hovered:"), [], "the sign-out shows no hover at all");
    assert.deepEqual(hovers(signOut, "hover:"), [], "the sign-out hovers by CSS, which a tap latches");
  });
});
