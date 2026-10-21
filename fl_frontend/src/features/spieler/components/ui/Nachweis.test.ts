import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

/* Reached after the harness above has evaluated, which is when the JSX compile step is registered. */
const { Beleg, Fassung } = await import("./Nachweis.tsx");

const fassung = (textVersion: string, istBekannt: boolean | null): string => textOf(renderMarkup(Fassung, { textVersion, istBekannt }));

/* One component for the pupil's, the referee's and a contact seat's readout: a drift here moves all three. */
describe("the stored label a consent readout shows", () => {
  it("shows a known label as its key alone", () => {
    assert.equal(fassung("2026-10-spielerseite-5", true).trim(), "2026-10-spielerseite-5");
  });

  /* The key stays beside the mark: whoever repairs the mismatch needs the key that resolved to nothing. */
  it("marks a label the registry does not hold, beside the key", () => {
    assert.equal(fassung("liga-2019-01-erfunden", false).replace(/\s+/g, " ").trim(), "liga-2019-01-erfunden Unbekannte Fassung");
  });

  it("marks a label the registry could not be asked about as unchecked, never as unknown", () => {
    assert.equal(fassung("2026-10-spielerseite-5", null).replace(/\s+/g, " ").trim(), "2026-10-spielerseite-5 Nicht geprüft");
  });
});

describe("the act a consent readout shows under a choice", () => {
  it("names the choice's own act, else the confirmation's, and claims none where its person has not confirmed", () => {
    const eigener = renderMarkup(Beleg, {
      nachweis: { am: "2026-10-04T08:00:00Z", text_version: "2026-10-konto-spieler", erteilt_zuvor: null },
      bestaetigung: { am: "2026-03-14", textVersion: "1" },
    });

    assert.equal(textOf(eigener), "seit 04.10.2026, 10:00 Uhr, Fassung 2026-10-konto-spieler");
    assert.equal(
      textOf(renderMarkup(Beleg, { nachweis: null, bestaetigung: { am: "2026-03-14", textVersion: "1" } })),
      "seit der Bestätigung am 14.03.2026, Fassung 1",
    );
    assert.equal(textOf(renderMarkup(Beleg, { nachweis: null, bestaetigung: null })), "Nicht bestätigt");
  });
});
