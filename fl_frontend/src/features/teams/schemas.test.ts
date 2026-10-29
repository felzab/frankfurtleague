import { describe, expect, it } from "vitest";

import { FLEinwilligungStandSchema } from "@/features/spieler/schemas";

import {
  FLAustrittSchema,
  FLCreateTeamFormPayloadSchema,
  FLKontaktKenntnisnahmePayloadSchema,
  FLKontaktKenntnisnahmeSchema,
  FLPatchSaisonTeamPayloadSchema,
  FLPatchTeamPayloadSchema,
  FLPatchTeamResponseSchema,
  FLPostTeamPayloadSchema,
  FLReplaceSaisonTeamResponseSchema,
  FLSaisonTeamKontaktePayloadSchema,
  FLSaisonTeamResponseSchema,
  FLTeamRecordSchema,
  OptionalExternalUrlSchema,
} from "./schemas";

/**
 * What `fl_frontend/src/core/apiContract.test.ts` cannot reach: it compares presence, required,
 * nullable, type and enum, so a bound that disagrees with the backend's passes it green.
 */
const pathsRefused = (
  schema:
    | typeof FLKontaktKenntnisnahmePayloadSchema
    | typeof FLPatchSaisonTeamPayloadSchema
    | typeof FLPatchTeamResponseSchema
    | typeof FLPostTeamPayloadSchema
    | typeof FLReplaceSaisonTeamResponseSchema
    | typeof FLSaisonTeamKontaktePayloadSchema
    | typeof FLSaisonTeamResponseSchema
    | typeof FLTeamRecordSchema,
  value: unknown,
): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

const saisonTeam = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  saison_id: "2026",
  team_id: "0123456789abcdef01234567",
  gruppe: "A",
  austritt: null,
  trikot_farbe: null,
  kontakte: null,
  name: "SC Riederwald",
  shorthand: "RWS",
  ...overrides,
});

const patchTeam = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  updated_document: {
    id: "0123456789abcdef01234567",
    name: "SC Riederwald",
    shorthand: "RWS",
    description: "",
    full_name: "Sportclub Riederwald 1927",
    website_url: "https://example.org",
    address: { strasse: "Hanauer Landstraße", hausnummer: "12a", plz: "60314", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
    schulform: null,
    inactive_since: null,
  },
  fanned_out_to_spiele: 0,
  fanned_out_to_saison_teams: 0,
  ...overrides,
});

const replacement = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  saison_id: "2026",
  outgoing_team_id: "0123456789abcdef01234567",
  incoming_team_id: "89abcdef0123456701234567",
  gruppe: "A",
  trikot_farbe: null,
  kontakte: null,
  name: "SC Riederwald",
  shorthand: "RWS",
  fanned_out_to_spiele: 3,
  ausgetragene_squad_rows: 11,
  ...overrides,
});

describe("FLSaisonTeamResponseSchema", () => {
  it("takes a junction row carrying the season's copy of the club identity", () => {
    expect(pathsRefused(FLSaisonTeamResponseSchema, saisonTeam())).toStrictEqual([]);
  });

  it("refuses an empty name, which no club document can hold", () => {
    expect(pathsRefused(FLSaisonTeamResponseSchema, saisonTeam({ name: "" }))).toStrictEqual(["name"]);
  });

  it("requires both, so a row seeded without them is a malformed response rather than a partial one", () => {
    const { name: _name, shorthand: _shorthand, ...withoutIdentity } = saisonTeam();

    expect(pathsRefused(FLSaisonTeamResponseSchema, withoutIdentity)).toStrictEqual(["name", "shorthand"]);
  });
});

describe("FLPatchTeamResponseSchema", () => {
  it("takes a rename that reached no junction row, the answer for a club whose every season is past", () => {
    expect(pathsRefused(FLPatchTeamResponseSchema, patchTeam())).toStrictEqual([]);
  });

  it("refuses a negative junction count, a figure no `modified_count` can report", () => {
    expect(pathsRefused(FLPatchTeamResponseSchema, patchTeam({ fanned_out_to_saison_teams: -1 }))).toStrictEqual([
      "fanned_out_to_saison_teams",
    ]);
  });

  it("requires the junction count, so it cannot be read as zero when the endpoint never sent it", () => {
    const { fanned_out_to_saison_teams: _count, ...withoutCount } = patchTeam();

    expect(pathsRefused(FLPatchTeamResponseSchema, withoutCount)).toStrictEqual(["fanned_out_to_saison_teams"]);
  });
});

describe("FLReplaceSaisonTeamResponseSchema", () => {
  it("takes a row handed over with its fixtures, carrying the identity reseeded from the incoming club", () => {
    expect(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement())).toStrictEqual([]);
  });

  it("holds the reseeded identity to the same bounds a junction row's own copy is held to", () => {
    expect(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement({ name: "" }))).toStrictEqual(["name"]);
  });

  it("refuses a negative fan-out, a figure no `modified_count` can report", () => {
    expect(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement({ fanned_out_to_spiele: -1 }))).toStrictEqual(["fanned_out_to_spiele"]);
  });

  it("requires the fan-out, so it cannot be read as zero when the endpoint never sent it", () => {
    const { fanned_out_to_spiele: _count, ...withoutCount } = replacement();

    expect(pathsRefused(FLReplaceSaisonTeamResponseSchema, withoutCount)).toStrictEqual(["fanned_out_to_spiele"]);
  });

  /* Its own required figure: a squad austragen that reported nothing would read as zero, and the
     save message would tell an admin no player was touched while eleven were. */
  it("requires the ausgetragen squad count, which is not derivable from the fixture fan-out", () => {
    const { ausgetragene_squad_rows: _ausgetragen, ...withoutCount } = replacement();

    expect(pathsRefused(FLReplaceSaisonTeamResponseSchema, withoutCount)).toStrictEqual(["ausgetragene_squad_rows"]);
    expect(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement({ ausgetragene_squad_rows: -1 }))).toStrictEqual([
      "ausgetragene_squad_rows",
    ]);
  });

  /* A replacement always clears the austritt, so the response states none. Parsed away rather than
     refused, which is what stops a caller reading a field the endpoint never decided. */
  it("drops an austritt an over-eager caller reads for, rather than carrying one", () => {
    const parsed = FLReplaceSaisonTeamResponseSchema.parse(replacement({ austritt: { type: "rueckzug", grund: "x", datum: "2026-03-12" } }));

    expect("austritt" in parsed).toBe(false);
  });
});

const kontaktpersonPayload = (overrides: Record<string, unknown> = {}) => ({
  vorname: "Erika",
  nachname: "Mustermann",
  email: "erika@beispiel.de",
  telefon: "069 1234567",
  einwilligung: { umfang: "kontaktdaten", text_version: "2025-08", datum: "2025-09-01" },
  ...overrides,
});

const kontaktePayload = (overrides: Record<string, unknown> = {}) => ({
  trainer: kontaktpersonPayload(),
  // Each seat its own person: two seats sharing an address or a number are refused as one person twice.
  ansprechperson: kontaktpersonPayload({ vorname: "Max", email: "max@beispiel.de", telefon: "069 7654321" }),
  stellvertretung: kontaktpersonPayload({ vorname: "Lena", email: "lena@beispiel.de", telefon: "069 2345678" }),
  trainer_ist_zugleich: null,
  ...overrides,
});

describe("FLSaisonTeamKontaktePayloadSchema", () => {
  /* Required here, an admin could not save ANY edit to a row an erasure emptied -- not the group,
     not a typo in one of the two people beside it -- without re-entering the person who asked to be
     forgotten, which is the collection the erasure destroyed. */
  it("takes an empty seat, so a row one erasure emptied stays editable", () => {
    expect(pathsRefused(FLSaisonTeamKontaktePayloadSchema, kontaktePayload({ trainer: null }))).toStrictEqual([]);
  });

  /* The block's own guarantee moved to the form, which mounts a seat's boxes only while somebody is
     recorded in it and makes every one of them required. */
  it("still refuses a seat half filled in, field by field", () => {
    expect(pathsRefused(FLSaisonTeamKontaktePayloadSchema, kontaktePayload({ trainer: kontaktpersonPayload({ email: "" }) }))).toStrictEqual([
      "trainer.email",
    ]);
  });

  it("refuses a seat that is neither a whole person nor empty", () => {
    expect(pathsRefused(FLSaisonTeamKontaktePayloadSchema, kontaktePayload({ trainer: "Erika Mustermann" }))).toStrictEqual(["trainer"]);
  });

  /* The API stores an umlaut domain as its punycode and refuses an umlaut before the at sign, so the
     one seat saves here and the other is marked at its box rather than failing the save whole. */
  it("takes a seat whose address carries an umlaut domain, and marks one with an umlaut before the at sign", () => {
    const withAddress = (email: string) => kontaktePayload({ trainer: kontaktpersonPayload({ email }) });

    expect(pathsRefused(FLSaisonTeamKontaktePayloadSchema, withAddress("kaethe@käthe-schule.example"))).toStrictEqual([]);
    expect(pathsRefused(FLSaisonTeamKontaktePayloadSchema, withAddress("käthe@beispiel.de"))).toStrictEqual(["trainer.email"]);
  });

  /* The API answers a hyphen-final label with a REQ-VAL-001 that marks the box with a generic
     sentence, which never tells the admin what to change. */
  it("refuses a seat whose address the API would refuse", () => {
    expect(
      pathsRefused(FLSaisonTeamKontaktePayloadSchema, kontaktePayload({ trainer: kontaktpersonPayload({ email: "erika@ab-.de" }) })),
    ).toStrictEqual(["trainer.email"]);
  });

  /* The application's two rules, which the API applies to this block too: refused there they arrive as
     a 422 naming the block, so they are judged here, each on the box of the later seat. */
  it("refuses two seats sharing an address or a number, on the later seat's box", () => {
    expect(
      pathsRefused(
        FLSaisonTeamKontaktePayloadSchema,
        kontaktePayload({ stellvertretung: kontaktpersonPayload({ vorname: "Lena", email: "MAX@beispiel.de", telefon: "069 2345678" }) }),
      ),
    ).toStrictEqual(["stellvertretung.email"]);
    expect(
      pathsRefused(FLSaisonTeamKontaktePayloadSchema, kontaktePayload({ trainer: kontaktpersonPayload({ telefon: "+49 69 7654321" }) })),
    ).toStrictEqual(["trainer.telefon"]);
  });

  /* An empty seat holds nobody to compare, so a row an erasure emptied never fails on the person gone. */
  it("compares no seat an erasure emptied", () => {
    expect(pathsRefused(FLSaisonTeamKontaktePayloadSchema, kontaktePayload({ ansprechperson: null, stellvertretung: null }))).toStrictEqual([]);
  });

  /* The paired Trainer IS the named seat's person: sharing everything is the point, and a difference is a drift. */
  it("compares a paired Trainer as one person with the seat it holds", () => {
    const max = kontaktpersonPayload({ vorname: "Max", email: "max@beispiel.de", telefon: "069 7654321" });

    expect(
      pathsRefused(FLSaisonTeamKontaktePayloadSchema, kontaktePayload({ trainer: max, trainer_ist_zugleich: "ansprechperson" })),
    ).toStrictEqual([]);
    expect(
      pathsRefused(
        FLSaisonTeamKontaktePayloadSchema,
        kontaktePayload({ trainer: { ...max, vorname: "Maximilian" }, trainer_ist_zugleich: "ansprechperson" }),
      ),
    ).toStrictEqual(["ansprechperson.vorname"]);
  });
});

describe("a club's website", () => {
  const club = (website_url: string | null) => ({
    id: "0123456789abcdef01234567",
    name: "SC Riederwald",
    shorthand: "RWS",
    description: "",
    full_name: "Sportclub Riederwald 1927",
    website_url: website_url,
    address: { strasse: "Hanauer Landstraße", hausnummer: "12a", plz: "60314", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
    schulform: null,
    inactive_since: null,
  });

  const payload = (website_url: string | null) => {
    const { id: _id, inactive_since: _inactive, ...rest } = club(website_url);

    return rest;
  };

  /* The baseline, so each case below fails for the field it changed. */
  it("takes a club that has one, on the way in and on the way out", () => {
    expect(pathsRefused(FLTeamRecordSchema, club("https://example.org"))).toStrictEqual([]);
    expect(pathsRefused(FLPostTeamPayloadSchema, payload("https://example.org"))).toStrictEqual([]);
  });

  /* `null` is what the API publishes as the absent case, and the only spelling this product writes. */
  it("takes a club that has none", () => {
    expect(pathsRefused(FLTeamRecordSchema, club(null))).toStrictEqual([]);
    expect(pathsRefused(FLPostTeamPayloadSchema, payload(null))).toStrictEqual([]);
  });

  /* One spelling of absence, so no reader downstream tests for two. The API coerces an empty box to
     null before storing it, and `toWebsiteUrl` is what keeps this side from composing one. */
  it("refuses the empty string, which is the other spelling nothing produces", () => {
    expect(pathsRefused(FLTeamRecordSchema, club(""))).toStrictEqual(["website_url"]);
    expect(pathsRefused(FLPostTeamPayloadSchema, payload(""))).toStrictEqual(["website_url"]);
  });

  /* Optional is not unchecked: the value is rendered straight into an href on a public page, and
     `javascript:` parses as a URL. */
  it("still refuses an address that is neither empty nor a http(s) address", () => {
    expect(pathsRefused(FLTeamRecordSchema, club("javascript:alert(1)"))).toStrictEqual(["website_url"]);
    expect(pathsRefused(FLPostTeamPayloadSchema, payload("javascript:alert(1)"))).toStrictEqual(["website_url"]);
  });

  /* Optional is not unchecked on the READ side either: the value is rendered straight into an href
     on a public page, so a stored address that is not one may not reach it. */
  it("holds a stated address to the same rule on the way out as on the way in", () => {
    expect(OptionalExternalUrlSchema.safeParse(null).success).toBe(true);
    expect(OptionalExternalUrlSchema.safeParse("https://example.org").success).toBe(true);
    expect(OptionalExternalUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(OptionalExternalUrlSchema.safeParse("").success).toBe(false);
  });

  /* The key is required whatever its value: an omitted one is a payload the API cannot read. */
  it("still refuses the field being left out altogether", () => {
    const { website_url: _absent, ...ohne } = payload(null);

    expect(pathsRefused(FLPostTeamPayloadSchema, ohne)).toStrictEqual(["website_url"]);
  });
});

const postTeam = (overrides: Record<string, unknown> = {}) => ({
  name: "SC Riederwald",
  shorthand: "RWS",
  description: "",
  full_name: "Sportclub Riederwald 1927",
  website_url: "https://example.org",
  address: { strasse: "Hanauer Landstraße", hausnummer: "12a", plz: "60314", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
  schulform: null,
  ...overrides,
});

const junctionPayload = (overrides: Record<string, unknown> = {}) => ({
  team_id: "0123456789abcdef01234567",
  saison_id: "2026",
  gruppe: "A",
  austritt: { type: "rueckzug", grund: "Kein Kader", datum: "2026-03-12" },
  trikot_farbe: null,
  ...overrides,
});

/* Every field the API strips before its floor counts. An untrimmed mirror takes a value of spaces
   alone, which the endpoint then refuses with a `REQ-VAL-001` marking the box without the floor's German. */
describe("the write payloads' floors, against the stripped floors at the API", () => {
  const SPACES = "   ";

  it("refuses a club name, full name or Kürzel of spaces alone", () => {
    expect(pathsRefused(FLPostTeamPayloadSchema, postTeam({ name: SPACES }))).toStrictEqual(["name"]);
    expect(pathsRefused(FLPostTeamPayloadSchema, postTeam({ full_name: SPACES }))).toStrictEqual(["full_name"]);
    // A Kürzel of spaces alone satisfies an untrimmed width exactly, which is the arm a floor alone would miss.
    expect(pathsRefused(FLPostTeamPayloadSchema, postTeam({ shorthand: "   " }))).toStrictEqual(["shorthand"]);
  });

  it("takes a padded Kürzel and sends the three letters it holds", () => {
    expect(FLPostTeamPayloadSchema.parse(postTeam({ shorthand: " RWS " })).shorthand).toBe("RWS");
  });

  it("carries the embedded address's own floors, which the club payload does not restate", () => {
    const address = { ...postTeam().address, strasse: SPACES };

    expect(pathsRefused(FLPostTeamPayloadSchema, postTeam({ address }))).toStrictEqual(["address.strasse"]);
  });

  it("refuses a Kenntnisnahme whose Fassung is spaces alone, which cites no wording at all", () => {
    const kenntnisnahme = { umfang: "kontaktdaten", text_version: SPACES, datum: "2025-09-01" };

    expect(pathsRefused(FLKontaktKenntnisnahmePayloadSchema, kenntnisnahme)).toStrictEqual(["text_version"]);
  });

  it("refuses an austritt whose published reason is spaces alone", () => {
    const austritt = { ...junctionPayload().austritt, grund: SPACES };

    expect(pathsRefused(FLPatchSaisonTeamPayloadSchema, junctionPayload({ austritt }))).toStrictEqual(["austritt.grund"]);
  });

  /* The half the private payload schema exists for: put the trim on `FLAustrittSchema` instead and a
     club whose stored reason is blank fails the list it appears in. */
  it("leaves the read schema taking a stored reason of spaces alone", () => {
    expect(FLAustrittSchema.safeParse({ type: "rueckzug", grund: SPACES, datum: "2026-03-12" }).success).toBe(true);
  });
});

describe("a club's two names, against the single-line class the application's refuse", () => {
  // The two the create form and the editor validate, each spelled with what its payload adds.
  const FORMS = [
    ["the create form", FLCreateTeamFormPayloadSchema, { saison_id: "2026", gruppe: "A" }],
    ["the editor", FLPatchTeamPayloadSchema, { id: "0123456789abcdef01234567" }],
  ] as const;
  const MESSAGES = {
    name: "Der Name darf keine Zeilenumbrüche oder Steuerzeichen enthalten.",
    full_name: "Der vollständige Name darf keine Zeilenumbrüche oder Steuerzeichen enthalten.",
  } as const;

  /* By codepoint, so this file carries no invisible byte: the next line `trim` keeps, and the line
     separator that breaks a rendered name. */
  for (const [was, character] of [
    ["a next line", String.fromCodePoint(0x85)],
    ["a line separator", String.fromCodePoint(0x2028)],
  ] as const) {
    for (const [form, schema, extra] of FORMS) {
      for (const field of ["name", "full_name"] as const) {
        it(`refuses ${field} broken by ${was} in ${form}, with the field's own message`, () => {
          const result = schema.safeParse({ ...postTeam({ [field]: `Carl${character}Schurz` }), ...extra });

          expect(result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
            [field, MESSAGES[field]],
          ]);
        });
      }
    }
  }

  it("takes both names unbroken in either form", () => {
    for (const [, schema, extra] of FORMS) {
      expect(schema.safeParse({ ...postTeam({ name: "Carl Schurz", full_name: "Carl-Schurz-Schule" }), ...extra }).success).toBe(true);
    }
  });
});

/* Composed by the backend's own writers and serialised by its read model: an administrator reseats the
   person, who answers the seat's own page with WhatsApp and media granted. */
const SERVED_KENNTNISNAHME = {
  umfang: "kontaktdaten_whatsapp",
  text_version: "2026-10-bestaetigungsseite-verwaltung",
  datum: "2026-10-02",
  bestaetigt_am: "2026-10-02",
  medien: true,
  eingetragen_von: "liga",
  nachweis: {
    umfang: { am: "2026-10-02T18:03:57+00:00", text_version: "2026-10-bestaetigungsseite-verwaltung", erteilt_zuvor: null },
    medien: { am: "2026-10-02T18:03:57+00:00", text_version: "2026-10-bestaetigungsseite-verwaltung", erteilt_zuvor: null },
  },
};

describe("a contact seat's record whose evidence is filled, as a read serves it", () => {
  // Equal rather than merely parsed, for the reason `fl_frontend/src/features/spieler/schemas.test.ts` gives.
  it("keeps who seated the person and each choice's act", () => {
    expect(FLKontaktKenntnisnahmeSchema.parse(SERVED_KENNTNISNAHME)).toStrictEqual(SERVED_KENNTNISNAHME);
  });

  it("keeps both choices' stand a read serves as the press's precondition", () => {
    const stand = { umfang: null, medien: "9f2c1e7a4b5d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071" };

    expect(FLEinwilligungStandSchema.parse(stand)).toStrictEqual(stand);
  });
});
