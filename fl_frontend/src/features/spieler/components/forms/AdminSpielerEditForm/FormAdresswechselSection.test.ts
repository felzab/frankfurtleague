import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSpielerAdresswechsel } from "@/features/spieler/schemas.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered, calls } = doubleActions({
  modules: ["/src/features/spieler/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ADRESSWECHSEL_ERNEUT, ADRESSWECHSEL_VERWERFEN, ADRESSWECHSEL_WARTET, FormAdresswechselSection } =
  await import("./FormAdresswechselSection.tsx");

const SPIELER_ID = "6890a1b2c3d4e5f607800002";

const OFFEN: FLSpielerAdresswechsel = { email: "lena@neu.example", verschickt_am: "2026-10-01", frist: "2099-12-31", zustellung: null };

const panel = (adresswechsel: FLSpielerAdresswechsel, istAbgelaufen = false, router = nextRouter()) =>
  underNext(h(FormAdresswechselSection, { spielerId: SPIELER_ID, adresswechsel, istAbgelaufen, isDirty: false }), { router });

const words = (adresswechsel: FLSpielerAdresswechsel, istAbgelaufen = false): string =>
  textOf(renderTree(panel(adresswechsel, istAbgelaufen)), " ")
    .replace(/\s+/g, " ")
    .trim();

describe("what the editor shows of a pupil's waiting address", () => {
  it("names the waiting address, the day its link went and its deadline, with both controls", () => {
    const shown = words(OFFEN);

    assert.ok(shown.includes(ADRESSWECHSEL_WARTET), "the waiting state is not said");
    assert.match(shown, /lena@neu\.example/);
    assert.match(shown, /01\.10\.2026/);
    assert.match(shown, /31\.12\.2099/);
    assert.ok(shown.includes(ADRESSWECHSEL_ERNEUT) && shown.includes(ADRESSWECHSEL_VERWERFEN), "a control is missing");
  });

  /* The lapse sweep removes the address the day after, so until then a past date alone would read as a deadline still running. */
  it("says a lapsed link is lapsed, once and beside its date, by the read's judgement alone", () => {
    const lapsed = words({ ...OFFEN, frist: "2020-01-01" }, true);

    assert.equal(lapsed.split("abgelaufen").length - 1, 1, "the lapse is said other than once");
    assert.match(lapsed, /01\.01\.2020 abgelaufen/);
    assert.doesNotMatch(words({ ...OFFEN, frist: "2020-01-01" }, false), /abgelaufen/);
  });

  it("wears the delivery register's own chip where the link's message was refused", () => {
    const shown = words({ ...OFFEN, zustellung: { nachricht_id: "m1", stand: "unzustellbar", grund: null, am: "2026-10-01T10:00:00Z" } });

    assert.ok(shown.includes(ZUSTELLUNG_CHIP.unzustellbar?.label ?? "-"), "the refused delivery is not named");
  });
});

describe("the waiting address's two controls", () => {
  for (const [control, action] of [
    [ADRESSWECHSEL_ERNEUT, "einladeSpielerAdresswechselAction"],
    [ADRESSWECHSEL_VERWERFEN, "verwirfSpielerAdresswechselAction"],
  ] as const) {
    it(`sends ${action} for this pupil alone`, async () => {
      answerWith(() => Promise.resolve({ success: true, message: "Gesendet.", versand: "gesendet" }));
      const { unmount } = render(panel(OFFEN));
      const before = calls.length;

      await userEvent.setup().click(screen.getByRole("button", { name: control }));
      await act(answered);

      assert.deepEqual(
        calls.slice(before).map((call) => [call.action, call.payload]),
        [[action, { id: SPIELER_ID }]],
      );
      unmount();
    });
  }

  /* Graded as the request's press grades it, the earlier link being dead either way: a failed or held-back link
     is a warning titled for what happened, and so is a failed notice, one held back asking nothing
     (`docs/frontend/spec.md :: I679`). */
  for (const [versand, hinweis, variant, title] of [
    ["fehlgeschlagen", "gesendet", "warning", "Link nicht verschickt"],
    ["gesperrt", "gesendet", "warning", "Link zurückgehalten"],
    ["zurueckgehalten", "gesendet", "warning", "Link zurückgehalten"],
    ["gesendet", "fehlgeschlagen", "warning", "Link gesendet, Hinweis nicht verschickt"],
    ["gesendet", "ungewiss", "warning", "Link gesendet, Hinweis unklar"],
    ["gesendet", "zurueckgehalten", "success", "Link gesendet"],
  ] as const) {
    it(`grades a re-send whose link is ${versand} and notice ${hinweis} a ${variant} titled „${title}“`, async () => {
      answerWith(() => Promise.resolve({ success: true, message: "Nicht raus.", versand: versand, hinweis: hinweis }));
      const before = toasts.length;
      const { unmount } = render(panel(OFFEN));

      await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_ERNEUT }));
      await act(answered);

      await waitFor(() =>
        assert.deepEqual(
          toasts.slice(before).map((shown) => [shown.variant, shown.title]),
          [[variant, title]],
        ),
      );
      unmount();
    });
  }
});

describe("a press of the address change's link nobody can tell landed", () => {
  /* A send saves nothing, so its title names the link, and sending again is safe; a second discard of a
     change already gone is refused, so the page, reloaded, decides. */
  const arms: Record<string, { control: string; title: string; repair: string }> = {
    send: {
      control: ADRESSWECHSEL_ERNEUT,
      title: "Unklar, ob der Link verschickt wurde",
      repair: "Prüfe die Verbindung, lade die Seite neu und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.",
    },
    discard: {
      control: ADRESSWECHSEL_VERWERFEN,
      title: "Unklar, ob es gespeichert wurde",
      repair: "Prüfe die Verbindung und lade die Seite neu. Wartet die neue Adresse dann noch, verwirf die Änderung erneut.",
    },
  };
  for (const [arm, { control, title, repair }] of Object.entries(arms)) {
    it(`titles the ${arm} by what is unknown of it, names its own next step, and reads the page again`, async () => {
      answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
      const { router, seen } = recordingRouter();
      const before = toasts.length;
      const { unmount } = render(panel(OFFEN, false, router));

      await userEvent.setup().click(screen.getByRole("button", { name: control }));
      await act(answered);

      await waitFor(() =>
        assert.deepEqual(
          toasts.slice(before).map((shown) => [shown.title, shown.description, shown.options?.outcome]),
          [[title, repair, "unknown"]],
        ),
      );
      assert.equal(seen.refresh, 1, `the ${arm} left the page unread after a press nobody can tell landed`);
      unmount();
    });
  }
});
