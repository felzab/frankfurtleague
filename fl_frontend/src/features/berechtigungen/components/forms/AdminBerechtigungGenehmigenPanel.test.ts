import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { TestContext } from "node:test";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered, calls } = doubleActions({
  modules: ["/src/features/adresswechsel/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminBerechtigungGenehmigenPanel, AENDERUNG_GENEHMIGEN } = await import("./AdminBerechtigungGenehmigenPanel.tsx");
const { StepUpContext } = await import("@/shared/components/ui/stepUp.ts");
const { DOUBLE_PRESS_MS } = await import("@/shared/hooks/useTwoPressConfirm.ts");

const ADRESSWECHSEL_ID = "68c1f0a2b3c4d5e6f7a8b9e0";

/** A session inside the window: the prompt is the confirm panel sweep's to drive (`shared/components/ui/confirmPanels.test.ts`). */
const FRESH = { isStale: () => false, confirm: () => Promise.resolve(true) };

/** The person's own start, every field served. */
const EIGENE = {
  id: ADRESSWECHSEL_ID,
  email: "vorstand@neu.de",
  email_gesperrt: false,
  weg: "konto" as const,
  gestartet_von: null,
  gestartet_von_gesperrt: false,
  grund: null,
  bestaetigt: false,
  bis: "2026-10-27T11:30:00Z",
  verwehrt: null,
  einsehbar_verwehrt: null,
};

function shown(adresswechsel: typeof EIGENE | Record<string, unknown>): string {
  render(
    h(
      StepUpContext.Provider,
      { value: FRESH },
      underNext(h(AdminBerechtigungGenehmigenPanel, { adresse: "vorstand@schule.de", adresswechsel: { ...EIGENE, ...adresswechsel } })),
    ),
  );

  return document.body.textContent ?? "";
}

/** Armed and pressed, as an administrator approves: the first press only asks, and a press too soon after it is a double click. */
async function genehmige(t: TestContext): Promise<void> {
  const user = userEvent.setup();
  render(
    h(
      StepUpContext.Provider,
      { value: FRESH },
      underNext(
        h(AdminBerechtigungGenehmigenPanel, {
          adresse: "vorstand@schule.de",
          adresswechsel: EIGENE,
        }),
      ),
    ),
  );
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await user.click(screen.getByRole("button", { name: `${AENDERUNG_GENEHMIGEN}: vorstand@schule.de` }));
  assert.match(document.body.textContent ?? "", /Genehmige nur, wenn Du sicher bist, dass die Person die Änderung selbst angefragt hat\./);
  t.mock.timers.tick(DOUBLE_PRESS_MS);
  await user.click(screen.getByRole("button", { name: "Ja, Adressänderung genehmigen" }));
  await act(answered);
}

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
});

describe("the approval on a grant's row", () => {
  /* The approver is the second pair of eyes a pretext has to get past, so the armed press asks for the check it stands for. */
  it("asks the approver to be sure the person asked, and approves the change by its id on the second press", async (t) => {
    answerWith(() => Promise.resolve({ success: true, message: "Der Zugang wechselt zur neuen Adresse, sobald sie bestätigt ist." }));

    await genehmige(t);

    assert.deepEqual(
      calls.map((call) => [call.action, call.payload]),
      [["genehmigeAdresswechselAction", { id: ADRESSWECHSEL_ID }]],
    );
    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.variant, shown.title, shown.description]),
        [["success", "Adressänderung genehmigt", "Der Zugang wechselt zur neuen Adresse, sobald sie bestätigt ist."]],
      ),
    );
  });

  it("raises a refusal in the backend's words under the approval's own title", async (t) => {
    answerWith(() => Promise.resolve({ success: false, error: "Diese Änderung ist abgelaufen. Lade die Seite neu." }));

    await genehmige(t);

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.title, shown.description]),
        [["Nicht genehmigt", "Diese Änderung ist abgelaufen. Lade die Seite neu."]],
      ),
    );
  });
});

/* Whether the person asked, or an administrator started it for a lost mailbox and why, is the fact a pretext hides. */
describe("what the approver reads of the change", () => {
  it("says the person asked it themselves on their own start", () => {
    assert.match(shown({}), /Die Person hat die Änderung selbst in ihrem Konto angefragt\./);
  });

  it("names the administrator who started it, how, and the reason they recorded", () => {
    const text = shown({ weg: "wartezeit", gestartet_von: "inhaber@schule.de", grund: "Postfach gelöscht, telefonisch bestätigt" });

    assert.match(text, /Begonnen von inhaber@schule\.de, ohne die bisherige Adresse\. Grund: Postfach gelöscht, telefonisch bestätigt/);
  });

  it("names what the row withholds from a non-owner without guessing at it", () => {
    const text = shown({ weg: "freigabe", email: null, verwehrt: "inhaber" });

    assert.match(text, /Neue Adresse für diesen Zugang: nur für Inhaberinnen und Inhaber sichtbar\./);
    assert.match(text, /Aus der Verwaltung begonnen, mit Freigabe durch die bisherige Adresse\./);
  });

  it("reads a barred new address and a barred starter as barred", () => {
    const text = shown({ weg: "wartezeit", email: null, email_gesperrt: true, gestartet_von_gesperrt: true });

    assert.match(text, /Neue Adresse für diesen Zugang: Gesperrte Adresse\./);
    assert.match(text, /Begonnen von einer gesperrten Adresse, ohne die bisherige Adresse\./);
  });

  it("names a starter erased since in the dative, as the grant notice does", () => {
    const text = shown({ weg: "freigabe", gestartet_von: ERASED_ACTOR_MARKER });

    assert.match(text, /Begonnen von einer nicht genannten Adresse, mit Freigabe durch die bisherige Adresse\./);
  });
});
