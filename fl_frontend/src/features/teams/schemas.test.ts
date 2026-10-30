import { describe, expect, it } from "vitest";

import { FLEinwilligungStandSchema } from "@/features/spieler/schemas";

import {
  FLCreateTeamFormPayloadSchema,
  FLKontaktKenntnisnahmePayloadSchema,
  FLKontaktKenntnisnahmeSchema,
  FLPatchSaisonTeamPayloadSchema,
  FLPatchTeamPayloadSchema,
  FLSaisonTeamKontaktePayloadSchema,
} from "./schemas";

/** The paths a payload schema refuses, so a case names the field it judges and nothing beside it. */
const pathsRefused = (
  schema:
    | typeof FLCreateTeamFormPayloadSchema
    | typeof FLKontaktKenntnisnahmePayloadSchema
    | typeof FLPatchSaisonTeamPayloadSchema
    | typeof FLSaisonTeamKontaktePayloadSchema,
  value: unknown,
): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

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
  const payload = (website_url: string | null) => ({
    name: "SC Riederwald",
    shorthand: "RWS",
    description: "",
    full_name: "Sportclub Riederwald 1927",
    website_url: website_url,
    address: { strasse: "Hanauer Landstraße", hausnummer: "12a", plz: "60314", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
    schulform: null,
    saison_id: "2026",
    gruppe: "A",
  });

  /* The baseline, so each case below fails for the field it changed. */
  it("takes a club that has one", () => {
    expect(pathsRefused(FLCreateTeamFormPayloadSchema, payload("https://example.org"))).toStrictEqual([]);
  });

  /* `null` is what the API publishes as the absent case, and the only spelling this product writes. */
  it("takes a club that has none", () => {
    expect(pathsRefused(FLCreateTeamFormPayloadSchema, payload(null))).toStrictEqual([]);
  });

  /* One spelling of absence, so no reader downstream tests for two. The API coerces an empty box to
     null before storing it, and `toWebsiteUrl` is what keeps this side from composing one. */
  it("refuses the empty string, which is the other spelling nothing produces", () => {
    expect(pathsRefused(FLCreateTeamFormPayloadSchema, payload(""))).toStrictEqual(["website_url"]);
  });

  /* Optional is not unchecked: the value is rendered straight into an href on a public page, and
     `javascript:` parses as a URL. */
  it("still refuses an address that is neither empty nor a http(s) address", () => {
    expect(pathsRefused(FLCreateTeamFormPayloadSchema, payload("javascript:alert(1)"))).toStrictEqual(["website_url"]);
  });

  /* The key is required whatever its value: an omitted one is a payload the API cannot read. */
  it("still refuses the field being left out altogether", () => {
    const { website_url: _absent, ...ohne } = payload(null);

    expect(pathsRefused(FLCreateTeamFormPayloadSchema, ohne)).toStrictEqual(["website_url"]);
  });
});

const createTeam = (overrides: Record<string, unknown> = {}) => ({
  name: "SC Riederwald",
  shorthand: "RWS",
  description: "",
  full_name: "Sportclub Riederwald 1927",
  website_url: "https://example.org",
  address: { strasse: "Hanauer Landstraße", hausnummer: "12a", plz: "60314", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
  schulform: null,
  saison_id: "2026",
  gruppe: "A",
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
    expect(pathsRefused(FLCreateTeamFormPayloadSchema, createTeam({ name: SPACES }))).toStrictEqual(["name"]);
    expect(pathsRefused(FLCreateTeamFormPayloadSchema, createTeam({ full_name: SPACES }))).toStrictEqual(["full_name"]);
    // A Kürzel of spaces alone satisfies an untrimmed width exactly, which is the arm a floor alone would miss.
    expect(pathsRefused(FLCreateTeamFormPayloadSchema, createTeam({ shorthand: "   " }))).toStrictEqual(["shorthand"]);
  });

  it("takes a padded Kürzel and sends the three letters it holds", () => {
    expect(FLCreateTeamFormPayloadSchema.parse(createTeam({ shorthand: " RWS " })).shorthand).toBe("RWS");
  });

  it("carries the embedded address's own floors, which the club payload does not restate", () => {
    const address = { ...createTeam().address, strasse: SPACES };

    expect(pathsRefused(FLCreateTeamFormPayloadSchema, createTeam({ address }))).toStrictEqual(["address.strasse"]);
  });

  it("refuses a Kenntnisnahme whose Fassung is spaces alone, which cites no wording at all", () => {
    const kenntnisnahme = { umfang: "kontaktdaten", text_version: SPACES, datum: "2025-09-01" };

    expect(pathsRefused(FLKontaktKenntnisnahmePayloadSchema, kenntnisnahme)).toStrictEqual(["text_version"]);
  });

  it("refuses an austritt whose published reason is spaces alone", () => {
    const austritt = { ...junctionPayload().austritt, grund: SPACES };

    expect(pathsRefused(FLPatchSaisonTeamPayloadSchema, junctionPayload({ austritt }))).toStrictEqual(["austritt.grund"]);
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
          const result = schema.safeParse({ ...createTeam({ [field]: `Carl${character}Schurz` }), ...extra });

          expect(result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
            [field, MESSAGES[field]],
          ]);
        });
      }
    }
  }

  it("takes both names unbroken in either form", () => {
    for (const [, schema, extra] of FORMS) {
      expect(schema.safeParse({ ...createTeam({ name: "Carl Schurz", full_name: "Carl-Schurz-Schule" }), ...extra }).success).toBe(true);
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
