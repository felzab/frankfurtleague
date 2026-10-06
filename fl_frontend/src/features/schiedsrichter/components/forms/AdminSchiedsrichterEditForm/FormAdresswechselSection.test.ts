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

import type { FLSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/schemas.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ADRESSWECHSEL_ERNEUT, ADRESSWECHSEL_VERWERFEN, ADRESSWECHSEL_WARTET, FormAdresswechselSection } =
  await import("./FormAdresswechselSection.tsx");

const OFFEN: FLSchiedsrichterAdresswechsel = { email: "anna@neu.example", verschickt_am: "2026-10-01", frist: "2099-12-31", zustellung: null };

const words = (adresswechsel: FLSchiedsrichterAdresswechsel, istAbgelaufen = false): string =>
  textOf(
    renderTree(
      underNext(h(FormAdresswechselSection, { schiedsrichterId: "6890a1b2c3d4e5f607800001", adresswechsel, istAbgelaufen, isDirty: false }), {
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
    assert.ok(shown.includes(ADRESSWECHSEL_VERWERFEN), "the discard is missing");
  });

  /* The consent panel on the same page holds a „Link erneut senden“ for its own link, so this one is named for its link. */
  it("names its re-send for the link it sends, the visible words staying the consent panel's", () => {
    render(
      underNext(
        h(FormAdresswechselSection, {
          schiedsrichterId: "6890a1b2c3d4e5f607800001",
          adresswechsel: OFFEN,
          istAbgelaufen: false,
          isDirty: false,
        }),
        {
          router: nextRouter(),
        },
      ),
    );

    const erneut = screen.getByRole("button", { name: ADRESSWECHSEL_ERNEUT });
    assert.equal(ADRESSWECHSEL_ERNEUT, "Link erneut senden: Neue E-Mail-Adresse");
    assert.equal(erneut.textContent.trim(), "Link erneut senden");
  });

  /* No clock removes a lapsed change, so a past date alone would read as a deadline still running. */
  it("says a lapsed link is lapsed, beside its date", () => {
    const shown = words({ ...OFFEN, frist: "2020-01-01" }, true);

    // Once, beside the date, as the consent link's panel marks its own.
    assert.equal(shown.split("abgelaufen").length - 1, 1, "the lapse is said other than once");
    assert.match(shown, /01\.01\.2020 abgelaufen/);
  });

  /* The read judges the deadline by the backend's own rule, so this browser's day decides nothing. */
  it("marks the lapse by the read's judgement alone, never by the date it shows", () => {
    assert.doesNotMatch(words({ ...OFFEN, frist: "2020-01-01" }, false), /abgelaufen/);
    assert.match(words({ ...OFFEN, frist: "2099-12-31" }, true), /abgelaufen/);
  });

  it("wears the delivery register's own chip where the link's message was refused", () => {
    const shown = words({ ...OFFEN, zustellung: { nachricht_id: "m1", stand: "unzustellbar", grund: null, am: "2026-10-01T10:00:00Z" } });

    assert.ok(shown.includes(ZUSTELLUNG_CHIP.unzustellbar?.label ?? "-"), "the refused delivery is not named");
  });
});

describe("a press of the address change's link nobody can tell landed", () => {
  /* No answer came back. A send saves nothing, so its title names the link, and sending again is safe;
     a second discard of a change already gone is refused, so the page, reloaded, decides. */
  const arms: Record<string, { control: string; title: string; repair: string }> = {
    send: {
      control: ADRESSWECHSEL_ERNEUT,
      title: "Unklar, ob der Link verschickt wurde",
      repair: "Prüfe die Verbindung und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.",
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
      const { unmount } = render(
        underNext(
          h(FormAdresswechselSection, {
            schiedsrichterId: "6890a1b2c3d4e5f607800001",
            adresswechsel: OFFEN,
            istAbgelaufen: false,
            isDirty: false,
          }),
          { router },
        ),
      );

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
