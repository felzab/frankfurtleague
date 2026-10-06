import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/schemas.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ADRESSWECHSEL_ABGELAUFEN, ADRESSWECHSEL_ERNEUT, ADRESSWECHSEL_VERWERFEN, ADRESSWECHSEL_WARTET, FormAdresswechselSection } =
  await import("./FormAdresswechselSection.tsx");

const OFFEN: FLSchiedsrichterAdresswechsel = { email: "anna@neu.example", verschickt_am: "2026-10-01", frist: "2099-12-31", zustellung: null };

const words = (adresswechsel: FLSchiedsrichterAdresswechsel): string =>
  textOf(
    renderTree(
      underNext(h(FormAdresswechselSection, { schiedsrichterId: "6890a1b2c3d4e5f607800001", adresswechsel, isDirty: false }), {
        router: nextRouter(),
      }),
    ),
    " ",
  )
    .replace(/\s+/g, " ")
    .trim();

describe("what the editor shows of a confirmed referee's waiting address", () => {
  it("names the waiting address, the day its link went and its deadline, with both controls", () => {
    const shown = words(OFFEN);

    assert.ok(shown.includes(ADRESSWECHSEL_WARTET), "the waiting state is not said");
    assert.match(shown, /anna@neu\.example/);
    assert.match(shown, /01\.10\.2026/);
    assert.match(shown, /31\.12\.2099/);
    assert.ok(shown.includes(ADRESSWECHSEL_ERNEUT) && shown.includes(ADRESSWECHSEL_VERWERFEN), "a control is missing");
  });

  /* No clock removes a lapsed change, so a past date alone would read as a deadline still running. */
  it("says a lapsed link is lapsed, beside its date", () => {
    const shown = words({ ...OFFEN, frist: "2020-01-01" });

    assert.ok(shown.includes(ADRESSWECHSEL_ABGELAUFEN), "a lapsed link reads as waiting");
    assert.match(shown, /abgelaufen/);
  });

  it("wears the delivery register's own chip where the link's message was refused", () => {
    const shown = words({ ...OFFEN, zustellung: { nachricht_id: "m1", stand: "unzustellbar", grund: null, am: "2026-10-01T10:00:00Z" } });

    assert.ok(shown.includes(ZUSTELLUNG_CHIP.unzustellbar?.label ?? "-"), "the refused delivery is not named");
  });
});

/* A send saves nothing, so a send nobody can tell landed is titled by what is unknown of it rather than
   by a save's „gespeichert“, and the repair says sending again is safe. */
describe("an address link send nobody can tell landed", () => {
  it("is titled by the link it may have sent, and offers sending again", async () => {
    toasts.length = 0;
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    render(
      underNext(h(FormAdresswechselSection, { schiedsrichterId: "6890a1b2c3d4e5f607800001", adresswechsel: OFFEN, isDirty: false }), {
        router: nextRouter(),
      }),
    );

    await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_ERNEUT }));
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((raised) => [raised.title, raised.description, raised.options?.outcome]),
        [
          [
            "Unklar, ob der Link verschickt wurde",
            "Prüfe die Verbindung und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.",
            "unknown",
          ],
        ],
      ),
    );
  });
});
