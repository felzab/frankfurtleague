import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type { FormState } from "@/shared/types/types";

const handleSignIn = mock.fn<(previous: FormState | undefined, submitted: FormData) => Promise<FormState>>();
Reflect.set(globalThis, "__flSignIn", { handleSignIn });

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
  // The send replaced at the module boundary by the mock above: the real one needs a session store and a mail provider.
  load(url, context, nextLoad) {
    if (url.endsWith("/src/features/auth/actions.ts"))
      return { format: "module", source: "export const { handleSignIn } = globalThis.__flSignIn;", shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { SignInForm } = await import("./SignInForm.tsx");

describe("the sign-in card's required mark", () => {
  /* The mark's opt-out reaches a field inside a `form` alone, and the unavailable panel is a `div`: a
     required field there wears HeroUI's red star, which reads as a refusal nobody made. */
  it("requires the admin's address, and claims no required field on the panel nothing can submit", async () => {
    const user = userEvent.setup();
    const { container } = render(h(SignInForm));

    assert.equal(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).getAttribute("aria-required"), "true");

    await user.click(screen.getByRole("tab", { name: "Spieler" }));

    assert.equal(within(screen.getByRole("tabpanel")).getByRole("textbox", { name: "E-Mail-Adresse" }).getAttribute("aria-required"), null);
    assert.equal(container.querySelector('[data-required="true"]'), null, "the unavailable panel's field draws the required star");
  });
});

describe("the admin's send while it runs", () => {
  /* A pending button stops being a submit button, so `Enter` in the box submits the form by itself, and a
     second send is a second link. Read-only rather than disabled, so the box keeps the focus `Enter` left in it. */
  it("sends one link however often Enter is pressed, and holds the address read-only meanwhile", async () => {
    const user = userEvent.setup();
    let beantworte: (state: FormState) => void = () => undefined;
    handleSignIn.mock.mockImplementation(
      () =>
        new Promise((resolve) => {
          beantworte = resolve;
        }),
    );
    render(h(SignInForm));
    const adresse = screen.getByRole<HTMLInputElement>("textbox", { name: "E-Mail-Adresse" });

    await user.type(adresse, "admin@example.org{Enter}");
    assert.ok(screen.queryByRole("button", { name: "Sendet..." }), "the running send is not shown on its button");
    assert.equal(adresse.readOnly, true, "the address stays editable under a running send");
    assert.equal(adresse.disabled, false, "the address is disabled, which drops the focus that pressed Enter");

    await user.keyboard("{Enter}");
    // A second dispatch queues behind the first, so it is called only once the first has answered.
    await act(async () => {
      beantworte({ success: true, message: "Wir haben Dir einen Link geschickt.", submittedEmail: "admin@example.org" });
    });

    assert.equal(handleSignIn.mock.callCount(), 1, "a second Enter during the send sent a second link");
  });
});
