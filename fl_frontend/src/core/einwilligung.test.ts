import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { einwilligungFassung, LIGA_EINWILLIGUNG, LIGA_EINWILLIGUNGEN } from "./einwilligung.ts";

const DOCUMENT_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "openapi.json");
const REGENERATE = "cd fl_backend && python -m tests.openapi_document --write";

/** The bound the API publishes, so the label is judged against the tier that stores it rather than a copy of the number. */
function publishedVersionMaxLength(): number {
  const document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as {
    components?: { schemas?: Record<string, { properties?: Record<string, { maxLength?: number }> }> };
  };
  const bound = document.components?.schemas?.FLBewerbungEinwilligungPayload?.properties?.text_version?.maxLength;

  assert.ok(typeof bound === "number", `no maxLength on the submitted consent's text_version — regenerate with: ${REGENERATE}`);
  return bound;
}

describe("LIGA_EINWILLIGUNGEN", () => {
  it("answers each label it holds with that label's own paragraphs and switch", () => {
    for (const [textVersion, fassung] of Object.entries(LIGA_EINWILLIGUNGEN)) {
      assert.deepEqual(einwilligungFassung(textVersion), fassung, `${textVersion} resolves to another version's wording`);
    }
  });

  it("holds the version the form stamps, and reads the current wording off that entry", () => {
    const { textVersion, ...aktuell } = LIGA_EINWILLIGUNG;

    assert.deepEqual(einwilligungFassung(textVersion), aktuell, "the stamped version and the rendered wording have come apart");
  });

  it("answers nothing for a label no record was ever made under", () => {
    // `toString` and `constructor` are the labels an index into a plain object answers from the
    // prototype, so a resolver reading the index alone hands back something that is not a wording.
    for (const unbekannt of ["2026-07", "", "toString", "constructor", "2026-09"]) {
      assert.equal(einwilligungFassung(unbekannt), null, `"${unbekannt}" resolves to a wording nobody was shown`);
    }
  });

  it("keeps the retired wording retired: the old label answers the old words and no newer ones", () => {
    const alt = einwilligungFassung("2026-08");
    const neu = einwilligungFassung(LIGA_EINWILLIGUNG.textVersion);

    assert.ok(alt !== null && neu !== null, "a label the record holds resolved to nothing");
    // The failure this registry exists to prevent: the 2026-08 switch consented to a stored birthdate, and the
    // confirmation wording asks each person for their own, so one label may not answer the other's words.
    assert.ok(alt.absaetze.join(" ").includes("Geburtsdatum speichert"), "the retired wording lost the words that identify it");
    assert.ok(!neu.absaetze.join(" ").includes("Geburtsdatum speichert"), "the current wording answers under the old label");
    assert.notEqual(alt.schalter, neu.schalter, "both versions label the switch the same way");
  });

  it("carries no empty paragraph and no paragraph padded with whitespace", () => {
    for (const [textVersion, fassung] of Object.entries(LIGA_EINWILLIGUNGEN)) {
      assert.ok(fassung.absaetze.length > 0, `${textVersion} holds no paragraph at all`);

      for (const text of [...fassung.absaetze, fassung.schalter]) {
        assert.equal(text.trim(), text, `${textVersion} holds a paragraph or a switch label padded with whitespace`);
        assert.ok(text.length > 0, `${textVersion} holds an empty paragraph or switch label`);
      }
    }
  });

  it("labels every version within the length the API accepts for a stored one", () => {
    const bound = publishedVersionMaxLength();

    for (const textVersion of Object.keys(LIGA_EINWILLIGUNGEN)) {
      assert.ok(
        textVersion.length <= bound,
        `"${textVersion}" is ${String(textVersion.length)} characters, past the ${String(bound)} a record may cite`,
      );
    }
  });
});
