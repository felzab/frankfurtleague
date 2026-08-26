import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRefusal, UNKNOWN_REFUSAL } from "./refusal.ts";

describe("buildRefusal", () => {
  it("writes the reason first and the way out second, each its own sentence", () => {
    const built = buildRefusal({ reason: "Der Spielort wurde nicht angelegt", repair: "Versuche es erneut" });

    assert.equal(built, "Der Spielort wurde nicht angelegt. Versuche es erneut.");
  });

  it("frames the surface holding the repair, so no call site pairs an article with a heading", () => {
    const built = buildRefusal({ reason: "Aus diesen Regeln entsteht keine KO-Runde", repair: "Ändere die Zahlen", where: "Regeln" });

    assert.equal(built, "Aus diesen Regeln entsteht keine KO-Runde. Ändere die Zahlen unter „Regeln“.");
  });

  /* The shape an appended surface cannot reach. German closes this clause with `zu`, so a surface added after the
     whole repair reads `… zu unter „Kader“`, and the two squad refusals that need it stayed hand-written for it. */
  it("seats the surface before a separable verb that closes the clause", () => {
    const built = buildRefusal({
      reason: "Das Team dieses Kadereintrags ist in dieser Saison nicht dabei",
      repair: { before: "Weise den Eintrag", after: "einem Team dieser Saison zu" },
      where: "Kader",
    });

    assert.equal(
      built,
      "Das Team dieses Kadereintrags ist in dieser Saison nicht dabei. Weise den Eintrag unter „Kader“ einem Team dieser Saison zu.",
    );
  });

  it("closes a bracketed repair that names no surface, leaving no gap where one would have stood", () => {
    const built = buildRefusal({
      reason: "Der Kadereintrag wurde nicht reaktiviert",
      repair: { before: "Weise ihn", after: "einem Team dieser Saison zu" },
    });

    assert.equal(built, "Der Kadereintrag wurde nicht reaktiviert. Weise ihn einem Team dieser Saison zu.");
    assert.doesNotMatch(built, / {2}| \./, "the empty middle field left a double space or a space before the period");
  });

  it("puts no dash anywhere, whatever its parts hold", () => {
    // `docs/frontend/spec.md` §1.12: no dash is punctuation, and the gate reads only the literals a
    // call site wrote — never the string this assembles from them.
    const built = buildRefusal({ reason: "Nichts wurde gespeichert", repair: "Melde Dich neu an", where: "Konto" });

    assert.doesNotMatch(built, /[—–]|\s-\s/);
  });
});

describe("UNKNOWN_REFUSAL", () => {
  it("names a way out and no cause, its callers having none to name", () => {
    assert.match(UNKNOWN_REFUSAL, /^[^.]+\.$/, "the cause-less refusal is one sentence");
    assert.match(UNKNOWN_REFUSAL, /neu|erneut/);
  });
});
