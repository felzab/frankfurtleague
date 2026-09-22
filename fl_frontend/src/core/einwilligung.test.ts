import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  BESTAETIGUNG_ABSAETZE,
  BESTAETIGUNG_KENNTNISNAHME,
  einwilligungFassung,
  fuelleFassung,
  LIGA_KENNTNISNAHME,
  LIGA_KENNTNISNAHMEN,
  SCHIEDSRICHTER_EINWILLIGUNG,
  SPIELER_EINWILLIGUNG,
} from "./einwilligung.ts";

import type { EinwilligungFassung } from "./einwilligung.ts";

const DOCUMENT_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "openapi.json");
const REGENERATE = "cd fl_backend && uv run python -m tests.openapi_document --write";

// Frozen when a label is minted and never updated afterwards: a changed digest means the stored
// words moved, and moved words are a NEW label rather than a new number here.
const FASSUNG_DIGESTS: Readonly<Record<string, string>> = {
  "2026-08": "5ee0fd132685f067dfcb5efd9a85e1df36fabdfcb5dab451c98d760a262c4dc8",
  "2026-09-bestaetigung": "2b7227c1252f386e7c9f68967f049fa78a353540dfd309d3fc5bdce3e4c0d7fa",
  "2026-09-bestaetigung-2": "061b910a47324eb91c9c6b81191804b44b015ee5153b6c8843c884422d02f811",
  "2026-09-bestaetigung-3": "694d9949915bbb999214f6e0f276a20020e464bdd28955152d58c19edc803a22",
  "2026-09-bestaetigung-4": "6cd1ecde85282bb369a0e3437915752bf0ac4fe1dc35b0fe8b4ba2b15f84ecf3",
  "2026-09-bestaetigungsseite": "0f43376babe1890edc2e38e482300d940b50de65c75b2f8bdeb4393be1a459f6",
  "2026-09-bestaetigungsseite-2": "a3f63055cde360a1a547f6e04e547101d90af2de71b89058e4a684d5e1f4ed2f",
  "2026-09-bestaetigungsseite-3": "d14ba6338194b3ba562ab09a76472af2bd7b7834e9a4b7956046025b8c8f3f19",
  "2026-09-bestaetigungsseite-4": "5bd721936cf000ca996d98013728b06af2d116d0e19b69d9c29771965a40a411",
  "2026-09-bestaetigungsseite-5": "8d3de56751483fe06311f894784b4562908e9d133386e004e9702db6e631215a",
  "2026-09-schiedsrichterseite": "21e9351ead79fce150e6dc1c822b0912ae630c493935fb901992a17948d893f0",
  "2026-09-spielerseite": "e3b95487516031a6f42bd6eba653ee1b3e7e32708a226d2cdf5067c2119b76d9",
};

// The controls are inside because a record cites its label and nothing else: a chip reworded under
// a standing label would leave that record quoting a question nobody was asked.

/** Every word the label freezes, in one hash: the paragraphs, the switch's label, and each control's. */
const fassungDigest = (fassung: EinwilligungFassung): string =>
  createHash("sha256")
    .update(
      [
        ...fassung.absaetze,
        fassung.schalter,
        ...Object.keys(fassung.bedienelemente)
          .sort()
          .map((key) => `${key}=${fassung.bedienelemente[key] ?? ""}`),
      ].join("\n"),
      "utf8",
    )
    .digest("hex");

/** The bound the API publishes, so the label is judged against the tier that stores it rather than a copy of the number. */
function publishedVersionMaxLength(): number {
  const document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as {
    components?: { schemas?: Record<string, { properties?: Record<string, { maxLength?: number }> }> };
  };
  const bound = document.components?.schemas?.FLBewerbungEinwilligungPayload?.properties?.text_version?.maxLength;

  assert.ok(typeof bound === "number", `no maxLength on the submitted Kenntnisnahme's text_version — regenerate with: ${REGENERATE}`);
  return bound;
}

describe("LIGA_KENNTNISNAHMEN", () => {
  it("answers each label it holds with that label's own paragraphs and switch", () => {
    for (const [textVersion, fassung] of Object.entries(LIGA_KENNTNISNAHMEN)) {
      assert.deepEqual(einwilligungFassung(textVersion), fassung, `${textVersion} resolves to another version's wording`);
    }
  });

  /* The registry's one purpose, held mechanically rather than by reading: every other case here
     compares a label against the very expression that defines it, and a rewording moves both. */
  it("still holds, label by label, the words each label's digest was minted over", () => {
    // Both directions: a new label fails until its own digest is minted, and a digest whose label
    // is gone fails rather than standing over nothing.
    assert.deepEqual(
      Object.keys(FASSUNG_DIGESTS).sort(),
      Object.keys(LIGA_KENNTNISNAHMEN).sort(),
      "a label has no frozen digest, or the reverse",
    );

    for (const [textVersion, fassung] of Object.entries(LIGA_KENNTNISNAHMEN)) {
      assert.equal(
        fassungDigest(fassung),
        FASSUNG_DIGESTS[textVersion],
        `${textVersion} no longer holds the words its records cite — mint a new label, never a new digest here`,
      );
    }
  });

  it("holds the version the form stamps, and reads the current wording off that entry", () => {
    const { textVersion, ...aktuell } = LIGA_KENNTNISNAHME;

    assert.deepEqual(einwilligungFassung(textVersion), aktuell, "the stamped version and the rendered wording have come apart");
  });

  /* The digests pin each label's words; nothing else pins WHICH label is live, and an earlier label
     states the fourteen days with no start, or with no carve-out for the reminder. */
  it("points both live labels at a wording naming when the fourteen days start and what does not restart them", () => {
    for (const { textVersion, absaetze } of [LIGA_KENNTNISNAHME, BESTAETIGUNG_KENNTNISNAHME]) {
      const text = absaetze.join(" ");

      assert.ok(text.includes("dem Versand"), `${textVersion} states the deadline without naming the day it starts`);
      assert.ok(text.includes("eine Erinnerung verschiebt sie nicht"), `${textVersion} lets a reminder read as a new deadline`);
    }
  });

  /* Its own case rather than a third entry in the array above: a registration's deadline is seven
     days from the mail with no re-send, so that case's two sentences are false of this page. */
  it("points the live pupil label at a wording naming the seven days a registration has", () => {
    const text = SPIELER_EINWILLIGUNG.absaetze.join(" ");

    assert.ok(text.includes("sieben Tagen"), `${SPIELER_EINWILLIGUNG.textVersion} states no deadline a pupil can count`);
  });

  /* The three other periods read as exhausting the outcomes, so a reader whose own confirmation
     produced the fourth is shown three periods and told nothing about theirs. */
  it("points the live confirmation label at a wording naming the period for an application nobody decides", () => {
    const text = BESTAETIGUNG_KENNTNISNAHME.absaetze.join(" ");

    assert.ok(text.includes("ohne Entscheidung"), `${BESTAETIGUNG_KENNTNISNAHME.textVersion} states no period for an undecided application`);
    assert.ok(text.includes("vorbei ist"), `${BESTAETIGUNG_KENNTNISNAHME.textVersion} names no day that period is counted to`);
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
    const neu = einwilligungFassung(LIGA_KENNTNISNAHME.textVersion);

    assert.ok(alt !== null && neu !== null, "a label the record holds resolved to nothing");
    // The failure this registry exists to prevent: the 2026-08 switch consented to a stored birthdate, and the
    // confirmation wording asks each person for their own, so one label may not answer the other's words.
    assert.ok(alt.absaetze.join(" ").includes("Geburtsdatum speichert"), "the retired wording lost the words that identify it");
    assert.ok(!neu.absaetze.join(" ").includes("Geburtsdatum speichert"), "the current wording answers under the old label");
    assert.notEqual(alt.schalter, neu.schalter, "both versions label the switch the same way");
  });

  it("carries no empty paragraph and no paragraph padded with whitespace", () => {
    for (const [textVersion, fassung] of Object.entries(LIGA_KENNTNISNAHMEN)) {
      assert.ok(fassung.absaetze.length > 0, `${textVersion} holds no paragraph at all`);

      for (const text of [...fassung.absaetze, fassung.schalter, ...Object.values(fassung.bedienelemente)]) {
        assert.equal(text.trim(), text, `${textVersion} holds a paragraph or a control label padded with whitespace`);
        assert.ok(text.length > 0, `${textVersion} holds an empty paragraph or control label`);
      }
    }
  });

  /* The page places its sections BY KEY, the label freezes them BY POSITION. A rewording mints a
     fresh array under a fresh label, leaving the keyed object behind and the page rendering words
     no record cites. */
  it("hands each page's keyed paragraphs and its stamped array the same words", () => {
    for (const kenntnisnahme of [SPIELER_EINWILLIGUNG, SCHIEDSRICHTER_EINWILLIGUNG]) {
      assert.deepEqual(Object.values(kenntnisnahme.absaetzeNachSchluessel), [...kenntnisnahme.absaetze]);
    }
  });

  /* A control whose words sit outside the frozen wording is a question a record cannot reproduce
     beside the answer it holds, which is what every consent page here exists to make possible. */
  it("carries every control label of the two pages that ask a second question", () => {
    // Both ask the publication question with the same two chips, keyed by the `umfang` each writes,
    // so a record of either page reproduces the words beside the answer it stores.
    for (const kenntnisnahme of [SPIELER_EINWILLIGUNG, SCHIEDSRICHTER_EINWILLIGUNG]) {
      assert.deepEqual(Object.keys(kenntnisnahme.bedienelemente).sort(), ["intern", "kader_oeffentlich"]);
    }
    assert.notEqual(
      SPIELER_EINWILLIGUNG.bedienelemente.intern,
      SCHIEDSRICHTER_EINWILLIGUNG.bedienelemente.intern,
      "one page's chip answers the other's page, where the two say different things about a name",
    );
  });

  /* The submission form's label is stamped on a record the applicant made and on one the admin
     editor made, and neither of those readers saw a word of the confirmation page. */
  it("gives the confirmation page a label of its own, sharing no paragraph with the submitted one", () => {
    const eingereicht: readonly string[] = LIGA_KENNTNISNAHME.absaetze;

    assert.notEqual(BESTAETIGUNG_KENNTNISNAHME.textVersion, LIGA_KENNTNISNAHME.textVersion, "both surfaces stamp one label");
    assert.deepEqual(
      BESTAETIGUNG_KENNTNISNAHME.absaetze.filter((absatz) => eingereicht.includes(absatz)),
      [],
      "a paragraph answers under both labels, so one of the two records cites words nobody read",
    );
  });

  /* The page reads its paragraphs by name and stamps the label beside them; resolved apart, the
     record would cite a version whose words the page had stopped rendering. */
  it("resolves the confirmation label to the very paragraphs the page reads", () => {
    assert.deepEqual(einwilligungFassung(BESTAETIGUNG_KENNTNISNAHME.textVersion)?.absaetze, Object.values(BESTAETIGUNG_ABSAETZE));
  });

  it("labels every version within the length the API accepts for a stored one", () => {
    const bound = publishedVersionMaxLength();

    for (const textVersion of Object.keys(LIGA_KENNTNISNAHMEN)) {
      assert.ok(
        textVersion.length <= bound,
        `"${textVersion}" is ${String(textVersion.length)} characters, past the ${String(bound)} a record may cite`,
      );
    }
  });
});

describe("fuelleFassung", () => {
  it("puts the reader's own facts in the slots the stored wording leaves for them", () => {
    assert.equal(
      fuelleFassung("Du bist als {rolle} für {schule} eingetragen.", { rolle: "Ansprechperson", schule: "Lessing-Kolleg" }),
      "Du bist als Ansprechperson für Lessing-Kolleg eingetragen.",
    );
  });

  /* Blanked, the sentence reads as finished and the stored label answers a wording with a hole
     nobody can see; left standing, the slot names the fact that never arrived. */
  it("leaves a slot no record filled standing", () => {
    assert.equal(fuelleFassung("{rolle} für {schule}", { schule: "Lessing-Kolleg" }), "{rolle} für Lessing-Kolleg");
  });
});
