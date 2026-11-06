import { answerSettled, refusalCodes, refused } from "@/test-support/refusals.ts";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { parseDate } from "@internationalized/date";
import { assert, describe, expect, it } from "vitest";

import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings.ts";
import { FELD_ABGELEHNT } from "@/shared/utils/actionError";
import { getGermanTodayStr } from "@/shared/utils/date";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { alterAusserhalb, BEWERBUNG_MAX_ALTER, BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "./constants.ts";
import { buildEinwilligungAntwortPayloadSchema } from "./schemas.ts";
import {
  bewerbungHerkunft,
  bewerbungTeamName,
  buildBewerbungRows,
  describeAufnahme,
  geburtsdatumSpanne,
  mapEinwilligungAnsichtRefusal,
  mapEinwilligungRefusal,
} from "./utils.ts";

import type { FLBewerbung } from "@/core/generated/client/types.ts";
import type { EinwilligungAnsicht } from "./types.ts";

/** The proposed school, of which only `team_name` decides the answer. */
const SCHOOL: FLBewerbung["schule"] = {
  team_name: "Ernst-Reuter",
  full_name: "Ernst-Reuter-Schule",
  schulform: "gesamtschule",
  address: { strasse: "Hammarskjöldring", hausnummer: "17a", plz: "60439", stadtteil: "Nordweststadt", stadt: "Frankfurt" },
  website_url: "https://ernst-reuter-schule.de",
};

const TEAMS = [
  { id: "6890a1b2c3d4e5f607190001", name: "Helmholtz" },
  { id: "6890a1b2c3d4e5f607190002", name: "Goethe" },
];

describe("what an acceptance reports", () => {
  /* Both arms, because a message spliced from a shared prefix renders only on one of them and
     nothing else in the app puts the sentence together. */
  it("reads as a whole sentence where the club was created", () => {
    expect(describeAufnahme({ createdTeam: true, gruppe: "A", saisonId: "2627" })).toBe(
      "Das Team wurde angelegt und in Gruppe A der Saison 2627 aufgenommen.",
    );
  });

  it("reads as a whole sentence where the club already stood", () => {
    expect(describeAufnahme({ createdTeam: false, gruppe: "B", saisonId: "2627" })).toBe(
      "Das Team wurde in Gruppe B der Saison 2627 aufgenommen.",
    );
  });

  /* One verb per arm, so neither can be produced by pasting a prefix onto a shared tail. */
  it("does not leave a verb stranded on either arm", () => {
    for (const createdTeam of [true, false]) {
      const sentence = describeAufnahme({ createdTeam, gruppe: "A", saisonId: "2627" });

      expect(sentence, "the report splices a state onto a past-tense tail").not.toMatch(/steht in .* aufgenommen/);
      expect(sentence, "the report is not one whole sentence").toMatch(/^Das Team wurde .* aufgenommen\.$/);
    }
  });
});

describe("the club an application names", () => {
  it("takes a proposed school's own name before any club list", () => {
    const named = bewerbungTeamName({ schule: SCHOOL, team_id: null }, TEAMS);

    expect(named).toBe("Ernst-Reuter");
  });

  it("resolves a picked club through the list", () => {
    expect(bewerbungTeamName({ schule: null, team_id: "6890a1b2c3d4e5f607190002" }, TEAMS)).toBe("Goethe");
  });

  /* The row `bewerbung_subject_unresolved` refuses, and the row a decline still has to address: nobody may
     guess a name for a message that goes out over the league's own address. */
  it("names nobody where the application names neither, and where the club is gone", () => {
    expect(bewerbungTeamName({ schule: null, team_id: null }, TEAMS)).toBe(null);
    expect(bewerbungTeamName({ schule: null, team_id: "6890a1b2c3d4e5f607190009" }, TEAMS)).toBe(null);
  });
});

describe("which of the two an application asks the league to enter", () => {
  it("is a new school where it proposes one", () => {
    expect(bewerbungHerkunft({ schule: SCHOOL, team_id: null })).toBe("neue_schule");
  });

  it("is an existing club where it picked one", () => {
    expect(bewerbungHerkunft({ schule: null, team_id: "6890a1b2c3d4e5f607190002" })).toBe("bestehendes_team");
  });

  /* An acceptance writes the created club's id back beside the school, so a decided new school carries
     both; asking the id first files it as a club that was already in the league. */
  it("stays a new school once the acceptance has named the club it created", () => {
    expect(bewerbungHerkunft({ schule: SCHOOL, team_id: "6890a1b2c3d4e5f607190002" })).toBe("neue_schule");
  });

  /* The row `bewerbung_subject_unresolved` refuses. Any answer but none here is a badge, a filter option and a
     panel title each claiming a club or a school the application never named. */
  it("is neither where the application names neither", () => {
    expect(bewerbungHerkunft({ schule: null, team_id: null })).toBe(null);
  });
});

/** One application, of which only `saison_id` decides anything below. */
function bewerbung(id: string, saisonId: string): FLBewerbung {
  return {
    id,
    version: 0,
    saison_id: saisonId,
    submitted_at: "2026-05-01",
    status: "submitted",
    team_id: null,
    schule: SCHOOL,
    kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_is_also: null },
    trikot: { existing_satz: "12 rote Trikots", wunschfarbe: "rot" },
    kader: { expected_size: 14, good_spieler: 3 },
    stufengroesse: 96,
    wunschgegner: null,
    decision: null,
    confirmations: { trainer: null, ansprechperson: null, stellvertretung: null },
  };
}

const ACROSS_SAISONS = [bewerbung("6890a1b2c3d4e5f607190011", "2627"), bewerbung("6890a1b2c3d4e5f607190012", "2526")];

describe("which season a row belongs to", () => {
  /* The flag the season facet reads. Answered here rather than in the facet, which sees one row and
     never the season the header holds. */
  it("marks only the applications for the selected season", () => {
    const rows = buildBewerbungRows(ACROSS_SAISONS, TEAMS, "2627");

    expect(rows.map((row) => row.inSelectedSaison)).toStrictEqual([true, false]);
  });

  /* No active season and none named leaves the selector holding nothing, and a row claiming to be in
     that season would open the list on an answer nobody asked for. */
  it("marks none where no season is selected", () => {
    const rows = buildBewerbungRows(ACROSS_SAISONS, TEAMS, undefined);

    assert.ok(rows.every((row) => !row.inSelectedSaison));
  });

  it("keeps every application, the season being a facet rather than a cut", () => {
    expect(buildBewerbungRows(ACROSS_SAISONS, TEAMS, "2627").length).toBe(ACROSS_SAISONS.length);
  });
});

describe("the birthdate window a contact person's date has to fall in", () => {
  /* The endpoint's own rule restated rather than its result quoted, so both bounds are judged
     against what it accepts: whole years, a birthday not yet reached this year not having happened
     (`fl_backend/app/shared/age.py :: whole_years_between`). */
  function wholeYears(geboren: string, today2: string): number {
    const [gJahr = 0, gMonat = 0, gTag = 0] = geboren.split("-").map(Number);
    const [hJahr = 0, hMonat = 0, hTag = 0] = today2.split("-").map(Number);

    return hJahr - gJahr - (hMonat < gMonat || (hMonat === gMonat && hTag < gTag) ? 1 : 0);
  }

  const nextDay = (tag: string): string => parseDate(tag).add({ days: 1 }).toString();
  const previousDay = (tag: string): string => parseDate(tag).subtract({ days: 1 }).toString();

  /* Bounds and not an age: the picker needs a `minValue` and a `maxValue`, the schema needs a string
     comparison, and one derivation serving both is what stops the two drifting apart. */
  it("spans both bounds off today, and both ends are inclusive", () => {
    expect(geburtsdatumSpanne("2026-08-29", BEWERBUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1905-08-30", spaeteste: "2010-08-29" });
  });

  /* The floor moves with the seat while the ceiling does not, so a derivation that read a constant
     for either would offer one seat a date the endpoint then refuses. */
  it("moves the floor's end with the seat and leaves the ceiling's where it is", () => {
    expect(geburtsdatumSpanne("2026-08-29", VERTRETUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1905-08-30", spaeteste: "2008-08-29" });
  });

  /* A 29 February has no counterpart in a year that is not a leap year, 1903 and 2100 among them, so
     an arithmetic that kept the day would hand the picker a date its own parse refuses. */
  it("clamps a leap day onto the end of February where the target year has none", () => {
    expect(geburtsdatumSpanne("2024-02-29", BEWERBUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1903-03-01", spaeteste: "2008-02-29" });
    expect(geburtsdatumSpanne("2116-02-29", BEWERBUNG_MIN_ALTER).spaeteste).toBe("2100-02-28");
  });

  /* Both tiers refuse the same set. A band the page turns away and the endpoint accepts is a
     contact person told to correct a date that was right. */
  it("ends both bounds exactly where the endpoint's whole-year count does, at either floor", () => {
    for (const mindestalter of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      for (const today2 of ["2026-09-04", "2024-02-29", "2027-03-01", "2116-02-29"]) {
        const { frueheste, spaeteste } = geburtsdatumSpanne(today2, mindestalter);
        const wo = `${today2} at ${String(mindestalter)}`;

        expect(wholeYears(frueheste, today2), `${wo}: the earliest date offered is not the oldest accepted`).toBe(BEWERBUNG_MAX_ALTER);
        expect(wholeYears(previousDay(frueheste), today2), `${wo}: the day before it is accepted too`).toBe(BEWERBUNG_MAX_ALTER + 1);
        expect(wholeYears(spaeteste, today2), `${wo}: the latest date offered is not the youngest accepted`).toBe(mindestalter);
        expect(wholeYears(nextDay(spaeteste), today2), `${wo}: the day after it is accepted too`).toBe(mindestalter - 1);
      }
    }
  });

  /* The offer's other half, which the picker cannot show: the SCHEMA takes the latest date the
     control offers and refuses the day after it. On a module constant it does neither at eighteen. */
  it("accepts the latest date the control offers and refuses the day after it, at either floor", () => {
    for (const mindestalter of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      const { spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);
      const schema = buildEinwilligungAntwortPayloadSchema(mindestalter);
      const antwort = { token: "kein-echtes-token", answer: "given", whatsapp: false, media: false, text_versions: SEAT_TEXT_VERSIONS };

      expect(schema.safeParse({ ...antwort, birth_date: spaeteste }).success, `${String(mindestalter)}: the offer is refused`).toBe(true);
      expect(
        schema.safeParse({ ...antwort, birth_date: nextDay(spaeteste) }).success,
        `${String(mindestalter)}: a day younger than the offer is accepted`,
      ).toBe(false);
    }
  });
});

const offenBei = (mindestalter: number) => async (): Promise<EinwilligungAnsicht> => ({
  zustand: "valid",
  ansicht: {
    state: "valid",
    quelle: "bewerbung",
    row: null,
    saison_id: "2026",
    schule: "Ernst-Reuter",
    rolle: "ansprechperson",
    also_rolle: null,
    minimum_age: mindestalter,
    maximum_age: 99,
    deadline: "2026-05-15",
    answered_on: null,
    media_minimum_age: 18,
  },
});

describe("the confirmation's refusals against the codes its endpoint publishes", () => {
  /* A published code this maps nowhere reaches the contact person as a bare „Antwort nicht gespeichert“
     toast, which names neither the field to fix nor the panel that would explain the dead link. */
  it("maps every code the confirmation publishes", async () => {
    for (const code of refusalCodes(
      "link_invalid",
      "link_expired",
      "bewerbung_seat_already_answered",
      "confirmation_age",
      "link_barred",
      "media_age",
      "link_expired",
      "kontakt_saison_past",
    )) {
      const answered = await answerSettled(code, (error) => mapEinwilligungRefusal(error, offenBei(VERTRETUNG_MIN_ALTER)));
      expect(answered, `${code} reaches the contact person unmapped`).not.toBe(null);
    }
  });

  /* The link's own read answers every refusal alike: a spent link answers its state in a 200, so a
     refusal is a token nothing could place. */
  it("calls the link void on every refusal its read publishes", () => {
    for (const code of refusalCodes("link_invalid")) {
      expect(mapEinwilligungAnsichtRefusal(refused(code)), code).toBe("invalid");
    }
  });

  /* Three codes, one panel, each spending this person's link: a decided application, an application's
     passed deadline, and a season row's passed deadline, which no application's link meets and whose
     wording the view takes from the link's source. */
  it("gives each code its own answer, the spent links one panel", async () => {
    const answers = new Map<string, string>();
    for (const code of refusalCodes(
      "link_invalid",
      "link_expired",
      "bewerbung_seat_already_answered",
      "confirmation_age",
      "link_barred",
      "media_age",
      "link_expired",
      "kontakt_saison_past",
    )) {
      answers.set(code, JSON.stringify(await mapEinwilligungRefusal(refused(code), offenBei(VERTRETUNG_MIN_ALTER))));
    }

    // An answer the read cannot find claims no more than the refusal did: the panel naming nobody.
    expect(answers.get("bewerbung_seat_already_answered"), "an answer the view reads as open names a panel").toBe(answers.get("link_invalid"));
    answers.delete("bewerbung_seat_already_answered");
    expect(new Set(answers.values()).size, "two codes are answered with the same panel or sentence").toBe(answers.size);
  });

  /* One code covers a confirmation and a decline alike, so a state picked here tells a seat that
     declined in another window that it confirmed. Which way it went is the ansicht read's to say. */
  it("answers the already-answered link with the state its view reads, never a state of its own", async () => {
    const abgelehnt = async (): Promise<EinwilligungAnsicht> => ({ zustand: "declined", quelle: "bewerbung" });

    expect(await mapEinwilligungRefusal(refused("bewerbung_seat_already_answered"), abgelehnt)).toStrictEqual({
      zustand: "declined",
    });
  });

  /* The age refusal spends no token, so it has to land on the one field the page renders: a `zustand`
     here would replace a live form with a dead-link panel and lose the date the person typed. */
  it("answers the age refusal at the field, naming the floor it was given and never a state", async () => {
    for (const floor of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      const mappedRefusal = await mapEinwilligungRefusal(refused("confirmation_age"), offenBei(floor));
      const gesagt = mappedRefusal?.fieldErrors?.birth_date ?? "";

      expect(mappedRefusal?.zustand, "a refusal the token survives closed the form anyway").toBe(undefined);
      assert.ok(gesagt.includes(String(floor)), `the sentence does not name ${String(floor)}, which is the floor it was handed`);
    }
  });

  /* The floor-aware half, which the page states because it knows the seat: a sentence carrying one
     floor at both seats tells a refused Ansprechperson their date cleared the bar. */
  it("names the floor it was given, and the ceiling either way", () => {
    for (const floor of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      const gesagt = alterAusserhalb(floor);

      assert.ok(gesagt.includes(String(floor)), `the sentence for ${String(floor)} does not name it`);
      assert.ok(gesagt.includes(String(BEWERBUNG_MAX_ALTER)), "a mistyped century is answered with the floor alone");
    }
  });

  /* Naming no field, a drifted client, since every body rule the panel can break is mirrored: the
     answer names no box, nothing here knowing which one broke, and reopens the mail's link, the page
     having stripped its token. */
  it("answers a body refusal naming no field with the mail's link, pointing at no field", async () => {
    const mappedRefusal = await mapEinwilligungRefusal(refusedPayload([], "/bewerbungen"), offenBei(VERTRETUNG_MIN_ALTER));

    expect(mappedRefusal).toStrictEqual({ error: ANTWORT_NEU_OEFFNEN });
  });

  /* A body the API could not read at all is the same drifted client, and a retry sends the same bytes. */
  it("answers a body the API could not read with the mail's link", async () => {
    expect(await mapEinwilligungRefusal(refused("body_unreadable"), offenBei(VERTRETUNG_MIN_ALTER))).toStrictEqual({
      error: ANTWORT_NEU_OEFFNEN,
    });
  });

  it("puts a body refusal naming a field on that field's box, with the mail's link for a box the panel lacks", async () => {
    const mappedRefusal = await mapEinwilligungRefusal(
      refusedPayload([bodyField(["birth_date"], "date_from_datetime_parsing")], "/bewerbungen"),
      offenBei(VERTRETUNG_MIN_ALTER),
    );

    expect(mappedRefusal).toStrictEqual({ fieldErrors: { birth_date: FELD_ABGELEHNT }, unplacedError: ANTWORT_NEU_OEFFNEN });
  });
});

describe("mapEinwilligungAnsichtRefusal", () => {
  /* The read refuses an unknown token alone; a spent, declined or expired link answers its own
     `zustand` in a 200. Fail-closed, so a code nobody planned still renders the panel naming nobody. */
  it("reads every refusal as the panel that names nobody", () => {
    expect(mapEinwilligungAnsichtRefusal(refused("link_invalid"))).toBe("invalid");
    for (const status of [409, 404, 410]) {
      expect(mapEinwilligungAnsichtRefusal(refused("activate_saison_unfinished", status)), String(status)).toBe("invalid");
    }
  });

  /* A token past `CustomBewerbungToken`'s length, or malformed, never reaches a record, so the read
     is answered by the dead-link panel rather than by the state inviting a reload that cannot work. */
  it("reads a token the backend will not parse as a link nothing matches", () => {
    expect(mapEinwilligungAnsichtRefusal(refusedPayload([], "/bewerbungen"))).toBe("invalid");
  });

  /* A failed read is the page's own state: answering „ungueltig“ on a 500 would call a live link
     void on a day the backend was unreachable. */
  it("leaves anything that is not a refusal to the caller", () => {
    expect(mapEinwilligungAnsichtRefusal(refused(undefined, 500))).toBe(null);
    expect(mapEinwilligungAnsichtRefusal(new Error("socket hang up"))).toBe(null);
  });

  /* Neither judged the token: a route the API does not serve is met mid-deploy, and an unreadable body
     failed in the page's own encoding. The dead-link panel would send the visitor away from a live link. */
  it("leaves a routing refusal or an unreadable body to the caller, never the dead-link panel", () => {
    for (const [status, code] of [
      [404, "no_route"],
      [405, "method_not_served"],
    ] as const) {
      expect(mapEinwilligungAnsichtRefusal(refused(code, status)), code).toBe(null);
    }
    expect(mapEinwilligungAnsichtRefusal(refused("body_unreadable"))).toBe(null);
  });
});
