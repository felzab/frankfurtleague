import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render } from "@testing-library/react";

const { SignInTokenField } = await import("./SignInTokenField.tsx");

const TOKEN = "ein-lebendiger-token";

/* The runner's document is `about:blank`, whose history refuses every address, so the browser's own
   call is recorded rather than followed and the address it was handed is what the cases read. */
const addressed: unknown[] = [];

Reflect.set(window.history, "replaceState", (_state: unknown, _unused: unknown, address: unknown) => {
  addressed.push(address);
});

beforeEach(() => {
  addressed.length = 0;
});

describe("the token the mailed link brought", () => {
  /* The address bar, a screenshot and the history entry each outlive the press, and the token is a
     live credential until it is spent. */
  it("replaces the address with one carrying no query at all", () => {
    render(h(SignInTokenField, { token: TOKEN }));

    assert.equal(addressed.length, 1, "the address the link was opened at is left standing");
    assert.doesNotMatch(String(addressed[0]), /[?&]/, "the address it replaced the link with still carries a query");
  });

  /* The half the strip would otherwise take with it: the press posts this field, not the URL. */
  it("keeps the copy of the token the press sends", () => {
    const { container } = render(h(SignInTokenField, { token: TOKEN }));
    const field = container.querySelector<HTMLInputElement>('input[type="hidden"][name="token"]');

    assert.equal(field?.value, TOKEN);
  });
});
