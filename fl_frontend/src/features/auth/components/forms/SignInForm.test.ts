import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { MENSCH_BESTAETIGEN, TURNSTILE_FIELD } from "@/core/turnstileToken.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { TEST_SITE_KEY } from "@/shared/testing/siteverifyDouble.ts";
import { doubleTurnstile } from "@/shared/testing/turnstileDouble.ts";
import { EDGE_REFUSAL_BODY, ZU_VIELE_VERSUCHE } from "@/shared/utils/actionError.ts";

import type { FormState } from "@/shared/types/types";

/** Every path the card left the document for. */
const left: string[] = [];
/** Every time the card loaded the page again. */
let reloads = 0;

/* A full document navigation, which jsdom does not implement and whose `location` no test can
   replace: recorded at the module boundary. */
const NAVIGATION_DOUBLE = {
  leaveDocumentFor: (path: string) => void left.push(path),
  reloadDocument: () => void (reloads += 1),
};

/* The passkey button's browser client, which reads the page's origin as it loads, and this window
   has none. No case presses the button. */
const CLIENT_DOUBLE = { authClient: { signIn: { passkey: async () => ({ error: null }) } } };

registerDoubles({ modules: { "shared/utils/documentNavigation.ts": NAVIGATION_DOUBLE, "core/authClient.ts": CLIENT_DOUBLE } });

/** The send, replaced at the module boundary: the real one needs a session store and a mail provider. */
const {
  calls,
  answerWith,
  answered: codeSent,
} = doubleActions({
  modules: ["/src/features/auth/actions.ts"],
  // The form posted, which `useActionState` hands the action after its previous state.
  payloadOf: (args) => args.at(-1),
});
const { raised } = doubleToasts();
const fetchMock = doubleFetch();
const turnstile = doubleTurnstile();

const { SignInForm } = await import("./SignInForm.tsx");
const { CodeStep } = await import("./CodeStep.tsx");

const ADDRESS = "vorstand@example.org";
const LANDING = "/signin/weiter";
const NEUTRAL = "Falls zu dieser Adresse ein Konto gehört, ist ein Anmeldecode unterwegs.";
const SENT: FormState = { success: true, message: NEUTRAL, submittedEmail: ADDRESS };

/** The route's answer to one typed code, as `postPublicForm` reads it. */
const answered = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  left.length = 0;
  reloads = 0;
  raised.length = 0;
  answerWith(() => Promise.resolve(SENT));
});

/** The card with the code sent to `ADDRESS`, standing on the code step. */
async function atTheCodeStep(user: ReturnType<typeof userEvent.setup>): Promise<HTMLInputElement> {
  render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
  await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);
  await act(codeSent);

  return screen.findByLabelText<HTMLInputElement>("Code aus der E-Mail");
}

describe("the sign-in card's address step", () => {
  it("requires the address", () => {
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));

    assert.equal(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).getAttribute("aria-required"), "true");
  });

  it("takes no focus when the page opens", () => {
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));

    assert.ok(document.activeElement === document.body, "the address box took the focus on load");
  });

  /* The browser offers a saved passkey in this box only where `webauthn` is the LAST token. */
  it("offers the box to the browser's username and passkey autofill, passkey last", () => {
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));

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
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
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

  /* As Next's action client raises the edge's own 429: the body becomes the rejection's message. Read as
     any other rejection, it would replace the card with the boundary's "not reachable". */
  it("says the edge refused the send and when to try again, and keeps the address step", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.reject(new Error(EDGE_REFUSAL_BODY)));
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));

    await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);
    await act(codeSent);

    await waitFor(() =>
      assert.deepEqual(
        raised.map(({ title, description }) => ({ title, description })),
        [{ title: "Code nicht gesendet", description: ZU_VIELE_VERSUCHE }],
      ),
    );
    assert.equal(screen.queryAllByRole("textbox", { name: "E-Mail-Adresse" }).length, 1, "the refused send took the address step down");
    assert.equal(screen.queryAllByText("Die Website ist gerade nicht erreichbar.").length, 0, "the edge's refusal reached the boundary");
  });

  /* As Next's action client raises an action id the running server does not hold. The boundary's
     reset would send that same id again; a new document carries the running build's. */
  it("answers a rejected send with a panel whose press loads the page again", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.reject(new Error('Server Action "0f" was not found on the server.')));
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));

    await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);
    await act(codeSent);
    await user.click(await screen.findByRole("button", { name: "Erneut versuchen" }));

    assert.equal(reloads, 1, "the press did not load the page again");
    assert.equal(screen.queryAllByRole("textbox", { name: "E-Mail-Adresse" }).length, 0, "the press put the address step back unloaded");
  });
});

describe("the sign-in card's look", () => {
  /* The page's header carries the league's mark; neither step of the card carries a glyph of its own. */
  it("draws no glyph on the address step or the code step", async () => {
    const user = userEvent.setup();
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
    assert.doesNotMatch(document.body.textContent ?? "", /\p{Extended_Pictographic}/u, "the address step carries a glyph");

    await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);
    await act(codeSent);
    await screen.findByLabelText("Code aus der E-Mail");
    assert.doesNotMatch(document.body.textContent ?? "", /\p{Extended_Pictographic}/u, "the code step carries a glyph");
  });
});

describe("the sign-in card's two ways in", () => {
  /* The button's autofill arms against the address step's own field, so it stands where that field
     does and nowhere else. */
  it("offers the passkey beside the address step alone, under the divider", async () => {
    const user = userEvent.setup();
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
    assert.ok(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
    assert.ok(screen.getByText("oder"));

    await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);
    await act(codeSent);
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
    // The spam folder alone: whether an address is sent a code at all is the gate's.
    assert.equal(hint?.textContent, "Kein Code angekommen? Schau im Spam-Ordner nach.");
  });

  /* The sixth digit is the submit: a press after it is a press the reader should not have to make. */
  it("checks the code on its sixth digit, for the address it was sent to, and leaves for the landing", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true })));

    await user.type(field, "048213");
    await act(fetchMock.answered);

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
    const falsch = "Der Code stimmt nicht oder gilt nicht mehr. Nimm den Code aus der neuesten E-Mail oder fordere einen neuen an.";
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: false, error: falsch })));

    await user.type(field, "000000");
    await act(fetchMock.answered);

    const refusal = await screen.findByRole("alert");
    assert.equal(refusal.textContent, falsch);
    assert.ok((field.getAttribute("aria-describedby") ?? "").split(" ").includes(refusal.id), "the refusal describes no field");
    assert.equal(field.value, "");
    assert.deepEqual(left, []);

    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true })));
    await user.type(field, "048213");
    await act(fetchMock.answered);
    await waitFor(() => assert.deepEqual(left, [LANDING]));
  });

  /* An answer that was not this application's names no reason, since none reached the page. */
  it("raises a toast for an answer the edge gave instead, and leaves nothing behind at the field", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);
    fetchMock.mock.mockImplementationOnce(() =>
      Promise.resolve(new Response(EDGE_REFUSAL_BODY, { status: 429, headers: { "content-type": "text/plain" } })),
    );

    await user.type(field, "048213");
    await act(fetchMock.answered);

    await waitFor(() => assert.equal(raised.at(-1)?.title, "Nicht angemeldet"));
    assert.ok(screen.queryByRole("alert") === null, "a refusal stands at the field for an answer that was not ours");
  });

  /* The sixth digit runs the check from inside the field, so the field is the control the press was made
     with: disabled, it drops the focus to the page in a browser, which this window does not imitate. */
  it("holds the code field read-only rather than disabled while its check runs", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);
    let settle: (answer: Response) => void = () => undefined;
    fetchMock.mock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );

    await user.type(field, "048213");
    const disabled = field.disabled;
    const readOnly = field.readOnly;
    await act(async () => {
      settle(answered({ success: false, error: "Der Code stimmt nicht." }));
    });

    assert.equal(disabled, false, "the running check disabled the field the code was typed in");
    assert.equal(readOnly, true, "the field takes digits while its check runs");
  });

  /* A press of the button after an unread answer: the refusal empties the code, which closes the
     button under the caret, so the field the next code goes into takes it. */
  it("hands the code field the focus once a pressed check is refused", async () => {
    const user = userEvent.setup();
    const field = await atTheCodeStep(user);
    fetchMock.mock.mockImplementationOnce(() =>
      Promise.resolve(new Response(EDGE_REFUSAL_BODY, { status: 429, headers: { "content-type": "text/plain" } })),
    );
    await user.type(field, "048213");
    await act(fetchMock.answered);
    await waitFor(() => assert.equal(raised.at(-1)?.title, "Nicht angemeldet"));

    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: false, error: "Der Code stimmt nicht." })));
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await act(fetchMock.answered);
    await screen.findByRole("alert");

    assert.ok(document.activeElement === field, "the refusal closed the pressed button and left the focus on it rather than the field");
  });

  it("returns to the address step with the address kept and the caret in its box", async () => {
    const user = userEvent.setup();
    await atTheCodeStep(user);

    await user.click(screen.getByRole("button", { name: "Andere E-Mail-Adresse verwenden" }));

    const address = screen.getByRole<HTMLInputElement>("textbox", { name: "E-Mail-Adresse" });
    assert.equal(address.value, ADDRESS);
    assert.ok(document.activeElement === address, "the form replaced the pressed button and left the focus on the document");
  });

  /* Driven on a clock of the case's own, taken before the step arms its cooldown, and with events
     that wait on no timer of their own, which the case's clock would hold forever. */
  it("offers the code again only once half a minute has passed", async () => {
    const before = calls.length;
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
      fireEvent.change(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), { target: { value: ADDRESS } });
      await act(async () => {
        fireEvent.submit(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).closest("form") as HTMLFormElement);
      });
      // Closed with its reason, which a disabled control alone would take out of the tab order.
      closedControl("Code erneut senden", COOLDOWN_REASON);

      await act(async () => {
        mock.timers.tick(29_999);
      });
      closedControl("Code erneut senden", COOLDOWN_REASON);

      await act(async () => {
        mock.timers.tick(1);
      });
      const resend = screen.getByRole("button", { name: "Code erneut senden" });
      assert.equal(resend.hasAttribute("disabled"), false, "the resend stayed closed past half a minute");

      await act(async () => {
        fireEvent.click(resend);
      });
    } finally {
      mock.timers.reset();
    }

    assert.equal(calls.length - before, 2, "the open resend sent nothing");
  });
});

describe("the sign-in card's bot check", () => {
  /** The bot check's token each send so far carried. */
  const tokensSent = (from: number): unknown[] => calls.slice(from).map(({ payload }) => (payload as FormData).get(TURNSTILE_FIELD));

  it("sends the token its widget minted, and the resend the next one", async () => {
    const before = calls.length;
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
      const first = turnstile.lastMinted();
      fireEvent.change(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), { target: { value: ADDRESS } });
      await act(async () => {
        fireEvent.submit(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).closest("form") as HTMLFormElement);
      });
      await act(codeSent);
      await act(async () => {
        mock.timers.tick(30_000);
      });

      const second = turnstile.lastMinted();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Code erneut senden" }));
      });
      await act(codeSent);

      assert.deepEqual(tokensSent(before), [first, second]);
      assert.notEqual(first, second, "the resend spent the first send's token again");
    } finally {
      mock.timers.reset();
    }
  });

  it("sends nothing while its check has not loaded, and says so with the passkey and the league's address as the ways in", async () => {
    fetchMock.mock.mockImplementation(async () => new Response(null, { status: 204 }));
    turnstile.mintsAtOnce(false);
    const before = calls.length;
    const user = userEvent.setup();
    render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
    act(() => void turnstile.fire("error-callback", "110200"));

    await user.type(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), `${ADDRESS}{Enter}`);

    assert.equal(calls.length - before, 0, "a send left without a token");
    assert.ok(screen.getByText(NICHT_GELADEN_HIER), "the card does not say its check did not load");
    assert.deepEqual(
      raised.map(({ title, description }) => ({ title, description })),
      [{ title: "Code nicht gesendet", description: NICHT_GELADEN_HIER }],
    );
  });

  /* The code the first send mailed stays good, so a refused resend says why and leaves its step standing. */
  it("keeps the code step through a refused resend, and says why", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      render(h(SignInForm, { next: LANDING, siteKey: TEST_SITE_KEY }));
      fireEvent.change(screen.getByRole("textbox", { name: "E-Mail-Adresse" }), { target: { value: ADDRESS } });
      await act(async () => {
        fireEvent.submit(screen.getByRole("textbox", { name: "E-Mail-Adresse" }).closest("form") as HTMLFormElement);
      });
      await act(codeSent);
      await act(async () => {
        mock.timers.tick(30_000);
      });

      answerWith(() => Promise.resolve({ success: false, error: MENSCH_BESTAETIGEN, submittedEmail: ADDRESS }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Code erneut senden" }));
      });
      await act(codeSent);
    } finally {
      mock.timers.reset();
    }

    assert.ok(screen.queryByLabelText("Code aus der E-Mail"), "the refused resend took the code step down");
    assert.ok(screen.getByText(ADDRESS), "the step no longer names where the standing code went");
    assert.deepEqual(
      raised.map(({ title, description }) => ({ title, description })),
      [{ title: "Code nicht gesendet", description: MENSCH_BESTAETIGEN }],
    );
  });
});

/** The card's own sentence for a check that did not load. */
const NICHT_GELADEN_HIER =
  "Die Prüfung, ob Du ein Mensch bist, ließ sich nicht laden. Erlaube challenges.cloudflare.com in Deinem Browser oder Werbeblocker " +
  `und lade die Seite neu, melde Dich mit einem Passkey an oder schreib uns an ${KONTAKT_EMAIL}.`;

/* The step on its own, as a page confirming a signed-in person mounts it: the caller decides what a
   finished sign-in does, and an address that may not change is offered no way to change it. */
/** The resend's reason while its cooldown runs. */
const COOLDOWN_REASON = "Einen neuen Code kannst Du eine halbe Minute nach dem letzten anfordern.";

/** A caller other than the sign-in card, with words of its own. */
const ELSEWHERE = {
  address: ADDRESS,
  message: NEUTRAL,
  hint: "Ein Hinweis dieser Seite.",
  submitLabel: { rest: "Weiter", pending: "Läuft..." },
  isSending: false,
  onResend: () => undefined,
};

describe("the code step mounted outside the sign-in card", () => {
  it("hands a finished sign-in to its caller and leaves the document to it", async () => {
    const user = userEvent.setup();
    const signedIn = mock.fn();
    render(h(CodeStep, { ...ELSEWHERE, onSignedIn: signedIn }));
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true })));

    await user.type(screen.getByLabelText("Code aus der E-Mail"), "048213");
    await act(fetchMock.answered);

    await waitFor(() => assert.equal(signedIn.mock.callCount(), 1));
    assert.deepEqual(left, [], "the step navigated on its own rather than leaving that to its caller");
  });

  it("offers no other address where its caller passes no way back", () => {
    render(h(CodeStep, { ...ELSEWHERE, onSignedIn: () => undefined }));

    assert.ok(screen.queryByRole("button", { name: "Andere E-Mail-Adresse verwenden" }) === null);
    closedControl("Code erneut senden", COOLDOWN_REASON);
  });

  /* HeroUI's theme gives a field's border no width, so a slot carrying the colour alone was drawn without an edge. */
  it("draws every code slot with a border of its own, on the surface variant", () => {
    const { container } = render(h(CodeStep, { ...ELSEWHERE, onSignedIn: () => undefined }));

    const slots = [...container.querySelectorAll('[data-slot="input-otp-slot"]')];
    assert.equal(slots.length, 6);
    for (const slot of slots) {
      const classes = slot.className.split(/\s+/);
      for (const needed of ["border", "border-control", "bg-surface", "rounded-xl", "h-12"]) {
        assert.ok(classes.includes(needed), `a code slot lacks \`${needed}\``);
      }
    }
    assert.ok(container.querySelector(".input-otp")?.classList.contains("input-otp--secondary"), "the code is off the surface variant");
  });

  /* Painted off the clock the cooldown runs on, so a background tab's slowed ticks cannot leave it behind. */
  it("counts the closed resend's half minute down beside it, and drops the count once it opens", async () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    try {
      render(h(CodeStep, { ...ELSEWHERE, onSignedIn: () => undefined }));
      // By its text: the cooldown makes the control inert, so the accessibility tree holds only its overlay.
      const resend = () => screen.getByText(/^Code erneut senden/, { selector: "button" });
      assert.equal(resend().textContent, "Code erneut senden (0:30)");

      await act(async () => {
        mock.timers.tick(1_000);
      });
      assert.equal(resend().textContent, "Code erneut senden (0:29)");

      await act(async () => {
        mock.timers.tick(28_999);
      });
      assert.equal(resend().textContent, "Code erneut senden (0:01)");

      await act(async () => {
        mock.timers.tick(1);
      });
      assert.equal(screen.getByRole("button", { name: "Code erneut senden" }).textContent, "Code erneut senden");
    } finally {
      mock.timers.reset();
    }
  });

  /* A background tab fires the ticks late or not at all while the clock runs on: the count reads the clock, so the
     first tick after a gap shows the time left rather than one second less than the last. */
  it("reads the count off the clock when the ticks between were never fired", async () => {
    // The timers' clock and the wall clock apart: the mocked timers' own `setTime` fires every tick it skips over.
    let wall = 0;
    const now = mock.method(Date, "now", () => wall);
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      render(h(CodeStep, { ...ELSEWHERE, onSignedIn: () => undefined }));
      const resend = () => screen.getByText(/^Code erneut senden/, { selector: "button" });

      // Twenty seconds pass on the wall clock while one tick lands.
      wall = 20_000;
      await act(async () => {
        mock.timers.tick(1_000);
      });

      assert.equal(resend().textContent, "Code erneut senden (0:10)");
    } finally {
      mock.timers.reset();
      now.mock.restore();
    }
  });

  /* A send slower than the cooldown would otherwise let a second press through, and a second code voids the first. */
  it("keeps the resend closed past the half minute while a send still runs", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { rerender } = render(h(CodeStep, { ...ELSEWHERE, isSending: true, onSignedIn: () => undefined }));
      await act(async () => {
        mock.timers.tick(30_000);
      });
      const resend = () => screen.getByText(/^Code erneut senden/, { selector: "button" });
      assert.equal(resend().hasAttribute("disabled"), true, "the resend opened under a send still running");

      rerender(h(CodeStep, { ...ELSEWHERE, isSending: false, onSignedIn: () => undefined }));
      assert.equal(resend().hasAttribute("disabled"), false, "the resend stayed closed once the send had answered");
    } finally {
      mock.timers.reset();
    }
  });

  /* HeroUI's `.button` holds its label on one line, so two of them side by side ran past a narrow card's edges. */
  it("sets the resend under the hint and the way back under the button, each a line that wraps inside the card", () => {
    render(h(CodeStep, { ...ELSEWHERE, onBack: () => undefined, onSignedIn: () => undefined }));
    const hint = screen.getByText(ELSEWHERE.hint);
    const resend = screen.getByText(/^Code erneut senden/, { selector: "button" });
    const submit = screen.getByRole("button", { name: ELSEWHERE.submitLabel.rest });
    const back = screen.getByRole("button", { name: "Andere E-Mail-Adresse verwenden" });

    const follows = (earlier: Element, later: Element) => (earlier.compareDocumentPosition(later) & earlier.DOCUMENT_POSITION_FOLLOWING) !== 0;
    assert.ok(follows(hint, resend), "the resend stands above its hint");
    assert.ok(follows(resend, submit), "the resend stands below the primary button");
    assert.ok(follows(submit, back), "the way back stands above the primary button");

    for (const quiet of [resend, back]) {
      const classes = quiet.className.split(/\s+/);
      assert.ok(!classes.includes("button"), `„${quiet.textContent}“ wears HeroUI's one-line button`);
      assert.ok(!classes.includes("whitespace-nowrap"), `„${quiet.textContent}“ cannot wrap`);
      assert.ok(classes.includes("w-fit"), `„${quiet.textContent}“ is not held to its own text's width`);
    }
  });

  /* A signed-in reader confirming a change is owed neither the sign-in's help nor its verb. */
  it("carries its caller's own hint and button words", () => {
    render(h(CodeStep, { ...ELSEWHERE, onSignedIn: () => undefined }));

    const field = screen.getByLabelText<HTMLInputElement>("Code aus der E-Mail");
    assert.equal(document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent, ELSEWHERE.hint);
    assert.ok(screen.getByRole("button", { name: ELSEWHERE.submitLabel.rest }));
    assert.ok(screen.queryByRole("button", { name: "Anmelden" }) === null, "the sign-in's verb stands on another page's step");
  });
});
