import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "next-themes";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { MENSCH_BESTAETIGEN } from "@/core/turnstileToken.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { TEST_SITE_KEY } from "@/shared/testing/siteverifyDouble.ts";
import { doubleTurnstile } from "@/shared/testing/turnstileDouble.ts";

const fetchMock = doubleFetch();
const turnstile = doubleTurnstile();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { NICHT_GELADEN, NOCH_NICHT_FERTIG, useTurnstile } = await import("./useTurnstile.tsx");

type Anfrage = { token: string } | { satz: string };

/** What each press of the harness form was answered with, in order. */
const answers: Anfrage[] = [];

beforeEach(() => {
  answers.length = 0;
});

/** One form's check, its widget before the submit as the forms place it. */
function Formular({ fehlgeschlagen }: { fehlgeschlagen?: string }) {
  const check = useTurnstile(TEST_SITE_KEY, fehlgeschlagen);
  const press = () => void check.takeToken().then((anfrage) => answers.push(anfrage));
  return h("div", null, check.widget, h("button", { type: "button", onClick: press }, "Abschicken"));
}

/** The site's own toggle, as `ThemeSwitch` presses it. */
function Umschalter() {
  const { setTheme } = useTheme();
  return h("button", { type: "button", onClick: () => setTheme("dark") }, "Dunkel");
}

/** A press of the form, and its answer once the token it waits on arrives. */
async function pressed(): Promise<Anfrage | undefined> {
  const before = answers.length;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
  });
  return answers[before];
}

describe("the widget a form renders", () => {
  /* Each render is a second widget, minting and loading Cloudflare's frame of its own. */
  it("renders one widget per mounted form, removes it as the form unmounts, and renders one again on the next mount", () => {
    const first = render(h(Formular));
    first.rerender(h(Formular));
    assert.equal(turnstile.widgets.length, 1, "a render of the mounted form rendered a second widget");

    first.unmount();
    assert.equal(turnstile.live().length, 0, "the unmounted form left its widget on the page");

    render(h(Formular));
    assert.equal(turnstile.widgets.length, 2, "the remounted form did not render exactly one widget");
    assert.equal(turnstile.live().length, 1);
  });

  it("renders the widget anew in the theme the site's toggle sets, and removes the old one", async () => {
    render(h(ThemeProvider, { attribute: "class", defaultTheme: "light", enableSystem: false }, h(Formular), h(Umschalter)));
    assert.equal(turnstile.live()[0]?.options.theme, "light");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dunkel" }));
    });

    assert.deepEqual(
      turnstile.live().map((widget) => widget.options.theme),
      ["dark"],
    );
  });

  /* The old widget's token went with it, so a press before the new one mints waits for that token. */
  it("waits on the new widget's token after a theme toggle, rather than answering at once", async () => {
    render(h(ThemeProvider, { attribute: "class", defaultTheme: "light", enableSystem: false }, h(Formular), h(Umschalter)));
    turnstile.mintsAtOnce(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dunkel" }));
    });

    assert.equal(await pressed(), undefined, "the press was answered before the new widget minted");
    const minted = await act(async () => turnstile.mint());
    assert.deepEqual(answers, [{ token: minted }]);
  });
});

describe("a press's token", () => {
  it("hands a press the token the widget minted, and has the next one minted at once", async () => {
    render(h(Formular));
    const minted = turnstile.lastMinted();

    assert.deepEqual(await pressed(), { token: minted });
    assert.equal(turnstile.live()[0]?.resets, 1, "the spent token's widget was not reset");
    const next = turnstile.lastMinted();
    assert.notEqual(next, minted, "the reset minted nothing");
    assert.deepEqual(await pressed(), { token: next }, "the second press was not handed the next token");
  });

  it("waits for a token still being minted", async () => {
    turnstile.mintsAtOnce(false);
    render(h(Formular));

    assert.equal(await pressed(), undefined, "the press was answered before a token was minted");
    const minted = await act(async () => turnstile.mint());

    assert.deepEqual(answers, [{ token: minted }]);
  });

  it("answers a press no token reached in ten seconds with a sentence", async () => {
    turnstile.mintsAtOnce(false);
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      render(h(Formular));
      await pressed();

      await act(async () => {
        mock.timers.tick(9_999);
      });
      assert.deepEqual(answers, [], "the press was answered before its ten seconds");

      await act(async () => {
        mock.timers.tick(1);
      });
      assert.deepEqual(answers, [{ satz: NOCH_NICHT_FERTIG }]);
    } finally {
      mock.timers.reset();
    }
  });

  /* Cloudflare's click stands in the form, and only the visitor can answer it. */
  it("asks a press made while Cloudflare shows its click to confirm first", async () => {
    turnstile.mintsAtOnce(false);
    render(h(Formular));
    act(() => void turnstile.fire("before-interactive-callback"));

    assert.deepEqual(await pressed(), { satz: MENSCH_BESTAETIGEN });
  });

  it("drops a token Cloudflare let expire", async () => {
    render(h(Formular));
    turnstile.mintsAtOnce(false);
    act(() => void turnstile.fire("expired-callback"));

    assert.equal(await pressed(), undefined, "the press was handed the expired token");
    const minted = await act(async () => turnstile.mint());
    assert.deepEqual(answers, [{ token: minted }]);
  });
});

describe("a check that did not load", () => {
  it("says so at the widget in the form's own sentence, answers every press with it, and reports it once", async () => {
    fetchMock.mock.mockImplementation(async () => new Response(null, { status: 204 }));
    turnstile.mintsAtOnce(false);
    render(h(Formular, { fehlgeschlagen: "Der Satz dieses Formulars." }));

    let handled: unknown;
    act(() => {
      handled = turnstile.fire("error-callback", "110200");
    });
    // Cloudflare retries by itself, and calls back for each attempt.
    act(() => void turnstile.fire("error-callback", "110200"));

    assert.equal(handled, true, "the failure was left for Cloudflare's script to throw");
    assert.equal(screen.queryAllByText("Der Satz dieses Formulars.").length, 1, "the form does not say the check failed");
    assert.deepEqual(await pressed(), { satz: "Der Satz dieses Formulars." });
    assert.deepEqual(
      fetchMock.mock.calls.map((call) => [
        String(call.arguments[0]),
        (JSON.parse(String(call.arguments[1]?.body)) as { message: string }).message,
      ]),
      [["/api/client-error", "turnstile.widget_failed 110200"]],
    );
  });

  it("speaks the shared sentence where the form names none, and stands down once Cloudflare's retry mints a token", async () => {
    fetchMock.mock.mockImplementation(async () => new Response(null, { status: 204 }));
    turnstile.mintsAtOnce(false);
    render(h(Formular));
    act(() => void turnstile.fire("error-callback", "300010"));
    assert.equal(screen.queryAllByText(NICHT_GELADEN).length, 1, "the form does not say the check failed");
    // A blocked check stays refused, so the league's address is a browser's way in that will not load it.
    assert.ok(
      screen.queryAllByText((text) => text.includes(`schreib uns an ${KONTAKT_EMAIL}`)).length > 0,
      "the sentence names no way in past a blocked check",
    );

    const minted = await act(async () => turnstile.mint());

    assert.equal(screen.queryAllByText(NICHT_GELADEN).length, 0, "the sentence outlived the token Cloudflare's retry minted");
    assert.deepEqual(await pressed(), { token: minted });
  });
});
