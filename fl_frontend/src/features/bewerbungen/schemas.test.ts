import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { getGermanTodayStr } from "@/shared/utils/date";
import { toFieldErrors } from "@/shared/utils/validation";

import { SCHULE_NICHT_IN_LISTE } from "./constants.ts";
import { FLPostBewerbungPayloadSchema } from "./schemas.ts";
import { bewerbungPayload, buildEmptyBewerbungDraft, geburtsdatumSpanne } from "./utils.ts";

import type { BewerbungFormDraft, BewerbungKontaktpersonDraft, BewerbungSchuleDraft } from "./types.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/* Derived from the same clock the schema reads rather than pinned to a date: a fixture spelling the
   bounds out would pass today and refuse itself tomorrow. */
const HEUTE = getGermanTodayStr();
const { frueheste, spaeteste } = geburtsdatumSpanne(HEUTE);

/**
 * A whole person, so every case below fails for the one rule it names. The birthdate is the LATEST
 * the span admits, which is what makes the boundary cases beneath it read as boundaries.
 */
const person = (vorname: string, overrides: Partial<BewerbungKontaktpersonDraft> = {}): BewerbungKontaktpersonDraft => ({
  vorname: vorname,
  nachname: "Mustermann",
  email: `${vorname.toLowerCase()}@beispiel.de`,
  telefon: `069 ${vorname.length}234567`,
  geburtsdatum: "1990-01-01",
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

    assert.deepEqual(refusedPaths(geteilt), ["kontakte.ansprechperson.telefon"]);
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

    assert.deepEqual(refusedPaths(geteilt), ["kontakte.stellvertretung.email", "kontakte.stellvertretung.telefon"]);
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

describe("a contact person's birthdate", () => {
  const mitDatum = (geburtsdatum: string) =>
    gueltig({ kontakte: { ...gueltig().kontakte, ansprechperson: person("Erika", { geburtsdatum: geburtsdatum }) } });

  /* Both ends inclusive, and the schema reads the same `geburtsdatumSpanne` the picker's bounds come
     from: judged a day apart, a date the picker offered would come back refused. */
  it("is accepted at both ends of the span", () => {
    assert.deepEqual(refusedPaths(mitDatum(spaeteste)), []);
    assert.deepEqual(refusedPaths(mitDatum(frueheste)), []);
  });

  it("is refused outside either end", () => {
    // Born today, so inside the span by no margin at all — the one case an off-by-one would admit.
    assert.deepEqual(refusedPaths(mitDatum(HEUTE)), ["kontakte.ansprechperson.geburtsdatum"]);
    assert.deepEqual(refusedPaths(mitDatum("1800-01-01")), ["kontakte.ansprechperson.geburtsdatum"]);
  });

  /* ONE message answers both ends, so it has to describe both. Named for the floor alone, a mistyped
     year read back as „muss mindestens 16 Jahre alt sein“, which is a different fault from the one
     the reader has and points at the wrong end of the box. */
  it("names both bounds, whichever end the date fell outside", () => {
    const antwort = (geburtsdatum: string) => {
      const parsed = FLPostBewerbungPayloadSchema.safeParse(bewerbungPayload(mitDatum(geburtsdatum)));

      return parsed.success ? "" : (toFieldErrors(parsed.error)["kontakte.ansprechperson.geburtsdatum"] ?? "");
    };

    for (const datum of [HEUTE, "1800-01-01"]) {
      assert.match(antwort(datum), /mindestens/, `a date at ${datum} names no lower bound`);
      assert.match(antwort(datum), /höchstens/, `a date at ${datum} names no upper bound`);
    }
  });

  /* An empty box is a date nobody entered, which the picker shows as empty. Accepted here, a person
     with no birthdate would reach the league's records through a field nobody filled. */
  it("is refused where nobody entered one", () => {
    assert.deepEqual(refusedPaths(mitDatum("")), ["kontakte.ansprechperson.geburtsdatum"]);
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

describe("what a new school has to state", () => {
  it("refuses a Kürzel that is not exactly two characters", () => {
    assert.deepEqual(refusedPaths(gueltig({ schule: schule({ shorthand: "GGY" }) })), ["schule.shorthand"]);
  });

  /* `trim` clears a break at either END and leaves an interior one, and every surface that sets one
     value to the line reads that as a second line — in the decision emails, one the reader cannot
     tell from a stated fact (`fl_frontend/src/core/bewerbungEmail.ts :: renderText`). */
  for (const [was, wert] of [
    ["a line feed", "Goethe\nStartgeld: 500 Euro"],
    ["a carriage return and line feed", "Goethe\r\nStartgeld: 500 Euro"],
    ["a lone carriage return", "Goethe\rStartgeld: 500 Euro"],
  ]) {
    it(`refuses a team name broken by ${was}`, () => {
      assert.deepEqual(refusedPaths(gueltig({ schule: schule({ team_name: wert }) })), ["schule.team_name"]);
    });

    it(`refuses a full name broken by ${was}`, () => {
      assert.deepEqual(refusedPaths(gueltig({ schule: schule({ full_name: wert }) })), ["schule.full_name"]);
    });
  }

  /* A break at either end is TRIMMED rather than refused: it is a paste artefact, not a second line,
     and refusing it would fail a name the form can repair on its own. */
  it("trims a name padded with a break rather than refusing it", () => {
    assert.deepEqual(refusedPaths(gueltig({ schule: schule({ team_name: "\n Goethe \n" }) })), []);
  });

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
