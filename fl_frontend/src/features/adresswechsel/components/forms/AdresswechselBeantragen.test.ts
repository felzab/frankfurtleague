import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h, useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

import type { AdresswechselEntwurf } from "./AdresswechselBeantragen.tsx";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered, calls } = doubleActions({
  modules: ["/src/features/adresswechsel/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdresswechselBeantragen, LEERER_ENTWURF, LINK_AN_NEUE_ADRESSE } = await import("./AdresswechselBeantragen.tsx");

const BISHER = "lena@schule.example";
const NEU = "lena@neu.example";

/** The tool's start box, its typing held above it as the tool holds it; `geschrieben` counts the tool's re-reads. */
function box({ entwurf = LEERER_ENTWURF, ersetztOffen = false, router = nextRouter() } = {}) {
  const geschrieben = { count: 0 };
  function Host() {
    const [held, setHeld] = useState<AdresswechselEntwurf>(entwurf);
    return h(AdresswechselBeantragen, {
      adresse: BISHER,
      entwurf: held,
      ersetztOffen,
      fokussieren: false,
      onEntwurfChange: setHeld,
      onGeschrieben: () => void (geschrieben.count += 1),
      onAbbrechen: () => undefined,
    });
  }
  return { ...render(underNext(h(Host), { router })), geschrieben };
}

/** The press's one write, as the action double recorded it. */
const gesendet = (before: number) => calls.slice(before).map((call) => [call.action, call.payload]);

beforeEach(() => {
  toasts.length = 0;
});

describe("what the start sends for the way picked", () => {
  /* The way is the reason's presence: a reason sent with „fragen“ would skip the address on file's approval. */
  it("sends no reason on the way asking the address on file, whatever the reason box held before", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "Gesendet.", versand: null, hinweis: "gesendet", adresseBelegt: false }));
    const user = userEvent.setup();
    const { unmount } = box({ entwurf: { email: NEU, weg: "unerreichbar", grund: "Postfach gelöscht" } });
    const before = calls.length;

    await user.click(screen.getByRole("radio", { name: "Die bisherige Adresse fragen" }));
    await user.click(screen.getByRole("button", { name: LINK_AN_NEUE_ADRESSE }));
    await act(answered);

    assert.deepEqual(gesendet(before), [["beantrageAdresswechselAction", { adresse: BISHER, email: NEU, grund: null }]]);
    unmount();
  });

  it("sends the reason typed on the way that records one", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "Gesendet.", versand: "gesendet", hinweis: "gesendet", adresseBelegt: false }));
    const user = userEvent.setup();
    const { unmount } = box({ entwurf: { ...LEERER_ENTWURF, email: NEU } });
    const before = calls.length;

    await user.click(screen.getByRole("radio", { name: "Die bisherige Adresse ist nicht mehr erreichbar" }));
    await user.type(screen.getByRole("textbox", { name: "Grund" }), "Postfach gelöscht");
    await user.click(screen.getByRole("button", { name: LINK_AN_NEUE_ADRESSE }));
    await act(answered);

    assert.deepEqual(gesendet(before), [["beantrageAdresswechselAction", { adresse: BISHER, email: NEU, grund: "Postfach gelöscht" }]]);
    unmount();
  });

  it("presses from the new address's box on Enter, as the button does", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "Gesendet.", versand: null, hinweis: "gesendet", adresseBelegt: false }));
    const { unmount } = box();
    const before = calls.length;

    await userEvent.setup().type(screen.getByRole("textbox", { name: "Neue E-Mail-Adresse" }), `${NEU}{Enter}`);
    await act(answered);

    assert.deepEqual(gesendet(before), [["beantrageAdresswechselAction", { adresse: BISHER, email: NEU, grund: null }]]);
    unmount();
  });

  /* Judged at the press by the write's own schema, never between keystrokes: the box says why and nothing is sent. */
  it("refuses an empty reason on its own box and sends nothing", async () => {
    const user = userEvent.setup();
    const { unmount } = box({ entwurf: { email: NEU, weg: "unerreichbar", grund: "" } });
    const before = calls.length;

    await user.click(screen.getByRole("button", { name: LINK_AN_NEUE_ADRESSE }));

    assert.deepEqual(gesendet(before), []);
    assert.equal(screen.getByRole("textbox", { name: "Grund" }).getAttribute("aria-invalid"), "true");
    unmount();
  });
});

describe("what the start box says before its press", () => {
  /* The reason is the one field whose requirement turns on another: its star follows the way. */
  it("marks the reason required on the way that records one, beside the new address", () => {
    const { unmount } = box({ entwurf: { email: NEU, weg: "unerreichbar", grund: "" } });
    const grund = screen.getByRole("textbox", { name: "Grund" });

    assert.ok(grund.closest('[data-required="true"]') !== null, "the reason its way requires wears no star");
    assert.ok(
      screen.getByRole("textbox", { name: "Neue E-Mail-Adresse" }).closest('[data-required="true"]') !== null,
      "the new address wears no star",
    );
    unmount();
  });

  /* An end without effect takes the reason out of the log, so the box never promises a year it does not keep. */
  it("says the reason stays in the log only where the change takes effect", () => {
    const { unmount } = box({ entwurf: { email: NEU, weg: "unerreichbar", grund: "" } });

    assert.match(
      document.body.textContent ?? "",
      /Gilt die Änderung, steht der Grund zwölf Monate im Änderungsprotokoll\. Endet sie vorher, wird er gelöscht\./,
    );
    unmount();
  });

  it("says the start ends the change already standing, and only where one stands", () => {
    const ENDET = /Eine neue Änderung beendet die oben gezeigte/;

    const mitOffen = box({ ersetztOffen: true });
    assert.match(document.body.textContent ?? "", ENDET);
    mitOffen.unmount();

    const ohne = box({ ersetztOffen: false });
    assert.doesNotMatch(document.body.textContent ?? "", ENDET);
    ohne.unmount();
  });
});

describe("what the start's toast says of its messages", () => {
  /* The change stands whichever way its messages went: a failed or held-back one is a warning titled for what
     happened, and a start asking the address on file first has that request as its one message
     (`docs/frontend/spec.md :: I679`). */
  for (const [versand, hinweis, variant, title] of [
    ["gesendet", "gesendet", "success", "Link gesendet"],
    ["fehlgeschlagen", "gesendet", "warning", "Link nicht verschickt"],
    ["gesperrt", "gesendet", "warning", "Link zurückgehalten"],
    ["zurueckgehalten", "gesendet", "warning", "Link zurückgehalten"],
    ["gesendet", "fehlgeschlagen", "warning", "Link gesendet, Hinweis nicht verschickt"],
    ["gesendet", "ungewiss", "warning", "Link gesendet, Hinweis unklar"],
    ["gesendet", "zurueckgehalten", "success", "Link gesendet"],
    [null, "gesendet", "success", "Anfrage gesendet"],
    [null, "fehlgeschlagen", "warning", "Anfrage nicht verschickt"],
    [null, "ungewiss", "warning", "Unklar, ob die Anfrage verschickt wurde"],
  ] as const) {
    it(`titles a start whose link is ${String(versand)} and notice ${hinweis} „${title}“, and has the tool read again`, async () => {
      answerWith(() => Promise.resolve({ success: true, message: "Der Link zur neuen Adresse.", versand, hinweis, adresseBelegt: false }));
      const { unmount, geschrieben } = box({ entwurf: { ...LEERER_ENTWURF, email: NEU } });

      await userEvent.setup().click(screen.getByRole("button", { name: LINK_AN_NEUE_ADRESSE }));
      await act(answered);

      await waitFor(() =>
        assert.deepEqual(
          toasts.map((raised) => [raised.variant, raised.title]),
          [[variant, title]],
        ),
      );
      assert.equal(geschrieben.count, 1, "the tool kept showing the address's state from before the start");
      unmount();
    });
  }

  /* A pretext's target holding records is the one sign an administrator gets of it, so a start that went out cleanly still warns. */
  it("warns where the new address already holds records, though every message went out", async () => {
    answerWith(() =>
      Promise.resolve({
        success: true,
        message: "Unter der neuen Adresse stehen schon Einträge.",
        versand: "gesendet",
        hinweis: "gesendet",
        adresseBelegt: true,
      }),
    );
    const { unmount } = box({ entwurf: { ...LEERER_ENTWURF, email: NEU } });

    await userEvent.setup().click(screen.getByRole("button", { name: LINK_AN_NEUE_ADRESSE }));
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((raised) => [raised.variant, raised.title, raised.description]),
        [["warning", "Link gesendet", "Unter der neuen Adresse stehen schon Einträge."]],
      ),
    );
    unmount();
  });
});

describe("a start the backend refuses or nobody can tell landed", () => {
  it("shows a refusal of the new address on its box, the tool left unread", async () => {
    answerWith(() => Promise.resolve({ success: false, error: "Ungültig.", fieldErrors: { email: "Diese Adresse ist gesperrt." } }));
    const { unmount, geschrieben } = box({ entwurf: { ...LEERER_ENTWURF, email: NEU } });

    await userEvent.setup().click(screen.getByRole("button", { name: LINK_AN_NEUE_ADRESSE }));
    await act(answered);

    await waitFor(() => assert.match(document.body.textContent ?? "", /Diese Adresse ist gesperrt\./));
    assert.deepEqual(toasts, [], "a refusal its box shows raised a toast too");
    assert.equal(geschrieben.count, 0);
    unmount();
  });

  /* A send saves nothing, so its title names the link and sending again is safe. */
  it("titles a press nobody can tell landed by the link, names sending again, and reads the page again", async () => {
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    const { router, seen } = recordingRouter();
    const { unmount } = box({ entwurf: { ...LEERER_ENTWURF, email: NEU }, router });

    await userEvent.setup().click(screen.getByRole("button", { name: LINK_AN_NEUE_ADRESSE }));
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.title, shown.description, shown.options?.outcome]),
        [
          [
            "Unklar, ob der Link verschickt wurde",
            "Prüfe die Verbindung, lade die Seite neu und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.",
            "unknown",
          ],
        ],
      ),
    );
    assert.equal(seen.refresh, 1);
    unmount();
  });
});
