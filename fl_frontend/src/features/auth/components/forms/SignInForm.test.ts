import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions } from "@/shared/testing/actionDoubles.ts";

import type { FormState } from "@/shared/types/types";

/* `next/error` is CommonJS whose exports Node's static reader cannot see, so the ESM import of
   `catchError` fails at link. The shim hands on the real function rather than a stand-in. */
const NEXT_ERROR_INTEROP = `import { createRequire } from "node:module";
export const { catchError } = createRequire(${JSON.stringify(import.meta.filename)})("next/error");`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Narrowed to the card: the shim's own `require` has to reach the real module.
    if (specifier === "next/error" && (context.parentURL ?? "").endsWith("/SignInForm.tsx"))
      return { url: `data:text/javascript,${encodeURIComponent(NEXT_ERROR_INTEROP)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/** The send, replaced at the module boundary: the real one needs a session store and a mail provider. */
const { calls, answerWith } = doubleActions({ modules: ["/src/features/auth/actions.ts"] });

const { SignInForm } = await import("./SignInForm.tsx");

describe("the sign-in card's required mark", () => {
  /* The mark's opt-out reaches a field inside a `form` alone, and the unavailable panel is a `div`: a
     required field there wears HeroUI's red star, which reads as a refusal nobody made. */
  it("requires the admin's address, and claims no required field on the panel nothing can submit", async () => {
    const user = userEvent.setup();
    render(h(SignInForm));

    assert.equal(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).getAttribute("aria-required"), "true");

    await user.click(screen.getByRole("tab", { name: "Spieler" }));

    /* Both spellings of the mark, over every box the panel renders: `validationBehavior` decides which
       one a field wears, and this panel is a `div` with no `Form` above it to set that mode. */
    for (const field of within(screen.getByRole("tabpanel")).getAllByRole<HTMLInputElement>("textbox")) {
      assert.ok(
        !field.required && field.getAttribute("aria-required") === null,
        "the unavailable panel marks a field required, which draws HeroUI's red star",
      );
    }
  });
});

describe("the admin's send while it runs", () => {
  /* A pending button stops being a submit button, so `Enter` in the box submits the form by itself, and a
     second send is a second link. Read-only rather than disabled, so the box keeps the focus `Enter` left in it. */
  it("sends one link however often Enter is pressed, and holds the address read-only meanwhile", async () => {
    const user = userEvent.setup();
    let settle: (state: FormState) => void = () => undefined;
    answerWith(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(h(SignInForm));
    const address = screen.getByRole<HTMLInputElement>("textbox", { name: "E-Mail-Adresse" });

    await user.type(address, "admin@example.org{Enter}");
    assert.ok(screen.queryByRole("button", { name: "Sendet..." }), "the running send is not shown on its button");
    assert.equal(address.readOnly, true, "the address stays editable under a running send");
    assert.equal(address.disabled, false, "the address is disabled, which drops the focus that pressed Enter");

    await user.keyboard("{Enter}");
    // A second dispatch queues behind the first, so it is called only once the first has answered.
    await act(async () => {
      settle({ success: true, message: "Wir haben Dir einen Link geschickt.", submittedEmail: "admin@example.org" });
    });

    assert.equal(calls.length, 1, "a second Enter during the send sent a second link");
  });
});
