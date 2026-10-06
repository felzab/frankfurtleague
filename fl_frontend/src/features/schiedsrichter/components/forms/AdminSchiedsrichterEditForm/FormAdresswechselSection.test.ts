import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung.ts";
import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/schemas.ts";

/* Every write hangs: a real action needs a session and a backend, and these cases press nothing. */
doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

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
    assert.ok(shown.includes(ADRESSWECHSEL_VERWERFEN), "the discard is missing");
  });

  /* The consent panel on the same page holds a „Link erneut senden“ for its own link, so this one is named for its link. */
  it("names its re-send for the link it sends, the visible words staying the consent panel's", () => {
    render(
      underNext(h(FormAdresswechselSection, { schiedsrichterId: "6890a1b2c3d4e5f607800001", adresswechsel: OFFEN, isDirty: false }), {
        router: nextRouter(),
      }),
    );

    const erneut = screen.getByRole("button", { name: ADRESSWECHSEL_ERNEUT });
    assert.equal(ADRESSWECHSEL_ERNEUT, "Link erneut senden: Neue E-Mail-Adresse");
    assert.equal(erneut.textContent.trim(), "Link erneut senden");
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
