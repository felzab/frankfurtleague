import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { exportingModule } from "@/core/exportingModule.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";

import type { FormState } from "@/shared/types/types";

/** Every path the card left the document for. */
const left: string[] = [];

/* A full document navigation, which jsdom does not implement and whose `location` no test can
   replace: recorded at the module boundary. */
const NAVIGATION_DOUBLE = exportingModule({ leaveDocumentFor: (path: string) => void left.push(path) });

/* The passkey button's browser client, which reads the page's origin as it loads, and this window
   has none. No case presses the button. */
const CLIENT_DOUBLE = `export const authClient = { signIn: { passkey: async () => ({ error: null }) } };`;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/src/shared/utils/documentNavigation.ts")) return { format: "module", source: NAVIGATION_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/authClient.ts")) return { format: "module", source: CLIENT_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** The send, replaced at the module boundary: the real one needs a session store and a mail provider. */
const { calls, answerWith } = doubleActions({ modules: ["/src/features/auth/actions.ts"] });
const { raised } = doubleToasts();
const fetchMock = doubleFetch();

const { SignInForm } = await import("./SignInForm.tsx");
const { CodeStep } = await import("./CodeStep.tsx");

const ADDRESS = "vorstand@example.org";
const LANDING = "/signin/weiter";
const NEUTRAL = "Falls zu dieser Adresse ein Zugang gehört, ist ein Anmeldecode unterwegs.";
const SENT: FormState = { success: true, message: NEUTRAL, submittedEmail: ADDRESS };

/** The route's answer to one typed code, as `postPublicForm` reads it. */
const answered = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  left.length = 0;
  raised.length = 0;
  answerWith(() => Promise.resolve(SENT));
});

/** The card with the code sent to `ADDRESS`, standing on the code step. */
async function atTheCodeStep(user: ReturnType<typeof userEvent.setup>): Promise<HTMLInputElement> {
  render(h(SignInForm, { next: LANDING }));
  await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);

  return screen.findByLabelText<HTMLInputElement>("Code aus der E-Mail");
}

describe("the sign-in card's address step", () => {
  it("requires the address", () => {
    render(h(SignInForm, { next: LANDING }));

    assert.equal(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).getAttribute("aria-required"), "true");
  });

  /* The browser offers a saved passkey in this box only where `webauthn` is the LAST token. */
  it("offers the box to the browser's username and passkey autofill, passkey last", () => {
    render(h(SignInForm, { next: LANDING }));

    assert.equal(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).getAttribute("autocomplete"), "username webauthn");
  });

  /* A pending button stops being a submit button, so `Enter` in the box submits the form by itself, and a
     second send is a second code. Read-only rather than disabled, so the box keeps the focus `Enter` left in it. */
  it("sends one code however often Enter is pressed, and holds the address read-only meanwhile", async () => {
    const user = userEvent.setup();
    let settle: (state: FormState) => void = () => undefined;
    answerWith(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const before = calls.length;
    render(h(SignInForm, { next: LANDING }));
    const address = screen.getByRole<HTMLInputElement>("textbox", { name: "E-Mail-Adresse" });

    await user.type(address, `${ADDRESS}{Enter}`);
    assert.ok(screen.queryByRole("button", { name: "Sendet..." }), "the running send is not shown on its button");
    assert.equal(address.readOnly, true, "the address stays editable under a running send");
    assert.equal(address.disabled, false, "the address is disabled, which drops the focus that pressed Enter");

    await user.keyboard("{Enter}");
    // A second dispatch queues behind the first, so it is called only once the first has answered.
    await act(async () => {
      settle(SENT);
    });

    assert.equal(calls.length - before, 1, "a second Enter during the send sent a second code");
  });
});

describe("the sign-in card's two ways in", () => {
  /* The button's autofill arms against the address step's own field, so it stands where that field
     does and nowhere else. */
  it("offers the passkey beside the address step alone, under the divider", async () => {
    const user = userEvent.setup();
    render(h(SignInForm, { next: LANDING }));
    assert.ok(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
    assert.ok(screen.getByText("oder"));

    await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);
    await screen.findByLabelText("Code aus der E-Mail");

    assert.ok(screen.queryByRole("button", { name: "Mit Passkey anmelden" }) === null, "the passkey stayed on the code step");
  });
});

describe("the sign-in card's code step", () => {
  /* In place, in the same tab: the code is typed where it was asked for, which is what makes a code
     read on a phone work on the laptop. */
  it("replaces the address step with the answer, the address and the code field it describes", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);

    assert.ok(screen.getByText("Prüfe Dein Postfach"));
    assert.ok(screen.getByText(ADDRESS));
    assert.ok(screen.getByText(NEUTRAL));
    assert.equal(field.getAttribute("autocomplete"), "one-time-code", "the keyboard is not offered the code from the mail");
    assert.ok(document.activeElement === field, "the step replaced the pressed button and left the focus on the document");

    const hint = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    assert.match(hint?.textContent ?? "", /^Kein Code angekommen\?/);
  });

  /* The sixth digit is the submit: a press after it is a press the reader should not have to make. */
  it("checks the code on its sixth digit, for the address it was sent to, and leaves for the landing", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true })));

    await user.type(field, "048213");

    await waitFor(() => assert.deepEqual(left, [LANDING]));
    assert.equal(fetchMock.mock.callCount(), 1);
    const [endpoint, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.equal(String(endpoint), "/api/signin/code");
    assert.deepEqual(JSON.parse(String(init?.body)), { email: ADDRESS, code: "048213" });
  });

  /* The digits go with the refusal, so retyping submits by itself again rather than waiting on a press. */
  it("says why a code was refused at the field, and empties it for the next try", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);
    const falsch = "Der Code stimmt nicht. Prüfe ihn und gib ihn noch einmal ein.";
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: false, error: falsch })));

    await user.type(field, "000000");

    const refusal = await screen.findByRole("alert");
    assert.equal(refusal.textContent, falsch);
    assert.ok((field.getAttribute("aria-describedby") ?? "").split(" ").includes(refusal.id), "the refusal describes no field");
    assert.equal(field.value, "");
    assert.deepEqual(left, []);

    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true })));
    await user.type(field, "048213");
    await waitFor(() => assert.deepEqual(left, [LANDING]));
  });

  /* An answer that was not this application's names no reason, since none reached the page. */
  it("raises a toast for an answer the edge gave instead, and leaves nothing behind at the field", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(new Response("<html>zu viele</html>", { status: 429 })));

    await user.type(field, "048213");

    await waitFor(() => assert.equal(raised.at(-1)?.title, "Nicht angemeldet"));
    assert.ok(screen.queryByRole("alert") === null, "a refusal stands at the field for an answer that was not ours");
  });

  it("returns to the address step with the address kept", async () => {
    const user = userEvent.setup();
    await atTheCodeStep(user);

    await user.click(screen.getByRole("button", { name: "Andere E-Mail-Adresse verwenden" }));

    assert.equal(screen.getByRole<HTMLInputElement>("textbox", { name: "E-Mail-Adresse" }).value, ADDRESS);
  });

  /* Driven on a clock of the case's own, taken before the step arms its cooldown, and with events
     that wait on no timer of their own, which the case's clock would hold forever. */
  it("offers the code again only once half a minute has passed", async () => {
    const before = calls.length;
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      render(h(SignInForm, { next: LANDING }));
      fireEvent.change(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), { target: { value: ADDRESS } });
      await act(async () => {
        fireEvent.submit(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).closest("form") as HTMLFormElement);
      });
      const resend = () => screen.getByRole("button", { name: "Code erneut senden" });
      assert.equal(resend().hasAttribute("disabled"), true, "the resend is open at once");

      await act(async () => {
        mock.timers.tick(29_999);
      });
      assert.equal(resend().hasAttribute("disabled"), true, "the resend opened before half a minute");

      await act(async () => {
        mock.timers.tick(1);
      });
      assert.equal(resend().hasAttribute("disabled"), false, "the resend stayed closed past half a minute");

      await act(async () => {
        fireEvent.click(resend());
      });
    } finally {
      mock.timers.reset();
    }

    assert.equal(calls.length - before, 2, "the open resend sent nothing");
  });
});

/* The step on its own, as a page confirming a signed-in person mounts it: the caller decides what a
   finished sign-in does, and an address that may not change is offered no way to change it. */
describe("the code step mounted outside the sign-in card", () => {
  it("hands a finished sign-in to its caller and leaves the document to it", async () => {
    const user = userEvent.setup();
    const signedIn = mock.fn();
    render(h(CodeStep, { address: ADDRESS, message: NEUTRAL, isSending: false, onResend: () => undefined, onSignedIn: signedIn }));
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true })));

    await user.type(screen.getByLabelText("Code aus der E-Mail"), "048213");

    await waitFor(() => assert.equal(signedIn.mock.callCount(), 1));
    assert.deepEqual(left, [], "the step navigated on its own rather than leaving that to its caller");
  });

  it("offers no other address where its caller passes no way back", () => {
    render(h(CodeStep, { address: ADDRESS, message: NEUTRAL, isSending: false, onResend: () => undefined, onSignedIn: () => undefined }));

    assert.ok(screen.queryByRole("button", { name: "Andere E-Mail-Adresse verwenden" }) === null);
    assert.ok(screen.getByRole("button", { name: "Code erneut senden" }));
  });
});
