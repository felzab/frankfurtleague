import { assert, describe, expect, it } from "vitest";

import {
  buildRefusal,
  LADE_NEU_UND_VERSUCHE_ES_ERNEUT,
  UNHANDLED_FIELD_REFUSAL,
  UNKNOWN_REFUSAL,
  VERSUCHE_ES_ERNEUT,
  VERSUCHE_ES_ERNEUT_SATZ,
} from "./refusal.ts";

describe("buildRefusal", () => {
  it("writes the reason first and the way out second, each its own sentence", () => {
    const built = buildRefusal({ reason: "Der Spielort wurde nicht angelegt", repair: "Versuche es erneut" });

    expect(built).toBe("Der Spielort wurde nicht angelegt. Versuche es erneut.");
  });

  it("frames the surface holding the repair, so no call site pairs an article with a heading", () => {
    const built = buildRefusal({ reason: "Aus diesen Regeln entsteht keine KO-Runde", repair: "Ändere die Zahlen", where: "Regeln" });

    expect(built).toBe("Aus diesen Regeln entsteht keine KO-Runde. Ändere die Zahlen unter „Regeln“.");
  });

  /* The shape an appended surface cannot reach. German closes this clause with `zu`, so a surface added after the
     whole repair reads `… zu unter „Kader“`, and the two squad refusals that need it stayed hand-written for it. */
  it("seats the surface before a separable verb that closes the clause", () => {
    const built = buildRefusal({
      reason: "Das Team dieses Kadereintrags ist in dieser Saison nicht dabei",
      repair: { before: "Weise den Eintrag", after: "einem Team dieser Saison zu" },
      where: "Kader",
    });

    expect(built).toBe(
      "Das Team dieses Kadereintrags ist in dieser Saison nicht dabei. Weise den Eintrag unter „Kader“ einem Team dieser Saison zu.",
    );
  });

  it("closes a bracketed repair that names no surface, leaving no gap where one would have stood", () => {
    const built = buildRefusal({
      reason: "Der Kadereintrag wurde nicht reaktiviert",
      repair: { before: "Weise ihn", after: "einem Team dieser Saison zu" },
    });

    expect(built).toBe("Der Kadereintrag wurde nicht reaktiviert. Weise ihn einem Team dieser Saison zu.");
    expect(built, "the empty middle field left a double space or a space before the period").not.toMatch(/ {2}| \./);
  });

  it("puts no dash anywhere, whatever its parts hold", () => {
    // No dash is punctuation, and the gate reads only the literals a
    // call site wrote — never the string this assembles from them.
    const built = buildRefusal({ reason: "Nichts wurde gespeichert", repair: "Melde Dich neu an", where: "Konto" });

    expect(built).not.toMatch(/[—–]|\s-\s/);
  });
});

describe("UNKNOWN_REFUSAL", () => {
  it("names a way out and no cause, its callers having none to name", () => {
    expect(UNKNOWN_REFUSAL, "the cause-less refusal is one sentence").toMatch(/^[^.]+\.$/);
    expect(UNKNOWN_REFUSAL).toMatch(/neu|erneut/);
  });
});

/* The approved words, spelled out. A repair takes `VERSUCHE_ES_ERNEUT` and a closing retry sentence
   appends `VERSUCHE_ES_ERNEUT_SATZ`; only a retry inside a longer sentence is written out at its site. */
describe("VERSUCHE_ES_ERNEUT", () => {
  it("is the approved retry, as a repair and as a sentence", () => {
    expect(VERSUCHE_ES_ERNEUT).toBe("Versuche es erneut");
    expect(VERSUCHE_ES_ERNEUT_SATZ).toBe("Versuche es erneut.");
  });

  // A repair re-typing the words instead drifts from the sentence the day either is reworded.
  it("ends the refusal no input shows as the same words", () => {
    assert.ok(UNHANDLED_FIELD_REFUSAL.endsWith(` ${VERSUCHE_ES_ERNEUT_SATZ}`));
  });

  it("is the reload refusal's sentence, and its repair, in the same words", () => {
    expect(UNKNOWN_REFUSAL).toBe(`${LADE_NEU_UND_VERSUCHE_ES_ERNEUT}.`);
    assert.ok(LADE_NEU_UND_VERSUCHE_ES_ERNEUT.endsWith(VERSUCHE_ES_ERNEUT.replace(/^V/, "v")));
  });
});
