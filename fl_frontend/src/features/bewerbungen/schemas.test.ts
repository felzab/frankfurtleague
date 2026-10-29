import { laufendeFassung } from "@/test-support/einwilligungRegistry.ts";
import { renderMarkup, textOf } from "@/test-support/renderMarkup.ts";
import { assert, describe, expect, it } from "vitest";

import { toFieldErrors } from "@/shared/utils/validation";

import { FormTeamSection } from "./components/forms/BewerbungForm/FormTeamSection.tsx";
import {
  BEWERBUNG_STUFENGROESSE_MAX,
  BEWERBUNG_TOKEN_MAX_LENGTH,
  BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH,
  SCHULE_NICHT_IN_LISTE,
} from "./constants.ts";
import {
  FLBewerbungEinwilligungAnsichtPayloadSchema,
  FLBewerbungEinwilligungAntwortPayloadSchema,
  FLBewerbungKontaktEmailPayloadSchema,
  FLBewerbungTrikotFarbenResponseSchema,
  FLBewerbungZustellungAngenommenPayloadSchema,
  FLBewerbungZustellungEreignisPayloadSchema,
  FLPostBewerbungPayloadSchema,
  gleicheAdresse,
  ZUSTELLUNG_GRUND_MAX_LENGTH,
  ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH,
  ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH,
} from "./schemas.ts";
import { bewerbungPayload, buildEmptyBewerbungDraft } from "./utils.ts";

import type { BewerbungFormDraft, BewerbungKontaktpersonDraft, BewerbungSchuleDraft } from "./types.ts";

/** The label the application form runs, off the registry the backend generated. */
const FORM_LABEL = laufendeFassung("bewerbung").text_version;

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
  address: { strasse: "Feldweg", hausnummer: "12", plz: "60327", stadtteil: "Gallus", stadt: "Frankfurt" },
  website_url: "https://gg.de",
  ...overrides,
});

/** A submission that passes, so a failing case below fails for the field it changed and no other. */
const validDraft = (overrides: Partial<BewerbungFormDraft> = {}): BewerbungFormDraft => ({
  ...buildEmptyBewerbungDraft("2627", FORM_LABEL),
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
    expect(refusedPaths(validDraft())).toStrictEqual([]);
  });

  /* The API stores an umlaut domain as its punycode and refuses an umlaut before the at sign, so the
     one school applies and the other is told so at the box. */
  it("accepts a contact address with an umlaut domain and refuses one with an umlaut before the at sign", () => {
    const draft = validDraft();
    const withAddress = (email: string) => validDraft({ kontakte: { ...draft.kontakte, trainer: person("Tim", { email }) } });

    expect(refusedPaths(withAddress("erika@käthe-schule.example"))).toStrictEqual([]);
    expect(refusedPaths(withAddress("käthe@beispiel.de"))).toStrictEqual(["kontakte.trainer.email"]);
  });

  /* The API answers a hyphen-final label with a REQ-VAL-001 that marks the box with a generic
     sentence, which never tells the applicant what to change. */
  it("refuses a contact address the API would refuse, on that seat's own box", () => {
    const draft = validDraft();
    const brokenDraft = validDraft({ kontakte: { ...draft.kontakte, trainer: person("Tim", { email: "tim@ab-.de" }) } });

    expect(refusedPaths(brokenDraft)).toStrictEqual(["kontakte.trainer.email"]);
  });
});

describe("the three people have to be tellable apart", () => {
  /* The league reaches a team through three people. Two seats sharing a mailbox means one person
     answering for both, and the second seat then exists on paper only. */
  it("refuses a shared e-mail address, on the seat the applicant reaches second", () => {
    const draft = validDraft();
    const sharedSeat = validDraft({
      kontakte: { ...draft.kontakte, stellvertretung: person("Lena", { email: draft.kontakte.ansprechperson.email }) },
    });

    expect(refusedPaths(sharedSeat)).toStrictEqual(["kontakte.stellvertretung.email"]);
  });

  it("refuses a shared telephone number the same way", () => {
    const draft = validDraft();
    const sharedSeat = validDraft({
      kontakte: { ...draft.kontakte, ansprechperson: person("Erika", { telefon: draft.kontakte.trainer.telefon }) },
    });

    // The TRAINER's box, although the Ansprechperson's is the one that was changed: the Trainer's
    // panel is the later of the two, so it is the one still on screen when the message appears.
    expect(refusedPaths(sharedSeat)).toStrictEqual(["kontakte.trainer.telefon"]);
  });

  /* Case is not a second person: byte for byte, `ERIKA@…` beside `erika@…` passes here and is then
     refused by the backend. The variant is valid alone, so the refusal below is the shared one. */
  it("reads a case variant of one address as the same mailbox", () => {
    const sharedSeat = validDraft({
      kontakte: { ...validDraft().kontakte, stellvertretung: person("Lena", { email: "ERIKA@beispiel.de" }) },
    });

    expect(refusedPaths(sharedSeat)).toStrictEqual(["kontakte.stellvertretung.email"]);
  });

  /* The exception the rule exists with: a seat DECLARED to be the Trainer is one person in two
     slots, so their address standing twice is the claim rather than a collision. */
  it("allows the declared pair to share everything", () => {
    const sharedSeat = validDraft({
      kontakte: {
        trainer: person("Erika"),
        ansprechperson: person("Erika"),
        stellvertretung: person("Lena"),
        trainer_ist_zugleich: "ansprechperson",
      },
    });

    expect(refusedPaths(sharedSeat)).toStrictEqual([]);
  });

  /* The exception is scoped to the pair the claim names. Widened to the whole block, a school could
     submit three identical people and the league would find that out after accepting them. */
  /* Two seats are marked and one is on screen: the claim collapses the Trainer's boxes, so its two
     paths reach no control, and `focusFirstRefusal` moves to the Stellvertretung's — the panel the
     applicant can act on. */
  /* The WHOLE refused set, never `length > 0`: that shape passes on any refusal at all, so a fixture
     that later trips an unrelated rule keeps the case green while it stops testing this one. */
  it("still separates the seat the claim does not name", () => {
    const sharedSeat = validDraft({
      kontakte: {
        trainer: person("Erika"),
        ansprechperson: person("Erika"),
        stellvertretung: person("Erika"),
        trainer_ist_zugleich: "ansprechperson",
      },
    });

    expect(refusedPaths(sharedSeat)).toStrictEqual([
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
      validDraft({
        kontakte: {
          trainer: person("Tim"),
          ansprechperson: person("Erika"),
          stellvertretung: person("Lena"),
          trainer_ist_zugleich: "ansprechperson",
        },
      }),
    );
    const drifted = {
      ...payload,
      kontakte: { ...payload.kontakte, ansprechperson: { ...payload.kontakte.ansprechperson, telefon: "069 7234567" } },
    };
    const parsed = FLPostBewerbungPayloadSchema.safeParse(drifted);

    expect(parsed.success ? [] : Object.keys(toFieldErrors(parsed.error)).sort()).toStrictEqual(["kontakte.ansprechperson.telefon"]);
  });

  /* zod skips a refinement once a check in its object aborts, and the consent switch left off is one:
     without `when` this refusal would wait for the switch and reach the applicant on a second press. */
  it("refuses a shared e-mail address while the Kenntnisnahme is still off", () => {
    const draft = validDraft();
    const sharedSeat = validDraft({
      kontakte: {
        ...draft.kontakte,
        trainer: person("Tim", { einwilligung: { text_version: "2026-08", erteilt: false } }),
        stellvertretung: person("Lena", { email: draft.kontakte.ansprechperson.email }),
      },
    });

    expect(refusedPaths(sharedSeat)).toStrictEqual(["kontakte.stellvertretung.email", "kontakte.trainer.einwilligung.erteilt"]);
  });

  /* Read off the issues rather than the field map, which keeps a box's first message: the empty box's
     own refusal comes first and would hide a second one claiming the empty numbers are shared. */
  it("calls no two empty boxes one person, the fold reading two empty numbers as equal", () => {
    const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(buildEmptyBewerbungDraft("2627", FORM_LABEL)));
    const sharedSeat = parsed.success ? [] : parsed.error.issues.filter((issue) => issue.message.includes("schon bei einer anderen Person"));

    expect(parsed.success).toBe(false);
    expect(sharedSeat).toStrictEqual([]);
  });

  /* A drifted client can send a seat that is no object and a claim naming no seat. The pair checks run
     beside those refusals, so they have to read such a block without throwing. */
  it("answers a block missing a seat or naming no seat with refusals rather than a throw", () => {
    const payload = bewerbungPayload(validDraft());
    const withoutSeat = Object.fromEntries(Object.entries(payload.kontakte).filter(([sitz]) => sitz !== "stellvertretung"));

    for (const kontakte of [withoutSeat, { ...payload.kontakte, trainer_ist_zugleich: "trainer" }]) {
      const parsed = FLPostBewerbungPayloadSchema.safeParse({ ...payload, kontakte });

      expect(parsed.success, JSON.stringify(Object.keys(kontakte))).toBe(false);
    }
  });

  /* The claim's own effect on the payload: the named seat's person BECOMES the Trainer's, so the
     Trainer's own untouched boxes never reach the submission. */
  it("submits the claimed seat's person as the Trainer", () => {
    const draft = validDraft({
      kontakte: {
        trainer: person("Tim"),
        ansprechperson: person("Erika"),
        stellvertretung: person("Lena"),
        trainer_ist_zugleich: "ansprechperson",
      },
    });

    expect(bewerbungPayload(draft).kontakte.trainer.vorname).toBe("Erika");
  });
});

describe("two spellings of one telephone number are one number", () => {
  /* `fl_backend/app/api/teams/schemas.py :: normalise_telefon` compares digits and folds both
     country codes. Compared as raw text here, the form accepts a pair the backend refuses as a 422
     naming the contact block rather than a box, so no box carries the answer. */
  const sharedNumber = (eine: string, andere: string) => {
    const basis = validDraft();

    return validDraft({
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
      expect(refusedPaths(sharedNumber(eine, andere))).toStrictEqual(["kontakte.stellvertretung.telefon"]);
    });
  }

  /* The fold may not over-match either: two different numbers that merely start alike are two people,
     and refusing them would cost a school a seat it filled correctly. */
  it("leaves two genuinely different numbers standing", () => {
    expect(refusedPaths(sharedNumber("0170 1234567", "0170 1234568"))).toStrictEqual([]);
    expect(refusedPaths(sharedNumber("+49 170 1234567", "+49 171 1234567"))).toStrictEqual([]);
  });
});

describe("the Kenntnisnahme each seat carries", () => {
  /* `z.literal(true)` and not a boolean: an untouched switch submits `false`, and a payload carrying
     that would record the absence of an acknowledgement as an answer to the question. */
  it("refuses an unticked box on the seat that left it unticked", () => {
    const without = validDraft({
      kontakte: { ...validDraft().kontakte, stellvertretung: person("Lena", { einwilligung: { text_version: "2026-08", erteilt: false } }) },
    });

    expect(refusedPaths(without)).toStrictEqual(["kontakte.stellvertretung.einwilligung.erteilt"]);
  });

  /* The version is what a stored record cites. Without it the record claims acknowledgement of wording
     nobody can identify afterwards. */
  it("refuses a Kenntnisnahme citing no wording version", () => {
    const without = validDraft({
      kontakte: { ...validDraft().kontakte, trainer: person("Tim", { einwilligung: { text_version: "  ", erteilt: true } }) },
    });

    expect(refusedPaths(without)).toStrictEqual(["kontakte.trainer.einwilligung.text_version"]);
  });
});

describe("a submission names exactly one school", () => {
  /* The picker's key IS the answer, so an unanswered picker is the only shape left that names
     neither. `team_id` is where the message lands, that being the name the picker renders under. */
  it("refuses one where nothing was picked", () => {
    expect(refusedPaths(validDraft({ auswahl: null }))).toStrictEqual(["team_id"]);
  });

  /* zod skips a refinement once any box is refused, so without `when` an empty first press would mark
     every box but the picker, whose message would come with the second. */
  it("marks the unpicked school in the same press as every empty box", () => {
    const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(buildEmptyBewerbungDraft("2627", FORM_LABEL)));
    const refusals = parsed.success ? {} : toFieldErrors(parsed.error);

    assert.ok(Object.keys(refusals).length > 1, "the empty draft is refused for the picker alone, so nothing else competes with it");
    expect(refusals.team_id).toBe("Bitte wähle eine Schule aus oder trage eine neue ein.");
  });

  /* The picked-club arm carries no school block at all, so nothing of the club's own details is
     re-submitted by a visitor who could type anything into them. */
  it("accepts one naming a club the league already holds", () => {
    expect(refusedPaths(validDraft({ auswahl: "6890a1b2c3d4e5f607190001" }))).toStrictEqual([]);
  });

  /* The whole reason one field holds the answer: a club and a new school cannot BOTH reach the
     payload, whatever the applicant typed into the new school's boxes first. */
  it("drops a typed new school the moment a club is picked", () => {
    const payload = bewerbungPayload(validDraft({ auswahl: "6890a1b2c3d4e5f607190001" }));

    expect(payload.schule).toBe(null);
    expect(payload.team_id).toBe("6890a1b2c3d4e5f607190001");
  });

  /* The mirror image, and the reason the sentinel may not look like an id: under it the picked key
     is not a club, so nothing of it may reach `team_id`. */
  it("names no club while the new-school option stands", () => {
    const payload = bewerbungPayload(validDraft());

    expect(payload.team_id).toBe(null);
    expect(payload.schule?.team_name).toBe("Goethe");
  });
});

/* Every character `fl_backend/app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN` refuses, spelled
   by codepoint so this file carries no invisible byte of its own. Read by both names and by the
   wished opponent, so one rule is stated once. */
const SINGLE_LINE = [
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
 * the padded cases below: NUL and U+0085 it does not, and U+0085 is the one pydantic's strip clears.
 */
const SINGLE_LINE_CHARS = SINGLE_LINE.map(([was, codes, trimmed]) => [was, String.fromCodePoint(...codes), trimmed] as const);

/** The interior case: a name a character of the class breaks in half. */
const SINGLE_LINE_BROKEN = SINGLE_LINE_CHARS.map(([was, character]) => [was, `Goethe${character}Startgeld: 500 Euro`] as const);

/** What every case above breaks, unbroken -- the value the accept direction is asserted against. */
const SINGLE_LINE_INTACT = "Goethe Startgeld: 500 Euro";

describe("what a new school has to state", () => {
  it("refuses a Kürzel that is not exactly two characters", () => {
    expect(refusedPaths(validDraft({ schule: schule({ shorthand: "GGY" }) }))).toStrictEqual(["schule.shorthand"]);
  });

  /* `trim` leaves an interior break, and every surface that sets one value to the line reads it as a
     second line — in a decision mail, one no reader can tell from a stated fact. */
  for (const [was, padded2] of SINGLE_LINE_BROKEN) {
    it(`refuses a team name broken by ${was}`, () => {
      expect(refusedPaths(validDraft({ schule: schule({ team_name: padded2 }) }))).toStrictEqual(["schule.team_name"]);
    });

    it(`refuses a full name broken by ${was}`, () => {
      expect(refusedPaths(validDraft({ schule: schule({ full_name: padded2 }) }))).toStrictEqual(["schule.full_name"]);
    });
  }

  /* The other direction, stated once: what every case above breaks is itself accepted, so a refusal
     there is the character's own rather than a length or a shape the case never named. */
  it("takes the same names with none of the class in them", () => {
    expect(refusedPaths(validDraft({ schule: schule({ team_name: SINGLE_LINE_INTACT }) }))).toStrictEqual([]);
    expect(refusedPaths(validDraft({ schule: schule({ full_name: SINGLE_LINE_INTACT }) }))).toStrictEqual([]);
  });

  /* At either END it is a paste artefact rather than a second line, so `trim` repairs what it clears
     and the name stands. NUL and U+0085 it does not, so those are refused padded too -- and U+0085
     is the one point the two ends disagree on. */
  for (const [was, character, trimmed] of SINGLE_LINE_CHARS) {
    it(`${trimmed ? "trims" : "refuses"} a team name padded with ${was}`, () => {
      const padded2 = `${character} Goethe ${character}`;

      expect(refusedPaths(validDraft({ schule: schule({ team_name: padded2 }) }))).toStrictEqual(trimmed ? [] : ["schule.team_name"]);
    });
  }

  /* `ExternalUrlSchema` rather than `z.url()`: the address is rendered into an `href` on a public
     page once the club exists, and `javascript:` parses as a URL. */
  it("refuses a website address with no http scheme", () => {
    expect(refusedPaths(validDraft({ schule: schule({ website_url: "javascript:alert(1)" }) }))).toStrictEqual(["schule.website_url"]);
  });

  /* Answered, unlike the club editor's: the one person who knows which school type it is, is the
     applicant filling this box, and „Keine Angabe“ there is a gap nobody chases afterwards. */
  it("refuses an unanswered school type", () => {
    expect(refusedPaths(validDraft({ schule: schule({ schulform: null }) }))).toStrictEqual(["schule.schulform"]);
  });

  /* Required on THIS payload alone. The shared address model leaves it optional, because a place can
     genuinely lack a district; a Frankfurt school cannot, and the league plans travel by it. */
  it("refuses an address with no district", () => {
    const without = validDraft({ schule: schule({ address: { ...schule().address, stadtteil: "" } }) });

    expect(refusedPaths(without)).toStrictEqual(["schule.address.stadtteil"]);
  });

  it("still accepts an address with no district through the shared model", async () => {
    // The shared payload, imported here rather than asserted about in prose: the carve-out above is
    // only a carve-out if the model it extends still admits what it refuses.
    const { FLAddressPayloadSchema } = await import("@/shared/schemas");

    expect(FLAddressPayloadSchema.safeParse({ ...schule().address, stadtteil: "" }).success).toBe(true);
  });
});

describe("the colour the school wishes for", () => {
  /* Answered on the PAYLOAD, unlike the stored field it becomes: a school has a wish, and an empty
     row standing for „keine“ satisfies the browser's `required` while meaning the opposite. */
  it("refuses a submission naming no colour", () => {
    expect(refusedPaths(validDraft({ trikot: { vorhandener_satz: "15 rote", wunschfarbe: null } }))).toStrictEqual(["trikot.wunschfarbe"]);
  });

  it("accepts one naming a colour, and asks for nothing about the shirts themselves", () => {
    expect(refusedPaths(validDraft({ trikot: { vorhandener_satz: "", wunschfarbe: "blau" } }))).toStrictEqual([]);
  });
});

describe("what the season's assigned colours parse as", () => {
  const colourAnswer = (vergeben: unknown) => FLBewerbungTrikotFarbenResponseSchema.safeParse({ acknowledged: 1, saison_id: "2627", vergeben });

  /* First, because the refusals below are only refusals if the shape parses at all. */
  it("reads a season that has assigned some of the palette, and one that has assigned none", () => {
    expect(colourAnswer(["rot", "blau"]).success).toBe(true);
    expect(colourAnswer([]).success).toBe(true);
  });

  /* Pinned HERE rather than by `apiContract.test.ts`: that comparison reads a field's own type and
     never descends into an array's items, so `z.array(z.string())` would agree with the document. */
  it("refuses a colour the league's palette does not hold", () => {
    expect(colourAnswer(["rot", "neonpink"]).success, "the mirror admits a colour outside FLTrikotFarbe").toBe(false);
    expect(colourAnswer(["rot", 7]).success, "the mirror admits a value that is not a colour at all").toBe(false);
  });
});

describe("the opponent the school wishes for", () => {
  /* Free text and never a club id: a school may name one that has not applied yet, which is the whole
     reason this is not a picker. */
  it("accepts a name the league holds no club for", () => {
    expect(refusedPaths(validDraft({ wunschgegner: "Irgendeine Schule, die es noch nicht gibt" }))).toStrictEqual([]);
  });

  /* Optional, so an untouched box submits. `null` and not `""`: one spelling of „kein Wunsch“, or the
     stored record carries two and every reader has to test for both. */
  it("submits an untouched box as null rather than as an empty string", () => {
    const payload = bewerbungPayload(validDraft({ wunschgegner: "" }));

    expect(payload.wunschgegner).toBe(null);
    expect(refusedPaths(validDraft({ wunschgegner: "" }))).toStrictEqual([]);
  });

  /* Spaces alone are no more a wish than an empty box is, and `min_length` counts characters — so the
     form and `parse_empty_string_to_none` have to agree about which entries mean „kein Wunsch“. */
  it("submits a box holding only spaces as null too", () => {
    expect(bewerbungPayload(validDraft({ wunschgegner: "   " })).wunschgegner).toBe(null);
  });

  /* Sent untrimmed, as every other name on this payload is: the backend strips before it stores, so a
     trim here would be a second place deciding what the stored value is. */
  it("sends a named opponent as it was typed", () => {
    expect(bewerbungPayload(validDraft({ wunschgegner: " Goethe-Gymnasium " })).wunschgegner).toBe(" Goethe-Gymnasium ");
  });

  it("refuses a name past the payload's ceiling", () => {
    expect(refusedPaths(validDraft({ wunschgegner: "G".repeat(BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH + 1) }))).toStrictEqual(["wunschgegner"]);
    expect(refusedPaths(validDraft({ wunschgegner: "G".repeat(BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH) }))).toStrictEqual([]);
  });

  /* A forged line in a mail, on the one applicant-controlled value the
     payload takes: the decision mail sets one fact to the line, so an interior break opens a line
     the reader cannot tell from a stated one. */
  for (const [was, padded2] of SINGLE_LINE_BROKEN) {
    it(`refuses an opponent broken by ${was}`, () => {
      expect(refusedPaths(validDraft({ wunschgegner: padded2 }))).toStrictEqual(["wunschgegner"]);
    });
  }

  /* The other direction, as for a school's own name: what every case above breaks is accepted here. */
  it("takes the same opponent with none of the class in it", () => {
    expect(refusedPaths(validDraft({ wunschgegner: SINGLE_LINE_INTACT }))).toStrictEqual([]);
  });

  /* Padded, the same split as a school's own name: `trim` repairs what it clears, and the two it
     does not are refused rather than repaired. */
  for (const [was, character, trimmed] of SINGLE_LINE_CHARS) {
    it(`${trimmed ? "trims" : "refuses"} an opponent padded with ${was}`, () => {
      const padded2 = `${character} Goethe ${character}`;

      expect(refusedPaths(validDraft({ wunschgegner: padded2 }))).toStrictEqual(trimmed ? [] : ["wunschgegner"]);
    });
  }

  /* The one OPTIONAL key on this payload, mirroring the one default the backend model carries: a
     client that has not asked yet omits it rather than 422ing on a field the deploy before required. */
  it("accepts a submission that names no such key at all", () => {
    const { wunschgegner: _weggelassen, ...without } = bewerbungPayload(validDraft());

    expect(FLPostBewerbungPayloadSchema.safeParse(without).success).toBe(true);
  });
});

describe("the squad the school estimates", () => {
  /* The estimate the league plans a season's groups against. Zero teams is not a team, and an empty
     box is `null` rather than a number the form invented. */
  it("refuses a squad of nobody and a squad nobody estimated", () => {
    expect(refusedPaths(validDraft({ kader: { voraussichtliche_groesse: 0, gute_spieler: 0 } }))).toStrictEqual([
      "kader.voraussichtliche_groesse",
    ]);
    expect(refusedPaths(validDraft({ kader: { voraussichtliche_groesse: null, gute_spieler: 0 } }))).toStrictEqual([
      "kader.voraussichtliche_groesse",
    ]);
  });

  /* Answered rather than nullable: „keiner“ is a number, and a blank box left the league guessing
     whether the school meant none or had not looked. */
  it("refuses an unanswered count of active players and accepts a count of none", () => {
    expect(refusedPaths(validDraft({ kader: { voraussichtliche_groesse: 14, gute_spieler: null } }))).toStrictEqual(["kader.gute_spieler"]);
    expect(refusedPaths(validDraft({ kader: { voraussichtliche_groesse: 14, gute_spieler: 0 } }))).toStrictEqual([]);
  });

  it("refuses a negative count of active players", () => {
    expect(refusedPaths(validDraft({ kader: { voraussichtliche_groesse: 14, gute_spieler: -1 } }))).toStrictEqual(["kader.gute_spieler"]);
  });

  /* A fraction is not an unanswered box, and `z.int()` collapsed the two into one `invalid_type`: both
     counts told a school that typed `1.5` to say how many players it expects. */
  const kaderRefusal = (feld: "voraussichtliche_groesse" | "gute_spieler", padded2: number): string => {
    const kader = { voraussichtliche_groesse: 14, gute_spieler: 3, [feld]: padded2 };
    const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(validDraft({ kader })));

    return parsed.success ? "" : (parsed.error.issues.find((issue) => issue.path.join(".") === `kader.${feld}`)?.message ?? "");
  };

  it("tells each count apart from its own empty box when a fraction is typed", () => {
    expect(kaderRefusal("voraussichtliche_groesse", 1.5)).toBe("Ein Kader zählt keine halben Spieler.");
    expect(kaderRefusal("gute_spieler", 1.5)).toBe("Bitte gib eine ganze Zahl an Spielern ein.");
  });

  /* The half these sit beside: the empty box keeps the message that names what the field is FOR, which
     is the one a school reads most often. */
  it("keeps each count's own empty-box message", () => {
    expect(kaderRefusal("voraussichtliche_groesse", NaN)).toMatch(/^Bitte gib an, mit wie vielen Spielern/);
    expect(kaderRefusal("gute_spieler", NaN)).toMatch(/Verbandsliga/);
  });
});

describe("the Abi-Jahrgang the school states", () => {
  /* The message this one box draws, rather than the refused path: four different entries land on
     `stufengroesse`, and a case comparing paths alone would pass on any of the four. */
  const stufenRefusal = (stufengroesse: number | null): string => {
    const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(validDraft({ stufengroesse })));

    return parsed.success ? "" : (parsed.error.issues.find((issue) => issue.path.join(".") === "stufengroesse")?.message ?? "");
  };

  /* An emptied box records `null` rather than a number nobody typed, and `z.int()` answers `null` and
     a fraction alike — which is why the mirror spells this one `z.number().int()`. */
  it("asks for the count where the box is empty, and for a whole number where it holds a fraction", () => {
    expect(stufenRefusal(null)).toBe("Bitte gib an, wie viele Schülerinnen und Schüler in Deinem Abi-Jahrgang sind.");
    expect(stufenRefusal(1.5)).toBe("Bitte gib eine ganze Zahl ein.");
  });

  /* Unreachable through the control, which `react-stately` clamps to `minValue` and `maxValue` on
     commit. Kept for the openapi sweep and for a body that never came from the control at all. */
  it("names each end of the span the backend publishes", () => {
    expect(stufenRefusal(0)).toBe("Bitte gib eine Zahl ab 1 ein.");
    expect(stufenRefusal(BEWERBUNG_STUFENGROESSE_MAX + 1)).toBe(`Bitte gib höchstens ${String(BEWERBUNG_STUFENGROESSE_MAX)} an.`);
  });

  /* Both ends accepted, so each refusal above is the bound's own rather than a shape the case never
     named. A school of one pupil is a school. */
  it("takes an Abi-Jahrgang at either end of that span", () => {
    expect(refusedPaths(validDraft({ stufengroesse: 1 }))).toStrictEqual([]);
    expect(refusedPaths(validDraft({ stufengroesse: BEWERBUNG_STUFENGROESSE_MAX }))).toStrictEqual([]);
  });

  /* Asked of every applicant, not only of one entering a new school: the picked-club arm submits this
     payload too, so a form hiding the box there would compose a body nothing accepts. */
  it("asks it of an application naming a club the league already holds", () => {
    expect(refusedPaths(validDraft({ auswahl: "6890a1b2c3d4e5f607190001", stufengroesse: null }))).toStrictEqual(["stufengroesse"]);
  });
});

describe("the squad question asks for one level in both halves", () => {
  /* The label and the refusal are two sites for one bar. „im Verein“ alone was answered from breadth
     of membership rather than from level, so either half losing the qualifier puts the wrong reading
     back — and each half survives being reverted on its own. */
  it("names the same level in the label and in the refusal", () => {
    const section = renderMarkup(FormTeamSection, {
      trikot: { vorhandener_satz: "", wunschfarbe: null },
      kader: { voraussichtliche_groesse: 14, gute_spieler: null },
      wunschgegner: "",
      schulen: [],
      vergebeneFarben: [],
      onTrikotChange: () => undefined,
      onKaderChange: () => undefined,
      onWunschgegnerChange: () => undefined,
      onFieldLeft: () => undefined,
      onFarbePicked: () => undefined,
    });
    // The label of the field whose box writes the strong count, which stands before that box.
    const box = section.indexOf('name="kader.gute_spieler"');
    const opening = section.lastIndexOf('data-slot="label"', box);
    const label = box < 0 || opening < 0 ? "" : textOf(section.slice(section.indexOf(">", opening) + 1, section.indexOf("</label>", opening)));
    const refusal =
      FLPostBewerbungPayloadSchema.safeParse(
        bewerbungPayload(validDraft({ kader: { voraussichtliche_groesse: 14, gute_spieler: null } })),
      ).error?.issues.find((issue) => issue.path.join(".") === "kader.gute_spieler")?.message ?? "";

    assert.ok(label !== "", "the squad field carries no label to compare against");
    assert.ok(refusal !== "", "an unanswered squad field is not refused, so there is nothing to compare");
    expect(label, "the label dropped the level, leaving „im Verein“ to be read as breadth").toMatch(/Verbandsliga/);
    expect(refusal, "the refusal dropped the level the label names").toMatch(/Verbandsliga/);
  });
});

describe("the one field of a submitted application an administrator may move", () => {
  const CORRECTION = {
    id: "6890a1b2c3d4e5f607190001",
    rolle: "ansprechperson" as const,
    email: "erika@schule.de",
    bisherige_email: "erika.alt@schule.de",
  };

  const refusalFor = (payload: unknown): Record<string, string> => {
    const parsed = FLBewerbungKontaktEmailPayloadSchema.safeParse(payload);

    return parsed.success ? {} : toFieldErrors(parsed.error);
  };

  it("takes an application, a seat, an address and the address the page showed, and refuses any other key", () => {
    expect(refusalFor(CORRECTION)).toStrictEqual({});
    expect(Object.keys(FLBewerbungKontaktEmailPayloadSchema.parse({ ...CORRECTION, vorname: "Erika" }))).toStrictEqual([
      "id",
      "rolle",
      "email",
      "bisherige_email",
    ]);
  });

  /* One address is judged alike wherever it is typed: a sentence of this schema's own would tell an
     administrator something different from what the school was told about the same value. */
  it("refuses a malformed address in the submission's own words", () => {
    expect(refusalFor({ ...CORRECTION, email: "erika@" })["email"]).toBe("Bitte gib eine gültige E-Mail-Adresse ein.");
    expect(refusalFor({ ...CORRECTION, email: `${"e".repeat(300)}@schule.de` })["email"] ?? "").toMatch(/^Die E-Mail-Adresse darf höchstens /);
  });

  it("refuses an empty address rather than storing a seat nothing can reach", () => {
    assert.ok(refusalFor({ ...CORRECTION, email: "" })["email"] !== undefined);
  });

  /* The correction exists to reach a mailbox the submission could not, so an address the API stores
     has to pass here: refused, the seat stays unreachable and no other route moves it. */
  it("takes every address the API stores, so any mailbox can be corrected to", () => {
    for (const email of ["erika@käthe-schule.example", "a!b@schule.de"]) {
      expect(refusalFor({ ...CORRECTION, email }), email).toStrictEqual({});
    }
  });

  /* Exported for the editor, which refuses another person's address at the field: two spellings of one
     rule would let a correction through that the submission's own comparison refuses. */
  it("compares two spellings of one address the way the submission does", () => {
    expect(gleicheAdresse(" Erika@Schule.de ", "erika@schule.de")).toBe(true);
    expect(gleicheAdresse("erika@schule.de", "mira@schule.de")).toBe(false);
    expect(gleicheAdresse("", ""), "two empty boxes read as one address, which would refuse a seat that has none").toBe(false);
  });

  /* The sign-in fold, as the API compares: an umlaut domain is its punycode, a full-width „e“ before the
     at sign is another address (built from its code point, rendering as the ASCII one), and „strasse“
     is not „straße“. */
  it("folds as sign-in folds, never as a case-fold would", () => {
    expect(gleicheAdresse("erika@müller.de", "Erika@xn--mller-kva.de")).toBe(true);
    expect(gleicheAdresse(`${String.fromCharCode(0xff45)}rika@schule.de`, "erika@schule.de")).toBe(false);
    expect(gleicheAdresse("erika@straße.de", "erika@strasse.de")).toBe(false);
  });
});

describe("what the two delivery writes may put on the wire", () => {
  const MESSAGE_FOR = {
    bewerbung_id: "6890a1b2c3d4e5f607190001",
    rollen: ["ansprechperson"],
    nachricht_id: "b7f1c2d3-4e5a-6b7c-8d9e-0f1234567890",
    am: "2026-03-15T09:30:00.000Z",
  };

  const accepted = (overrides: Record<string, unknown>) =>
    FLBewerbungZustellungAngenommenPayloadSchema.safeParse({ ...MESSAGE_FOR, ...overrides });
  const ereignis = (overrides: Record<string, unknown>) =>
    FLBewerbungZustellungEreignisPayloadSchema.safeParse({ ...MESSAGE_FOR, stand: "zugestellt", grund: null, ...overrides });

  /* First, because every case below asserts a refusal: over an envelope already refused each of them
     would pass on a shape it never named. */
  it("takes the envelope each write composes", () => {
    expect(accepted({}).success).toBe(true);
    expect(ereignis({}).success).toBe(true);
  });

  /* Past the ceiling the endpoint answers 422, and neither caller retries: the acceptance's is caught
     and logged, and the event's route answers the provider 200 so it stops resending. */
  for (const [was, meldung] of [
    ["the acceptance", accepted],
    ["the event", ereignis],
  ] as const) {
    it(`refuses a message id past the endpoint's ceiling in ${was}, and takes one at it`, () => {
      expect(meldung({ nachricht_id: "a".repeat(ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH) }).success).toBe(true);
      expect(meldung({ nachricht_id: "a".repeat(ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH + 1) }).success).toBe(false);
    });

    /* The LENGTH alone, which is what the endpoint states at this field; whether the value is an
       instant at all is screened before either payload is composed. */
    it(`refuses an instant past the endpoint's ceiling in ${was}, and takes one at it`, () => {
      expect(meldung({ am: "2".repeat(ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH) }).success).toBe(true);
      expect(meldung({ am: "2".repeat(ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH + 1) }).success).toBe(false);
    });

    /* `strip_whitespace=True` runs ahead of the endpoint's own floor, so spaces alone is an empty
       value there while a ceiling without the trim would send it. */
    it(`refuses a message id of whitespace alone in ${was}`, () => {
      expect(meldung({ nachricht_id: "   " }).success).toBe(false);
      expect(meldung({ am: "   " }).success).toBe(false);
    });
  }

  /* No floor on this one, unlike the two above: the endpoint bounds the reason's length and takes an
     empty one, a bounce being a fact about the mailbox with or without the provider's token. */
  it("bounds the reason and still takes an empty one", () => {
    expect(ereignis({ grund: "" }).success).toBe(true);
    expect(ereignis({ grund: "b".repeat(ZUSTELLUNG_GRUND_MAX_LENGTH) }).success).toBe(true);
    expect(ereignis({ grund: "b".repeat(ZUSTELLUNG_GRUND_MAX_LENGTH + 1) }).success).toBe(false);
  });
});

describe("the consenting answer's birth date", () => {
  /* The leaf takes `null`, an objection carrying none, so the date picker's required mark is set by
     hand on the strength of this refusal alone. */
  it("is refused missing, on the date's own path, in German", () => {
    const parsed = FLBewerbungEinwilligungAntwortPayloadSchema.safeParse({
      token: "x".repeat(20),
      antwort: "erteilt",
      geburtsdatum: null,
      whatsapp: false,
      medien: false,
      text_version: "2026-08",
    });

    expect(parsed.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
      ["geburtsdatum", "Bitte gib Dein Geburtsdatum ein."],
    ]);
  });
});

describe("the ceiling on the confirmation link's own token", () => {
  /* A decline, so the body is whole without a date and no clock decides the case. */
  const antwortBody = { antwort: "abgelehnt", geburtsdatum: null, whatsapp: false, medien: false, text_version: "2026-08" };

  const verdicts = (token: string) => [
    FLBewerbungEinwilligungAnsichtPayloadSchema.safeParse({ token: token }),
    FLBewerbungEinwilligungAntwortPayloadSchema.safeParse({ token: token, ...antwortBody }),
  ];

  /* No control renders the token, so past `CustomBewerbungToken`'s ceiling the endpoint's
     `REQ-VAL-001` naming it marks nothing, and the page can only report a failed save. */
  it("answers a token past the endpoint's ceiling with the sentence the missing one gets", () => {
    for (const parsed of verdicts("x".repeat(BEWERBUNG_TOKEN_MAX_LENGTH + 1))) {
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toStrictEqual(["Bitte öffne den Link aus Deiner E-Mail erneut."]);
    }
  });

  it("takes a token at the ceiling, as the endpoint does", () => {
    for (const parsed of verdicts("x".repeat(BEWERBUNG_TOKEN_MAX_LENGTH))) {
      expect(parsed.success).toBe(true);
    }
  });
});

describe("the label a confirmation's answer names", () => {
  /* The endpoint refuses an empty label, so the page refuses it first, in German, rather than sending a
     body the endpoint answers with a code no box can carry. */
  it("is refused empty or blank, as the endpoint refuses it", () => {
    const antwort = { token: "kein-echtes-token", antwort: "abgelehnt", geburtsdatum: null, whatsapp: false, medien: false };

    for (const text_version of ["", "   "]) {
      const parsed = FLBewerbungEinwilligungAntwortPayloadSchema.safeParse({ ...antwort, text_version });
      expect(
        parsed.error?.issues.map((issue) => [issue.path.join("."), issue.message]),
        JSON.stringify(text_version),
      ).toStrictEqual([["text_version", "Deine Antwort nennt keine Fassung. Öffne den Link aus Deiner E-Mail erneut."]]);
    }
  });
});
