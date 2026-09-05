import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { toFieldErrors } from "@/shared/utils/validation";

import { BEWERBUNG_STUFENGROESSE_MAX, BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH, SCHULE_NICHT_IN_LISTE } from "./constants.ts";
import { FLBewerbungTrikotFarbenResponseSchema, FLPostBewerbungPayloadSchema } from "./schemas.ts";
import { bewerbungPayload, buildEmptyBewerbungDraft } from "./utils.ts";

import type { BewerbungFormDraft, BewerbungKontaktpersonDraft, BewerbungSchuleDraft } from "./types.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/** A whole person, so every case below fails for the one rule it names and no other. */
const person = (vorname: string, overrides: Partial<BewerbungKontaktpersonDraft> = {}): BewerbungKontaktpersonDraft => ({
  vorname: vorname,
  nachname: "Mustermann",
  email: `${vorname.toLowerCase()}@beispiel.de`,
  telefon: `069 ${vorname.length}234567`,
  einwilligung: { text_version: "2026-08", erteilt: true },
  ...overrides,
});

/** A whole new school, every field answered, so a failing case fails for the field it changed. */
const schule = (overrides: Partial<BewerbungSchuleDraft> = {}): BewerbungSchuleDraft => ({
  team_name: "Goethe",
  full_name: "Goethe-Gymnasium",
  shorthand: "GG",
  schulform: "gymnasium_g9",
  address: { strasse: "Friedrich-Ebert-Anlage", hausnummer: "12", plz: "60327", stadtteil: "Gallus", stadt: "Frankfurt" },
  website_url: "https://gg.de",
  ...overrides,
});

/** A submission that passes, so a failing case below fails for the field it changed and no other. */
const gueltig = (overrides: Partial<BewerbungFormDraft> = {}): BewerbungFormDraft => ({
  ...buildEmptyBewerbungDraft("2627"),
  auswahl: SCHULE_NICHT_IN_LISTE,
  schule: schule(),
  kontakte: {
    trainer: person("Tim"),
    ansprechperson: person("Erika"),
    stellvertretung: person("Lena"),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "15 rote", wunschfarbe: "rot" },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 3 },
  stufengroesse: 90,
  ...overrides,
});

/** The refused paths, keyed as the form spells its `name`s — which is how a message reaches an input. */
const refusedPaths = (draft: BewerbungFormDraft): string[] => {
  const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(draft));

  return parsed.success ? [] : Object.keys(toFieldErrors(parsed.error)).sort();
};

describe("what the public submission schema accepts", () => {
  /* First, because every case below asserts that ONE path is refused: a baseline that failed would
     make each of them pass over a refusal it did not cause. */
  it("accepts a whole submission at all", () => {
    assert.deepEqual(refusedPaths(gueltig()), []);
  });
});

describe("the three people have to be tellable apart", () => {
  /* The league reaches a team through three people. Two seats sharing a mailbox means one person
     answering for both, and the second seat then exists on paper only. */
  it("refuses a shared e-mail address, on the seat the applicant reaches second", () => {
    const draft = gueltig();
    const geteilt = gueltig({
      kontakte: { ...draft.kontakte, stellvertretung: person("Lena", { email: draft.kontakte.ansprechperson.email }) },
    });

    assert.deepEqual(refusedPaths(geteilt), ["kontakte.stellvertretung.email"]);
  });

  it("refuses a shared telephone number the same way", () => {
    const draft = gueltig();
    const geteilt = gueltig({
      kontakte: { ...draft.kontakte, ansprechperson: person("Erika", { telefon: draft.kontakte.trainer.telefon }) },
    });

    // The TRAINER's box, although the Ansprechperson's is the one that was changed: the Trainer's
    // panel is the later of the two, so it is the one still on screen when the message appears.
    assert.deepEqual(refusedPaths(geteilt), ["kontakte.trainer.telefon"]);
  });

  /* Case is not a second person: byte for byte, `ERIKA@…` beside `erika@…` passes here and is then
     refused by the backend. The variant is valid alone, so the refusal below is the shared one. */
  it("reads a case variant of one address as the same mailbox", () => {
    const geteilt = gueltig({
      kontakte: { ...gueltig().kontakte, stellvertretung: person("Lena", { email: "ERIKA@beispiel.de" }) },
    });

    assert.deepEqual(refusedPaths(geteilt), ["kontakte.stellvertretung.email"]);
  });

  /* The exception the rule exists with: a seat DECLARED to be the Trainer is one person in two
     slots, so their address standing twice is the claim rather than a collision. */
  it("allows the declared pair to share everything", () => {
    const geteilt = gueltig({
      kontakte: {
        trainer: person("Erika"),
        ansprechperson: person("Erika"),
        stellvertretung: person("Lena"),
        trainer_ist_zugleich: "ansprechperson",
      },
    });

    assert.deepEqual(refusedPaths(geteilt), []);
  });

  /* The exception is scoped to the pair the claim names. Widened to the whole block, a school could
     submit three identical people and the league would find that out after accepting them. */
  /* Two seats are marked and one is on screen: the claim collapses the Trainer's boxes, so its two
     paths reach no control, and `focusFirstRefusal` moves to the Stellvertretung's — the panel the
     applicant can act on. */
  /* The WHOLE refused set, never `length > 0`: that shape passes on any refusal at all, so a fixture
     that later trips an unrelated rule keeps the case green while it stops testing this one. */
  it("still separates the seat the claim does not name", () => {
    const geteilt = gueltig({
      kontakte: {
        trainer: person("Erika"),
        ansprechperson: person("Erika"),
        stellvertretung: person("Erika"),
        trainer_ist_zugleich: "ansprechperson",
      },
    });

    assert.deepEqual(refusedPaths(geteilt), [
      "kontakte.stellvertretung.email",
      "kontakte.stellvertretung.telefon",
      "kontakte.trainer.email",
      "kontakte.trainer.telefon",
    ]);
  });

  /* Only a drifted client reaches this: `bewerbungPayload` fills the claimed seat FROM the Trainer,
     so the payload is broken past that mirror on purpose. The 422 arm names no box. */
  it("refuses a claimed seat whose boxes disagree with the Trainer", () => {
    const payload = bewerbungPayload(
      gueltig({
        kontakte: {
          trainer: person("Tim"),
          ansprechperson: person("Erika"),
          stellvertretung: person("Lena"),
          trainer_ist_zugleich: "ansprechperson",
        },
      }),
    );
    const gedriftet = {
      ...payload,
      kontakte: { ...payload.kontakte, ansprechperson: { ...payload.kontakte.ansprechperson, telefon: "069 7234567" } },
    };
    const parsed = FLPostBewerbungPayloadSchema.safeParse(gedriftet);

    assert.deepEqual(parsed.success ? [] : Object.keys(toFieldErrors(parsed.error)).sort(), ["kontakte.ansprechperson.telefon"]);
  });

  /* The claim's own effect on the payload: the named seat's person BECOMES the Trainer's, so the
     Trainer's own untouched boxes never reach the submission. */
  it("submits the claimed seat's person as the Trainer", () => {
    const draft = gueltig({
      kontakte: {
        trainer: person("Tim"),
        ansprechperson: person("Erika"),
        stellvertretung: person("Lena"),
        trainer_ist_zugleich: "ansprechperson",
      },
    });

    assert.equal(bewerbungPayload(draft).kontakte.trainer.vorname, "Erika");
  });
});

describe("two spellings of one telephone number are one number", () => {
  /* `fl_backend/app/api/bewerbungen/schemas.py :: normalise_telefon` compares digits and folds both
     country codes. Compared as raw text here, the form accepts a pair the backend refuses as a 422,
     which names no field to land the answer under. */
  const geteilteNummer = (eine: string, andere: string) => {
    const basis = gueltig();

    return gueltig({
      kontakte: {
        ...basis.kontakte,
        ansprechperson: person("Erika", { telefon: eine }),
        stellvertretung: person("Lena", { telefon: andere }),
      },
    });
  };

  for (const [eine, andere, wie] of [
    ["+49 170 1234567", "0170 1234567", "the international form against the trunk zero"],
    ["+49 (0)170 1234567", "0170 1234567", "the bracketed trunk zero, the commonest German spelling"],
    ["0049 170 1234567", "0170 1234567", "the other country-code spelling"],
    ["0170 123 4567", "01701234567", "the same digits grouped differently"],
    ["069-1234567", "069 1234567", "a hyphen against a space"],
  ] as const) {
    it(`refuses ${wie}`, () => {
      assert.deepEqual(refusedPaths(geteilteNummer(eine, andere)), ["kontakte.stellvertretung.telefon"]);
    });
  }

  /* `PHONE_REGEX` admits `().`, which normalises to nothing, and Pydantic has no empty-guard, so it
     refuses two such seats. Guarded here, the form would offer what the write path refuses. */
  it("refuses two seats whose numbers both normalise to nothing", () => {
    assert.deepEqual(refusedPaths(geteilteNummer("().", "().")), ["kontakte.stellvertretung.telefon"]);
  });

  /* The fold may not over-match either: two different numbers that merely start alike are two people,
     and refusing them would cost a school a seat it filled correctly. */
  it("leaves two genuinely different numbers standing", () => {
    assert.deepEqual(refusedPaths(geteilteNummer("0170 1234567", "0170 1234568")), []);
    assert.deepEqual(refusedPaths(geteilteNummer("+49 170 1234567", "+49 171 1234567")), []);
  });
});

describe("the consent each person gives", () => {
  /* `z.literal(true)` and not a boolean: an untouched switch submits `false`, and a payload carrying
     that would record the absence of consent as an answer to the question. */
  it("refuses an unticked box on the seat that left it unticked", () => {
    const ohne = gueltig({
      kontakte: { ...gueltig().kontakte, stellvertretung: person("Lena", { einwilligung: { text_version: "2026-08", erteilt: false } }) },
    });

    assert.deepEqual(refusedPaths(ohne), ["kontakte.stellvertretung.einwilligung.erteilt"]);
  });

  /* The version is what a stored record cites. Without it the record claims consent to wording
     nobody can identify afterwards. */
  it("refuses a consent citing no wording version", () => {
    const ohne = gueltig({
      kontakte: { ...gueltig().kontakte, trainer: person("Tim", { einwilligung: { text_version: "  ", erteilt: true } }) },
    });

    assert.deepEqual(refusedPaths(ohne), ["kontakte.trainer.einwilligung.text_version"]);
  });
});

describe("a submission names exactly one school", () => {
  /* The picker's key IS the answer, so an unanswered picker is the only shape left that names
     neither. `team_id` is where the message lands, that being the name the picker renders under. */
  it("refuses one where nothing was picked", () => {
    assert.deepEqual(refusedPaths(gueltig({ auswahl: null })), ["team_id"]);
  });

  /* The picked-club arm carries no school block at all, so nothing of the club's own details is
     re-submitted by a visitor who could type anything into them. */
  it("accepts one naming a club the league already holds", () => {
    assert.deepEqual(refusedPaths(gueltig({ auswahl: "6890a1b2c3d4e5f607190001" })), []);
  });

  /* The whole reason one field holds the answer: a club and a new school cannot BOTH reach the
     payload, whatever the applicant typed into the new school's boxes first. */
  it("drops a typed new school the moment a club is picked", () => {
    const payload = bewerbungPayload(gueltig({ auswahl: "6890a1b2c3d4e5f607190001" }));

    assert.equal(payload.schule, null);
    assert.equal(payload.team_id, "6890a1b2c3d4e5f607190001");
  });

  /* The mirror image, and the reason the sentinel may not look like an id: under it the picked key
     is not a club, so nothing of it may reach `team_id`. */
  it("names no club while the new-school option stands", () => {
    const payload = bewerbungPayload(gueltig());

    assert.equal(payload.team_id, null);
    assert.equal(payload.schule?.team_name, "Goethe");
  });
});

/* Every character `fl_backend/app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN` refuses, spelled
   by codepoint so this file carries no invisible byte of its own. Read by both names and by the
   wished opponent, so one rule is stated once. */
const EINZEILIG = [
  // CRLF is the one row carrying TWO codepoints: a pair the others cannot stand in for.
  ["a carriage return and line feed", [0x0d, 0x0a], true],
  ["a line feed", [0x0a], true],
  ["a lone carriage return", [0x0d], true],
  ["a null byte", [0x00], false],
  ["a vertical tab", [0x0b], true],
  ["a form feed", [0x0c], true],
  ["a next line", [0x85], false],
  ["a line separator", [0x2028], true],
  ["a paragraph separator", [0x2029], true],
] as const;

/**
 * The same rows as characters. The flag is whether JavaScript's `trim` clears one, which decides
 * the padded cases below: NUL and U+0085 it does not, and U+0085 is the one `str.strip` clears.
 */
const EINZEILIG_ZEICHEN = EINZEILIG.map(([was, codes, getrimmt]) => [was, String.fromCodePoint(...codes), getrimmt] as const);

/** The interior case: a name a character of the class breaks in half. */
const EINZEILIG_GEBROCHEN = EINZEILIG_ZEICHEN.map(([was, zeichen]) => [was, `Goethe${zeichen}Startgeld: 500 Euro`] as const);

/** What every case above breaks, unbroken -- the value the accept direction is asserted against. */
const EINZEILIG_HEIL = "Goethe Startgeld: 500 Euro";

describe("what a new school has to state", () => {
  it("refuses a Kürzel that is not exactly two characters", () => {
    assert.deepEqual(refusedPaths(gueltig({ schule: schule({ shorthand: "GGY" }) })), ["schule.shorthand"]);
  });

  /* `trim` leaves an interior break, and every surface that sets one value to the line reads it as a
     second line — in a decision mail, one no reader can tell from a stated fact
     (`docs/frontend/spec.md :: I46`). */
  for (const [was, wert] of EINZEILIG_GEBROCHEN) {
    it(`refuses a team name broken by ${was}`, () => {
      assert.deepEqual(refusedPaths(gueltig({ schule: schule({ team_name: wert }) })), ["schule.team_name"]);
    });

    it(`refuses a full name broken by ${was}`, () => {
      assert.deepEqual(refusedPaths(gueltig({ schule: schule({ full_name: wert }) })), ["schule.full_name"]);
    });
  }

  /* The other direction, stated once: what every case above breaks is itself accepted, so a refusal
     there is the character's own rather than a length or a shape the case never named. */
  it("takes the same names with none of the class in them", () => {
    assert.deepEqual(refusedPaths(gueltig({ schule: schule({ team_name: EINZEILIG_HEIL }) })), []);
    assert.deepEqual(refusedPaths(gueltig({ schule: schule({ full_name: EINZEILIG_HEIL }) })), []);
  });

  /* At either END it is a paste artefact rather than a second line, so `trim` repairs what it clears
     and the name stands. NUL and U+0085 it does not, so those are refused padded too -- and U+0085
     is the one point the two ends disagree on. */
  for (const [was, zeichen, getrimmt] of EINZEILIG_ZEICHEN) {
    it(`${getrimmt ? "trims" : "refuses"} a team name padded with ${was}`, () => {
      const wert = `${zeichen} Goethe ${zeichen}`;

      assert.deepEqual(refusedPaths(gueltig({ schule: schule({ team_name: wert }) })), getrimmt ? [] : ["schule.team_name"]);
    });
  }

  /* `ExternalUrlSchema` rather than `z.url()`: the address is rendered into an `href` on a public
     page once the club exists, and `javascript:` parses as a URL. */
  it("refuses a website address with no http scheme", () => {
    assert.deepEqual(refusedPaths(gueltig({ schule: schule({ website_url: "javascript:alert(1)" }) })), ["schule.website_url"]);
  });

  /* Answered, unlike the club editor's: the one person who knows which school type it is, is the
     applicant filling this box, and „Keine Angabe“ there is a gap nobody chases afterwards. */
  it("refuses an unanswered school type", () => {
    assert.deepEqual(refusedPaths(gueltig({ schule: schule({ schulform: null }) })), ["schule.schulform"]);
  });

  /* Required on THIS payload alone. The shared address model leaves it optional, because a place can
     genuinely lack a district; a Frankfurt school cannot, and the league plans travel by it. */
  it("refuses an address with no district", () => {
    const ohne = gueltig({ schule: schule({ address: { ...schule().address, stadtteil: "" } }) });

    assert.deepEqual(refusedPaths(ohne), ["schule.address.stadtteil"]);
  });

  it("still accepts an address with no district through the shared model", async () => {
    // The shared payload, imported here rather than asserted about in prose: the carve-out above is
    // only a carve-out if the model it extends still admits what it refuses.
    const { FLAddressPayloadSchema } = await import("@/shared/schemas");

    assert.equal(FLAddressPayloadSchema.safeParse({ ...schule().address, stadtteil: "" }).success, true);
  });
});

describe("the colour the school wishes for", () => {
  /* Answered on the PAYLOAD, unlike the stored field it becomes: a school has a wish, and an empty
     row standing for „keine“ satisfies the browser's `required` while meaning the opposite. */
  it("refuses a submission naming no colour", () => {
    assert.deepEqual(refusedPaths(gueltig({ trikot: { vorhandener_satz: "15 rote", wunschfarbe: null } })), ["trikot.wunschfarbe"]);
  });

  it("accepts one naming a colour, and asks for nothing about the shirts themselves", () => {
    assert.deepEqual(refusedPaths(gueltig({ trikot: { vorhandener_satz: "", wunschfarbe: "blau" } })), []);
  });
});

describe("what the season's assigned colours parse as", () => {
  const antwort = (vergeben: unknown) => FLBewerbungTrikotFarbenResponseSchema.safeParse({ acknowledged: 1, saison_id: "2627", vergeben });

  /* First, because the refusals below are only refusals if the shape parses at all. */
  it("reads a season that has assigned some of the palette, and one that has assigned none", () => {
    assert.equal(antwort(["rot", "blau"]).success, true);
    assert.equal(antwort([]).success, true);
  });

  /* Pinned HERE rather than by `apiContract.test.ts`: that comparison reads a field's own type and
     never descends into an array's items, so `z.array(z.string())` would agree with the document. */
  it("refuses a colour the league's palette does not hold", () => {
    assert.equal(antwort(["rot", "neonpink"]).success, false, "the mirror admits a colour outside FLTrikotFarbe");
    assert.equal(antwort(["rot", 7]).success, false, "the mirror admits a value that is not a colour at all");
  });
});

describe("the opponent the school wishes for", () => {
  /* Free text and never a club id: a school may name one that has not applied yet, which is the whole
     reason this is not a picker. */
  it("accepts a name the league holds no club for", () => {
    assert.deepEqual(refusedPaths(gueltig({ wunschgegner: "Irgendeine Schule, die es noch nicht gibt" })), []);
  });

  /* Optional, so an untouched box submits. `null` and not `""`: one spelling of „kein Wunsch“, or the
     stored record carries two and every reader has to test for both. */
  it("submits an untouched box as null rather than as an empty string", () => {
    const payload = bewerbungPayload(gueltig({ wunschgegner: "" }));

    assert.equal(payload.wunschgegner, null);
    assert.deepEqual(refusedPaths(gueltig({ wunschgegner: "" })), []);
  });

  /* Spaces alone are no more a wish than an empty box is, and `min_length` counts characters — so the
     form and `parse_empty_string_to_none` have to agree about which entries mean „kein Wunsch“. */
  it("submits a box holding only spaces as null too", () => {
    assert.equal(bewerbungPayload(gueltig({ wunschgegner: "   " })).wunschgegner, null);
  });

  /* Sent untrimmed, as every other name on this payload is: the backend strips before it stores, so a
     trim here would be a second place deciding what the stored value is. */
  it("sends a named opponent as it was typed", () => {
    assert.equal(bewerbungPayload(gueltig({ wunschgegner: " Goethe-Gymnasium " })).wunschgegner, " Goethe-Gymnasium ");
  });

  it("refuses a name past the payload's ceiling", () => {
    assert.deepEqual(refusedPaths(gueltig({ wunschgegner: "G".repeat(BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH + 1) })), ["wunschgegner"]);
    assert.deepEqual(refusedPaths(gueltig({ wunschgegner: "G".repeat(BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH) })), []);
  });

  /* The forgery `docs/frontend/spec.md :: I87` describes, on the one applicant-controlled value the
     payload takes: the decision mail sets one fact to the line, so an interior break opens a line
     the reader cannot tell from a stated one. */
  for (const [was, wert] of EINZEILIG_GEBROCHEN) {
    it(`refuses an opponent broken by ${was}`, () => {
      assert.deepEqual(refusedPaths(gueltig({ wunschgegner: wert })), ["wunschgegner"]);
    });
  }

  /* The other direction, as for a school's own name: what every case above breaks is accepted here. */
  it("takes the same opponent with none of the class in it", () => {
    assert.deepEqual(refusedPaths(gueltig({ wunschgegner: EINZEILIG_HEIL })), []);
  });

  /* Padded, the same split as a school's own name: `trim` repairs what it clears, and the two it
     does not are refused rather than repaired. */
  for (const [was, zeichen, getrimmt] of EINZEILIG_ZEICHEN) {
    it(`${getrimmt ? "trims" : "refuses"} an opponent padded with ${was}`, () => {
      const wert = `${zeichen} Goethe ${zeichen}`;

      assert.deepEqual(refusedPaths(gueltig({ wunschgegner: wert })), getrimmt ? [] : ["wunschgegner"]);
    });
  }

  /* The one OPTIONAL key on this payload, mirroring the one default the backend model carries: a
     client that has not asked yet omits it rather than 422ing on a field the deploy before required. */
  it("accepts a submission that names no such key at all", () => {
    const { wunschgegner: _weggelassen, ...ohne } = bewerbungPayload(gueltig());

    assert.equal(FLPostBewerbungPayloadSchema.safeParse(ohne).success, true);
  });
});

describe("the squad the school estimates", () => {
  /* The estimate the league plans a season's groups against. Zero teams is not a team, and an empty
     box is `null` rather than a number the form invented. */
  it("refuses a squad of nobody and a squad nobody estimated", () => {
    assert.deepEqual(refusedPaths(gueltig({ kader: { voraussichtliche_groesse: 0, gute_spieler: 0 } })), ["kader.voraussichtliche_groesse"]);
    assert.deepEqual(refusedPaths(gueltig({ kader: { voraussichtliche_groesse: null, gute_spieler: 0 } })), ["kader.voraussichtliche_groesse"]);
  });

  /* Answered rather than nullable: „keiner“ is a number, and a blank box left the league guessing
     whether the school meant none or had not looked. */
  it("refuses an unanswered count of active players and accepts a count of none", () => {
    assert.deepEqual(refusedPaths(gueltig({ kader: { voraussichtliche_groesse: 14, gute_spieler: null } })), ["kader.gute_spieler"]);
    assert.deepEqual(refusedPaths(gueltig({ kader: { voraussichtliche_groesse: 14, gute_spieler: 0 } })), []);
  });

  it("refuses a negative count of active players", () => {
    assert.deepEqual(refusedPaths(gueltig({ kader: { voraussichtliche_groesse: 14, gute_spieler: -1 } })), ["kader.gute_spieler"]);
  });

  /* A fraction is not an unanswered box, and `z.int()` collapsed the two into one `invalid_type`: both
     counts told a school that typed `1.5` to say how many players it expects. */
  const kaderRefusal = (feld: "voraussichtliche_groesse" | "gute_spieler", wert: number): string => {
    const kader = { voraussichtliche_groesse: 14, gute_spieler: 3, [feld]: wert };
    const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(gueltig({ kader })));

    return parsed.success ? "" : (parsed.error.issues.find((issue) => issue.path.join(".") === `kader.${feld}`)?.message ?? "");
  };

  it("tells each count apart from its own empty box when a fraction is typed", () => {
    assert.equal(kaderRefusal("voraussichtliche_groesse", 1.5), "Ein Kader zählt keine halben Spieler.");
    assert.equal(kaderRefusal("gute_spieler", 1.5), "Bitte gib eine ganze Zahl an Spielern ein.");
  });

  /* The half these sit beside: the empty box keeps the message that names what the field is FOR, which
     is the one a school reads most often. */
  it("keeps each count's own empty-box message", () => {
    assert.match(kaderRefusal("voraussichtliche_groesse", NaN), /^Bitte gib an, mit wie vielen Spielern/);
    assert.match(kaderRefusal("gute_spieler", NaN), /Verbandsliga/);
  });
});

describe("the Abi-Jahrgang the school states", () => {
  /* The message this one box draws, rather than the refused path: four different entries land on
     `stufengroesse`, and a case comparing paths alone would pass on any of the four. */
  const stufenRefusal = (stufengroesse: number | null): string => {
    const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(gueltig({ stufengroesse })));

    return parsed.success ? "" : (parsed.error.issues.find((issue) => issue.path.join(".") === "stufengroesse")?.message ?? "");
  };

  /* An emptied box records `null` rather than a number nobody typed, and `z.int()` answers `null` and
     a fraction alike — which is why the mirror spells this one `z.number().int()`. */
  it("asks for the count where the box is empty, and for a whole number where it holds a fraction", () => {
    assert.equal(stufenRefusal(null), "Bitte gib an, wie viele Schülerinnen und Schüler in Deinem Abi-Jahrgang sind.");
    assert.equal(stufenRefusal(1.5), "Bitte gib eine ganze Zahl ein.");
  });

  /* Unreachable through the control, which `react-stately` clamps to `minValue` and `maxValue` on
     commit. Kept for the openapi sweep and for a body that never came from the control at all. */
  it("names each end of the span the backend publishes", () => {
    assert.equal(stufenRefusal(0), "Bitte gib eine Zahl ab 1 ein.");
    assert.equal(stufenRefusal(BEWERBUNG_STUFENGROESSE_MAX + 1), `Bitte gib höchstens ${String(BEWERBUNG_STUFENGROESSE_MAX)} an.`);
  });

  /* Both ends accepted, so each refusal above is the bound's own rather than a shape the case never
     named. A school of one pupil is a school. */
  it("takes an Abi-Jahrgang at either end of that span", () => {
    assert.deepEqual(refusedPaths(gueltig({ stufengroesse: 1 })), []);
    assert.deepEqual(refusedPaths(gueltig({ stufengroesse: BEWERBUNG_STUFENGROESSE_MAX })), []);
  });

  /* Asked of every applicant, not only of one entering a new school: the picked-club arm submits this
     payload too, so a form hiding the box there would compose a body nothing accepts. */
  it("asks it of an application naming a club the league already holds", () => {
    assert.deepEqual(refusedPaths(gueltig({ auswahl: "6890a1b2c3d4e5f607190001", stufengroesse: null })), ["stufengroesse"]);
  });
});

describe("the squad question asks for one level in both halves", () => {
  /* The label and the refusal are two sites for one bar. „im Verein“ alone was answered from breadth
     of membership rather than from level, so either half losing the qualifier puts the wrong reading
     back — and each half survives being reverted on its own. */
  it("names the same level in the label and in the refusal", () => {
    const TEAM_SECTION = readFileSync(
      path.join(SRC_DIR, "features", "bewerbungen", "components", "forms", "BewerbungForm", "FormTeamSection.tsx"),
      "utf8",
    );
    const label = /<Label className=\{FIELD_LABEL\}>(Davon[^<]*)<\/Label>/.exec(TEAM_SECTION)?.[1] ?? "";
    const refusal =
      FLPostBewerbungPayloadSchema.safeParse(
        bewerbungPayload(gueltig({ kader: { voraussichtliche_groesse: 14, gute_spieler: null } })),
      ).error?.issues.find((issue) => issue.path.join(".") === "kader.gute_spieler")?.message ?? "";

    assert.ok(label !== "", "the squad field carries no label to compare against");
    assert.ok(refusal !== "", "an unanswered squad field is not refused, so there is nothing to compare");
    assert.match(label, /Verbandsliga/, "the label dropped the level, leaving „im Verein“ to be read as breadth");
    assert.match(refusal, /Verbandsliga/, "the refusal dropped the level the label names");
  });
});
