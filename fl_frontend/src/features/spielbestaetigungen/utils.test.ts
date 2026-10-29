import { readFileSync } from "node:fs";
import path from "node:path";

import { spielbestaetigungFields } from "@/test-support/fixtures.ts";
import { refusalCodes, refused } from "@/test-support/refusals.ts";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FELD_ABGELEHNT } from "@/shared/utils/actionError";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { FLSonderereignisSchema } from "../spiele/schemas.ts";
import { FLSpielbestaetigungGrundSchema, FLSpielbestaetigungSchema } from "./schemas.ts";
import { grundZumEnde, laufUeberfaellig, mapAnsetzungAnsichtRefusal, mapAnsetzungRefusal } from "./utils.ts";

import type { BestaetigungsSpiel } from "./utils.ts";

describe("mapAnsetzungAnsichtRefusal", () => {
  /* The read refuses an unknown token alone; a spent link answers its own `zustand` in a 200. Fail-closed,
     so a code nobody planned still renders the panel that names nothing of a fixture. */
  it("calls the link void on every refusal the read publishes, and on a rule's code nobody planned", () => {
    for (const code of refusalCodes("REQ-ANSETZUNG-001")) {
      expect(mapAnsetzungAnsichtRefusal(refused(code)), code).toBe("ungueltig");
    }
    expect(mapAnsetzungAnsichtRefusal(refused("REQ-SOMETHING-NEW", 409))).toBe("ungueltig");
  });

  /* A malformed or over-long token never reaches a row, and the page has already dropped it from the
     address bar: the state inviting a reload would open the dead link anyway. */
  it("calls a token the backend will not parse void rather than offering a reload", () => {
    expect(mapAnsetzungAnsichtRefusal(refused("REQ-VAL-001"))).toBe("ungueltig");
  });

  /* A failed read is the page's own state: the dead-link panel on a 500 would call a live link void on
     a day the backend was unreachable. */
  it("leaves anything that is not a refusal to the page's own state", () => {
    expect(mapAnsetzungAnsichtRefusal(refused("", 500))).toBe(null);
    expect(mapAnsetzungAnsichtRefusal(new Error("socket hang up"))).toBe(null);
  });

  /* None judged the token: a misconfigured base key refuses every link alike, an unserved route is met
     mid-deploy, and an unreadable body failed in the page's own encoding. The dead-link panel would
     call every live link void. */
  it("leaves the protocol's refusals to the page's own state, never the dead-link panel", () => {
    for (const code of ["REQ-AUTH-001", "REQ-AUTH-002", "REQ-VAL-002"]) {
      expect(mapAnsetzungAnsichtRefusal(refused(code)), code).toBe(null);
    }
    for (const [code, status] of [
      ["REQ-ROUTE-001", 404],
      ["REQ-ROUTE-002", 405],
    ] as const) {
      expect(mapAnsetzungAnsichtRefusal(refused(code, status)), code).toBe(null);
    }
  });
});

describe("mapAnsetzungRefusal on a body the API refused", () => {
  /* Only a drifted page sends one, and the page strips its token from the address bar: the shared
     reader's reload would land on the dead link, so only the mail's link reopens the form. */
  it("sends the club back to the mail's link", () => {
    for (const code of ["REQ-VAL-001", "REQ-VAL-002"]) {
      expect(mapAnsetzungRefusal(refused(code)), code).toStrictEqual({ error: ANTWORT_NEU_OEFFNEN });
    }
  });

  it("marks the box a refusal names, keyed as the input is named, with the mail's link beside it", () => {
    const refused = refusedPayload([bodyField(["vorschlag", "datum"], "date_from_datetime_parsing")], "/spielbestaetigungen");

    expect(mapAnsetzungRefusal(refused)).toStrictEqual({
      fieldErrors: { "vorschlag.datum": FELD_ABGELEHNT },
      unplacedError: ANTWORT_NEU_OEFFNEN,
    });
  });
});

describe("laufUeberfaellig", () => {
  const TODAY = "2026-10-20";
  /** Set in full five days out: a fixture the pass asks about. */
  const GEFRAGT: BestaetigungsSpiel = {
    id: "6890a1b2c3d4e5f607182930",
    datum: "2026-10-25",
    uhrzeit: "18:00:00",
    ort: { spielort_id: "6890a1b2c3d4e5f607182934" },
    team1: { team_id: "6890a1b2c3d4e5f607182932", tore: null },
    team2: { team_id: "6890a1b2c3d4e5f607182933", tore: null },
    ergebnis: null,
    elfmeterschiessen: null,
    sonderereignis: null,
    schiedsrichter: null,
  };
  const FAELLIG = {
    isSpielSweepOn: true,
    isActiveSaison: true,
    spiel: GEFRAGT,
    austritte: new Map<string, string>(),
    gelaufenAm: null,
    today: TODAY,
  };

  it("warns where a pass was due for the fixture and none ran, or none since the day before yesterday", () => {
    expect(laufUeberfaellig(FAELLIG)).toBe(true);
    expect(laufUeberfaellig({ ...FAELLIG, gelaufenAm: "2026-10-18" })).toBe(true);
  });

  // Yesterday's stamp is a healthy stack's: the hourly pass's last run may fall before midnight.
  it("reads today's stamp and yesterday's as plain", () => {
    expect(laufUeberfaellig({ ...FAELLIG, gelaufenAm: TODAY })).toBe(false);
    expect(laufUeberfaellig({ ...FAELLIG, gelaufenAm: "2026-10-19" })).toBe(false);
  });

  // The pass's last asking day is three weeks out; the shared table holds `wirdAngefragt` to the pass row by row.
  it("warns for a fixture as far out as the pass asks, and for none past it", () => {
    expect(laufUeberfaellig({ ...FAELLIG, spiel: { ...GEFRAGT, datum: "2026-11-10" } })).toBe(true);
    expect(laufUeberfaellig({ ...FAELLIG, spiel: { ...GEFRAGT, datum: "2026-11-11" } })).toBe(false);
  });

  // What a line guarded on the stamp alone gets wrong, and most of the fixtures the site holds.
  it("reads a fixture no pass visits as plain, whatever the stamp", () => {
    for (const nie of [
      { ...FAELLIG, isActiveSaison: false },
      { ...FAELLIG, isSpielSweepOn: false },
      { ...FAELLIG, spiel: { ...GEFRAGT, datum: TODAY } },
      { ...FAELLIG, spiel: { ...GEFRAGT, datum: "2026-10-01" } },
      { ...FAELLIG, spiel: { ...GEFRAGT, datum: null } },
      { ...FAELLIG, spiel: { ...GEFRAGT, ort: null } },
      { ...FAELLIG, spiel: { ...GEFRAGT, sonderereignis: "ausgefallen" as const } },
      { ...FAELLIG, austritte: new Map([[GEFRAGT.team2?.team_id ?? "", "2026-10-22"]]) },
    ]) {
      expect(laufUeberfaellig(nie), JSON.stringify({ ...nie, austritte: [...nie.austritte] })).toBe(false);
    }
  });
});

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/**
 * The rows both tiers run, each moving a row about a fixture set in full three days out. Strict, so a row moving
 * something this tier does not read fails rather than passing on the unmoved fixture.
 */
const GRUND_TO_END = z
  .array(
    z.strictObject({
      fall: z.string(),
      zeile: z.strictObject({ partei: z.literal("schiedsrichter").optional(), verworfen: z.literal(true).optional() }),
      anders: z.strictObject({
        tage: z.int().optional(),
        datum_tage: z.int().nullable().optional(),
        uhrzeit: z.string().optional(),
        spielort: z.literal("anderer").optional(),
        team2: z.literal("anderer").optional(),
        tore: z.int().optional(),
        elfmeterschiessen: z.strictObject({ team1: z.int(), team2: z.int() }).optional(),
        sonderereignis: FLSonderereignisSchema.optional(),
        schiedsrichter: z.literal("anderer").nullable().optional(),
        austritt_tage: z.int().optional(),
      }),
      grund: FLSpielbestaetigungGrundSchema.nullable(),
    }),
  )
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "grund_to_end.json"), "utf8")));

describe("grundZumEnde", () => {
  const HEUTE = "2026-04-01";
  const tagNach = (tage: number): string => new Date(Date.parse(HEUTE) + tage * 86_400_000).toISOString().slice(0, 10);
  const SEITEN = ["6890a1b2c3d4e5f607760001", "6890a1b2c3d4e5f607760002"] as const;
  const SCHIEDSRICHTER = ["6890a1b2c3d4e5f6077600c1", "6890a1b2c3d4e5f6077600c2"] as const;
  const SPIELORT = "6890a1b2c3d4e5f6077600b1";

  /* Read rather than retyped: the backend's `grund_to_end` answers the same rows in its own suite, so a closing reason
     one tier gains alone fails at the other. */
  for (const { fall, zeile, anders, grund } of GRUND_TO_END) {
    it(`ends a row where the pass does: ${fall}`, () => {
      const datum = tagNach(anders.tage ?? 3);
      const spiel: BestaetigungsSpiel = {
        id: "6890a1b2c3d4e5f607760010",
        datum: anders.datum_tage === undefined ? datum : anders.datum_tage === null ? null : tagNach(anders.datum_tage),
        uhrzeit: anders.uhrzeit ?? "18:00:00",
        ort: { spielort_id: anders.spielort === undefined ? SPIELORT : "6890a1b2c3d4e5f6077600b2" },
        team1: { team_id: SEITEN[0], tore: anders.tore ?? null },
        team2: { team_id: anders.team2 === undefined ? SEITEN[1] : "6890a1b2c3d4e5f607760003", tore: null },
        ergebnis: null,
        elfmeterschiessen: anders.elfmeterschiessen ?? null,
        sonderereignis: anders.sonderereignis ?? null,
        schiedsrichter:
          anders.schiedsrichter === undefined
            ? { schiedsrichter_id: SCHIEDSRICHTER[0] }
            : anders.schiedsrichter === null
              ? null
              : { schiedsrichter_id: SCHIEDSRICHTER[1] },
      };
      const row = FLSpielbestaetigungSchema.parse(
        spielbestaetigungFields({
          spiel_id: spiel.id,
          partei:
            zeile.partei === undefined ? { art: "team", team_id: SEITEN[0] } : { art: "schiedsrichter", schiedsrichter_id: SCHIEDSRICHTER[0] },
          ansetzung: { datum, uhrzeit: "18:00:00", spielort_id: SPIELORT, team1_id: SEITEN[0], team2_id: SEITEN[1], stand: "0".repeat(64) },
          geschlossen: zeile.verworfen === undefined ? null : { am: HEUTE, grund: "verworfen" },
        }),
      );
      const austritte = new Map(anders.austritt_tage === undefined ? [] : [[SEITEN[1], tagNach(anders.austritt_tage)]]);

      expect(grundZumEnde(row, spiel, { austritte, today: HEUTE })).toBe(grund);
    });
  }
});
