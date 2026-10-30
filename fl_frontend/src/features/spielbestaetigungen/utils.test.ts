import { spielbestaetigungFields } from "@/test-support/fixtures.ts";
import { refusalCodes, refused } from "@/test-support/refusals.ts";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FLSpielbestaetigungGeschlossenGrund } from "@/core/generated/client/types.ts";
import { FELD_ABGELEHNT } from "@/shared/utils/actionError";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { FLSonderereignisSchema } from "../spiele/schemas.ts";
import { grundZumEnde, mapAnsetzungAnsichtRefusal, mapAnsetzungRefusal } from "./utils.ts";

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

/** Why the next pass shuts a row, one thing moved per row from a fixture it leaves standing. */
const GRUND_TO_END_ROWS: unknown = [
  {
    fall: "a club's open row about the fixture as it stands",
    zeile: {},
    anders: {},
    grund: null,
  },
  {
    fall: "the booked referee's open row",
    zeile: {
      partei: "schiedsrichter",
    },
    anders: {},
    grund: null,
  },
  {
    fall: "the referee's row once another is booked",
    zeile: {
      partei: "schiedsrichter",
    },
    anders: {
      schiedsrichter: "anderer",
    },
    grund: "schiedsrichter_gewechselt",
  },
  {
    fall: "the referee's row once the slot is emptied",
    zeile: {
      partei: "schiedsrichter",
    },
    anders: {
      schiedsrichter: null,
    },
    grund: "schiedsrichter_gewechselt",
  },
  {
    fall: "a club's row once another referee is booked",
    zeile: {},
    anders: {
      schiedsrichter: "anderer",
    },
    grund: null,
  },
  {
    fall: "a lone goal count",
    zeile: {},
    anders: {
      tore: 2,
    },
    grund: "spiel_entschieden",
  },
  {
    fall: "a lone shoot-out",
    zeile: {},
    anders: {
      elfmeterschiessen: {
        team1: 4,
        team2: 3,
      },
    },
    grund: "spiel_entschieden",
  },
  {
    fall: "a no-show entered before the day",
    zeile: {},
    anders: {
      sonderereignis: "nichtantreten_team1",
    },
    grund: "abgesagt",
  },
  {
    fall: "a no-show entered on the day",
    zeile: {},
    anders: {
      tage: 0,
      sonderereignis: "nichtantreten_team2",
    },
    grund: "spiel_entschieden",
  },
  {
    fall: "a no-show entered before the fixture's day as it stands, the row about a day gone by",
    zeile: {},
    anders: {
      tage: -1,
      datum_tage: 3,
      sonderereignis: "nichtantreten_team1",
    },
    grund: "abgesagt",
  },
  {
    fall: "abandoned",
    zeile: {},
    anders: {
      sonderereignis: "abgebrochen",
    },
    grund: "spiel_entschieden",
  },
  {
    fall: "called off",
    zeile: {},
    anders: {
      sonderereignis: "ausgefallen",
    },
    grund: "abgesagt",
  },
  {
    fall: "annulled",
    zeile: {},
    anders: {
      sonderereignis: "annulliert",
    },
    grund: "abgesagt",
  },
  {
    fall: "the second club gone before the day",
    zeile: {},
    anders: {
      austritt_tage: 1,
    },
    grund: "austritt",
  },
  {
    fall: "the second club gone on the day",
    zeile: {},
    anders: {
      austritt_tage: 3,
    },
    grund: "austritt",
  },
  {
    fall: "the second club gone after the day",
    zeile: {},
    anders: {
      austritt_tage: 4,
    },
    grund: null,
  },
  {
    fall: "moved a day on",
    zeile: {},
    anders: {
      datum_tage: 4,
    },
    grund: "ansetzung_geaendert",
  },
  {
    fall: "a new kick-off",
    zeile: {},
    anders: {
      uhrzeit: "19:00:00",
    },
    grund: "ansetzung_geaendert",
  },
  {
    fall: "a new ground",
    zeile: {},
    anders: {
      spielort: "anderer",
    },
    grund: "ansetzung_geaendert",
  },
  {
    fall: "the second side replaced",
    zeile: {},
    anders: {
      team2: "anderer",
    },
    grund: "ansetzung_geaendert",
  },
  {
    fall: "the date taken away",
    zeile: {},
    anders: {
      datum_tage: null,
    },
    grund: "ansetzung_geaendert",
  },
  {
    fall: "the date taken away from a club gone before the row's day",
    zeile: {},
    anders: {
      datum_tage: null,
      austritt_tage: 2,
    },
    grund: "austritt",
  },
  {
    fall: "the referee's row of a fixture called off and its referee swapped",
    zeile: {
      partei: "schiedsrichter",
    },
    anders: {
      sonderereignis: "ausgefallen",
      schiedsrichter: "anderer",
    },
    grund: "abgesagt",
  },
  {
    fall: "the referee's row of a fixture moved and its referee swapped",
    zeile: {
      partei: "schiedsrichter",
    },
    anders: {
      datum_tage: 4,
      schiedsrichter: "anderer",
    },
    grund: "schiedsrichter_gewechselt",
  },
  {
    fall: "a fixture on today",
    zeile: {},
    anders: {
      tage: 0,
    },
    grund: null,
  },
  {
    fall: "a fixture whose day went by unplayed",
    zeile: {},
    anders: {
      tage: -1,
    },
    grund: "spiel_vergangen",
  },
  {
    fall: "a row whose day went by, its fixture moved ahead",
    zeile: {},
    anders: {
      tage: -1,
      datum_tage: 3,
    },
    grund: "ansetzung_geaendert",
  },
  {
    fall: "a discard as the fixture stands",
    zeile: {
      verworfen: true,
    },
    anders: {},
    grund: null,
  },
  {
    fall: "a discard, the fixture moved",
    zeile: {
      verworfen: true,
    },
    anders: {
      datum_tage: 4,
    },
    grund: null,
  },
  {
    fall: "a discard, the fixture's referee swapped",
    zeile: {
      verworfen: true,
    },
    anders: {
      schiedsrichter: "anderer",
    },
    grund: null,
  },
  {
    fall: "a discard, the fixture called off",
    zeile: {
      verworfen: true,
    },
    anders: {
      sonderereignis: "ausgefallen",
    },
    grund: "abgesagt",
  },
  {
    fall: "a discard, the fixture decided",
    zeile: {
      verworfen: true,
    },
    anders: {
      tore: 2,
    },
    grund: "spiel_entschieden",
  },
  {
    fall: "a discard, the second club gone by the day",
    zeile: {
      verworfen: true,
    },
    anders: {
      austritt_tage: 1,
    },
    grund: "austritt",
  },
  {
    fall: "a discard whose day went by",
    zeile: {
      verworfen: true,
    },
    anders: {
      tage: -1,
    },
    grund: "spiel_vergangen",
  },
  {
    fall: "a discard whose day went by, its fixture moved ahead",
    zeile: {
      verworfen: true,
    },
    anders: {
      tage: -1,
      datum_tage: 3,
    },
    grund: "spiel_vergangen",
  },
];

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
      grund: z.enum(FLSpielbestaetigungGeschlossenGrund).nullable(),
    }),
  )
  .parse(GRUND_TO_END_ROWS);

describe("grundZumEnde", () => {
  const HEUTE = "2026-04-01";
  const tagNach = (tage: number): string => new Date(Date.parse(HEUTE) + tage * 86_400_000).toISOString().slice(0, 10);
  const SEITEN = ["6890a1b2c3d4e5f607760001", "6890a1b2c3d4e5f607760002"] as const;
  const SCHIEDSRICHTER = ["6890a1b2c3d4e5f6077600c1", "6890a1b2c3d4e5f6077600c2"] as const;
  const SPIELORT = "6890a1b2c3d4e5f6077600b1";

  /* The closing reasons of `fl_backend/app/api/spielbestaetigungen/services.py :: grund_to_end`, which this reader
     spells again for the page. */
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
      const row = spielbestaetigungFields({
        spiel_id: spiel.id,
        partei:
          zeile.partei === undefined ? { art: "team", team_id: SEITEN[0] } : { art: "schiedsrichter", schiedsrichter_id: SCHIEDSRICHTER[0] },
        ansetzung: { datum, uhrzeit: "18:00:00", spielort_id: SPIELORT, team1_id: SEITEN[0], team2_id: SEITEN[1], stand: "0".repeat(64) },
        geschlossen: zeile.verworfen === undefined ? null : { am: HEUTE, grund: "verworfen" },
      });
      const austritte = new Map(anders.austritt_tage === undefined ? [] : [[SEITEN[1], tagNach(anders.austritt_tage)]]);

      expect(grundZumEnde(row, spiel, { austritte, today: HEUTE })).toBe(grund);
    });
  }
});
