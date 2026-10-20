import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { beschreibeNachweis } from "./nachweis.ts";

describe("the act a consent choice is read back with", () => {
  /* The account page moves one choice and leaves the confirmation's day and label standing, so the
     choice's own act is what an administrator must read beside it. */
  it("names the choice's own act, in Berlin time, over the confirmation's", () => {
    const satz = beschreibeNachweis(
      { am: "2026-10-03T22:30:00Z", text_version: "2026-10-konto-spieler", erteilt_zuvor: null },
      { am: "2026-03-14", textVersion: "1" },
    );

    assert.equal(satz, "seit 04.10.2026, 00:30 Uhr, Fassung 2026-10-konto-spieler");
  });

  it("names the grant a withdrawal ended beside the withdrawal", () => {
    const satz = beschreibeNachweis(
      {
        am: "2026-10-04T08:00:00Z",
        text_version: "2026-10-konto-spieler",
        erteilt_zuvor: { am: "2026-09-01T10:00:00Z", text_version: "2026-09-spielerseite" },
      },
      { am: "2026-03-14", textVersion: "1" },
    );

    assert.equal(
      satz,
      "seit 04.10.2026, 10:00 Uhr, Fassung 2026-10-konto-spieler (zuvor erteilt am 01.09.2026, 12:00 Uhr, Fassung 2026-09-spielerseite)",
    );
  });

  it("claims no act for a choice on a record nobody has confirmed", () => {
    assert.equal(beschreibeNachweis(null, null), "Nicht bestätigt");
  });

  /* A contact seat confirmed before choices carried their own evidence is kept with its confirmation's day and label as
     its whole proof: „Nicht bestätigt“ under it would contradict the confirmation read out above. */
  it("reads a confirmed record's choice with no evidence of its own as standing on the confirmation", () => {
    assert.equal(beschreibeNachweis(null, { am: "2026-03-14", textVersion: "1" }), "seit der Bestätigung am 14.03.2026, Fassung 1");
  });

  /* The read model refuses no stored value, so an instant it cannot read arrives here rather than failing. */
  it("keeps an unreadable instant as stored rather than failing the panel", () => {
    assert.equal(
      beschreibeNachweis({ am: "kaputt", text_version: "x", erteilt_zuvor: null }, { am: "2026-03-14", textVersion: "1" }),
      "seit kaputt, Fassung x",
    );
  });
});
