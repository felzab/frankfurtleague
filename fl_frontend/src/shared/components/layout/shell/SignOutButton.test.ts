import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { FormState } from "@/shared/types/types.ts";

doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SignOutButton } = await import("./SignOutButton.tsx");

describe("the bar's sign-out while its write runs", () => {
  /* The confirming press is made with the caret on this button, and a disabled button drops that focus
     to the page in a browser, which this window does not imitate: the attribute is what is read. */
  it("holds the pressed control rather than closing it", async () => {
    const user = userEvent.setup();
    let settle: (state: FormState) => void = () => undefined;
    render(
      underNext(
        h(SignOutButton, {
          onSignOut: () =>
            new Promise<FormState>((resolve) => {
              settle = resolve;
            }),
        }),
      ),
    );

    await pressTwice(user, { resting: "Abmelden", armed: "Abmelden?" });
    const button = screen.getByRole("button", { name: "Abmelden?" });
    const disabled = (button as HTMLButtonElement).disabled;
    const held = button.getAttribute("aria-disabled");
    await act(async () => {
      settle({ success: false, error: "Versuche es erneut." });
    });

    assert.equal(disabled, false, "the running sign-out disabled the control it was pressed from");
    assert.equal(held, "true", "the running sign-out takes a second press");
  });
});
