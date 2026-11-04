import { kenntnisnahme } from "@/test-support/kenntnisnahme.ts";
import { assert, describe, expect, it } from "vitest";

import { EINGETRAGEN_VON_OPTIONS, GRUPPEN_OPTIONS, KONTAKT_ROLLEN, TRIKOT_FARBE_OPTIONS } from "./constants.ts";
import { buildKontakteFacets, buildTeamFacets, KONTAKTE_BESETZUNG_OPTIONS, kontakteBesetzung, TEAM_FACETS } from "./facets.ts";
import { FLTrikotFarbeSchema } from "./schemas.ts";
// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { buildKontaktRows, describeReplacementUmfang, holdsNobody, isRetireable, offeredTrikotFarben, toWebsiteUrl } from "./utils.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte, FLTeamWithMemberships } from "@/core/generated/client/types.ts";

const TEAM_ID = (seed: number) => `6890a1b2c3d4e5f6071900${String(seed).padStart(2, "0")}`;

const umfang = (fannedOutToSpiele: number, ausgetrageneSquadRows: number) =>
  describeReplacementUmfang({ fannedOutToSpiele, ausgetrageneSquadRows });

describe("describeReplacementUmfang", () => {
  it("reports the fixtures with their own zero and their own singular", () => {
    expect(umfang(0, 0)).toMatch(/^Für das ausscheidende Team war noch kein Spiel angesetzt\./);
    expect(umfang(1, 0)).toMatch(/^Ein angesetztes Spiel wurde übernommen\./);
    expect(umfang(7, 0)).toMatch(/^7 angesetzte Spiele wurden übernommen\./);
  });

  it("reports the squad rows with their own singular", () => {
    expect(umfang(0, 1)).toMatch(/Ein Kadereintrag des ausscheidenden Teams wurde ausgetragen\./);
    expect(umfang(0, 4)).toMatch(/4 Kadereinträge des ausscheidenden Teams wurden ausgetragen\./);
  });

  /* `ausgetragene_squad_rows` counts the LIVE rows this write stamped, so zero is a fact about the squad
     at that moment and never about the club's history: one whose players were all ausgetragen first
     reports zero too. */
  it("says the squad stood empty at zero, never that the club had no players", () => {
    expect(umfang(0, 0)).toMatch(/Im Kader des ausscheidenden Teams stand kein Spieler\./);
    expect(umfang(0, 0)).not.toMatch(/hatte das ausscheidende Team keine/);
  });

  /* `stillgelegt` would report these pupils out of every pick list there is, the endpoint stamping
     `saison_spieler` and touching no `spieler` document. */
  it("never calls a squad row's retirement a Stilllegung", () => {
    for (const report of [umfang(0, 0), umfang(2, 1), umfang(2, 9)]) {
      expect(report, "the report retires the people rather than their squad entries").not.toMatch(/stillgelegt|Stilllegen/);
      expect(report, "the report writes about people where the write moved entries").not.toMatch(/Spieler wurde/);
    }
  });

  /* The repair is a reassignment, never the outgoing club's return: `kader_team_not_in_saison` judges the row's
     `team_id` on the PATCH as well, so no season status stands between the row and its squad. */
  it("names the reassignment as the repair, and names it only where it retired a row", () => {
    for (const report of [umfang(0, 1), umfang(3, 9)]) {
      expect(report).toMatch(/Um einen solchen Eintrag zu reaktivieren/);
      expect(report).toMatch(/Bereich „Kader“ einem Team dieser Saison zu/);
      expect(report, "the report names a repair the rule does not ask for").not.toMatch(/geplante Saison|wieder in dieser Saison steht/);
    }

    expect(umfang(3, 0), "nothing was retired and the report warns about it anyway").not.toMatch(/[Rr]eaktivieren/);
  });

  /* It lands in a toast with no figures beside it, so each half has to stand as a sentence. */
  it("writes whole sentences, with nothing left dangling", () => {
    for (const report of [umfang(0, 0), umfang(1, 1), umfang(12, 3)]) {
      expect(report, "the report opens lower-case").toMatch(/^[A-ZÄÖÜ0-9]/);
      expect(report, "the report does not end in a full stop").toMatch(/\.$/);
      expect(report, "the report leans on a word with no antecedent").not.toMatch(/dafür|diesen Platz/);
    }
  });
});

const SAISON = "2025-2026";

const kontaktperson = (vorname: string): FLKontaktperson => ({
  vorname,
  nachname: "Mustermann",
  email: `${vorname.toLowerCase()}@beispiel.de`,
  telefon: "069 1234567",
  geburtsdatum: "1990-01-01",
  einwilligung: kenntnisnahme({ datum: "2025-09-01", confirmed_at: "2025-09-02" }),
});

const club = (kontakte: FLSaisonTeamKontakte | null): FLTeamWithMemberships => ({
  id: TEAM_ID(1),
  name: "Helmholtz",
  shorthand: "HH",
  description: "Eine Schule.",
  full_name: "Helmholtzschule Frankfurt am Main",
  website_url: "https://www.helmholtzschule.de",
  address: { strasse: "Habsburgerallee", hausnummer: "57", plz: "60385", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
  schulform: "gymnasium_g9",
  inactive_since: null,
  memberships: [
    {
      saison_id: SAISON,
      gruppe: "A",
      austritt: null,
      trikot_farbe: null,
      kontakte,
      confirmations: null,
      address_change: null,
      kontakte_stand: "9f2c",
      version: 0,
    },
  ],
  version: 0,
});

describe("buildKontaktRows", () => {
  /* ONE row per club, not three. `kontakte` is an embedded object on `saison_teams`: a seat carries
     no id, so a per-seat row has to invent one and the list then orders by a key nothing owns. */
  it("gives a club one row carrying all three seats", () => {
    const rows = buildKontaktRows(
      [
        club({
          trainer: null,
          ansprechperson: kontaktperson("Erika"),
          stellvertretung: kontaktperson("Lena"),
          trainer_is_also: null,
        }),
      ],
      SAISON,
    );

    expect(rows.length, "the club contributes something other than one row").toBe(1);
    expect(rows[0]?.id, "the row is keyed by something other than the club it stands for").toBe(rows[0]?.teamId);
    expect(
      rows[0]?.seats.map((seat) => seat.rolle),
      "the seats are not the three the editor asks for, in its order",
    ).toStrictEqual(["ansprechperson", "stellvertretung", "trainer"]);
    // Null and not five empty strings: a seat holds a whole person or none, never a half of one.
    expect(rows[0]?.seats[2]?.person).toBe(null);
    expect(rows[0]?.seats[0]?.person?.vorname).toBe("Erika");
  });

  /* What the completeness badge reads. Counted off the seats rather than stored beside them, so it
     cannot come to disagree with the cells under it. */
  it("counts the seats that hold somebody", () => {
    const voll = buildKontaktRows(
      [
        club({
          trainer: kontaktperson("Tim"),
          ansprechperson: kontaktperson("Erika"),
          stellvertretung: kontaktperson("Lena"),
          trainer_is_also: null,
        }),
      ],
      SAISON,
    );
    const teilweise = buildKontaktRows(
      [club({ trainer: null, ansprechperson: kontaktperson("Erika"), stellvertretung: null, trainer_is_also: null })],
      SAISON,
    );

    expect(voll[0]?.besetzt).toBe(3);
    expect(teilweise[0]?.besetzt).toBe(1);
  });

  it("badges no shared seat while the trainer holds nobody, whatever the claim asserts", () => {
    const rows = buildKontaktRows(
      [
        club({
          trainer: null,
          ansprechperson: kontaktperson("Erika"),
          stellvertretung: kontaktperson("Lena"),
          trainer_is_also: "ansprechperson",
        }),
      ],
      SAISON,
    );

    // The claim is an assertion nothing checks, so an empty Trainer seat must not badge the seat
    // beside it as holding the same person.
    expect(rows[0]?.seats[1]?.istTrainerZugleich).toBe(false);
  });

  /* The claim names a seat, so the badge has to follow it. Pinned to the Ansprechperson, a Trainer
     who is also the Stellvertretung reads on the list as three separate people. */
  it("badges whichever seat the claim names, the Stellvertretung included", () => {
    const shared = kontaktperson("Erika");
    const rows = buildKontaktRows(
      [
        club({
          trainer: shared,
          ansprechperson: kontaktperson("Max"),
          stellvertretung: shared,
          trainer_is_also: "stellvertretung",
        }),
      ],
      SAISON,
    );

    expect(rows[0]?.seats[0]?.istTrainerZugleich, "the badge stayed on the seat the claim does not name").toBe(false);
    expect(rows[0]?.seats[1]?.istTrainerZugleich).toBe(true);
  });

  /* Both shapes nobody on file is stored in, the claim an erasure leaves standing over empty seats
     included: the Kontakte editor opens all of them as nobody, and a card here would say otherwise. */
  it("contributes no row at all for a club with nobody on file, whichever shape stores it", () => {
    const leer = { trainer: null, ansprechperson: null, stellvertretung: null } as const;

    expect(buildKontaktRows([club(null)], SAISON)).toStrictEqual([]);
    expect(buildKontaktRows([club({ ...leer, trainer_is_also: null })], SAISON)).toStrictEqual([]);
    expect(buildKontaktRows([club({ ...leer, trainer_is_also: "ansprechperson" })], SAISON)).toStrictEqual([]);
  });
});

describe("holdsNobody", () => {
  /* The seat-by-seat floor beside the two empty shapes: one seat held is somebody on file, whichever
     seat it is. */
  it("reads no block and a block of empty seats alike, and any one held seat as somebody", () => {
    const leer: FLSaisonTeamKontakte = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_is_also: null };

    expect(holdsNobody(null)).toBe(true);
    expect(holdsNobody(leer)).toBe(true);
    for (const { value } of KONTAKT_ROLLEN) {
      expect(holdsNobody({ ...leer, [value]: kontaktperson("Erika") }), `a block holding only the ${value} reads as nobody on file`).toBe(
        false,
      );
    }
  });
});

describe("the club filter a link into the contacts list preselects", () => {
  const rows = buildKontaktRows(
    [club({ trainer: kontaktperson("Tim"), ansprechperson: null, stellvertretung: null, trainer_is_also: null })],
    SAISON,
  );

  /* `?team=<id>`, the parameter `/bereich/admin/spieler` and `/bereich/admin/spielsuche` already answer to. A link
     naming a parameter the facet does not declare filters nothing and reports nothing. */
  it("reads the club off the row under the parameter the row actions link with", () => {
    const facets = buildKontakteFacets(rows.map((row) => ({ teamId: row.teamId, name: row.teamName })));
    const teamFacet = facets.find((facet) => facet.param === "team");

    assert.ok(teamFacet, "the contacts list offers no club filter for a link to preselect");
    expect(teamFacet.read(rows[0]!), "the club facet reads something other than the row's club").toStrictEqual([rows[0]!.teamId]);
    expect(
      teamFacet.options.map((option) => option.value),
      "the club facet offers clubs the list does not hold",
    ).toStrictEqual([rows[0]!.teamId]);
  });

  /* Who seated a person is the one origin a seat keeps. */
  it("reads who seated each person, across the club's seats", () => {
    const seated = (enteredBy: FLKontaktperson["einwilligung"]["entered_by"]) => ({
      ...kontaktperson("Tim"),
      einwilligung: { ...kontaktperson("Tim").einwilligung, entered_by: enteredBy },
    });
    const [row] = buildKontaktRows(
      [
        club({
          trainer: seated("bewerbung"),
          ansprechperson: seated("liga"),
          stellvertretung: seated("liga"),
          trainer_is_also: null,
        }),
      ],
      SAISON,
    );
    const facet = buildKontakteFacets([]).find((each) => each.param === "einwilligung");

    assert.ok(facet !== undefined && row !== undefined, "the contacts list offers no origin filter, or no row");
    expect([...facet.read(row)].sort(), "the facet reads an origin other than who seated each person").toStrictEqual(["bewerbung", "liga"]);
    expect(facet.options.map((option) => option.value)).toStrictEqual(EINGETRAGEN_VON_OPTIONS.map((option) => option.value));
  });

  /* Two arms that partition the list: every row answers exactly one, so the facet cannot leave a club
     out of both. A club with nobody on file has no row to grade (`buildKontaktRows`). */
  it("grades every club's completeness as exactly one of the two", () => {
    const angeboten = new Set(KONTAKTE_BESETZUNG_OPTIONS.map((option) => option.value));

    for (let besetzt = 1; besetzt <= KONTAKT_ROLLEN.length; besetzt += 1) {
      assert.ok(angeboten.has(kontakteBesetzung(besetzt)), `${String(besetzt)} seats grade to something the filter does not offer`);
    }
    expect(kontakteBesetzung(3)).toBe("vollstaendig");
    // Every arm below full: pinned only at the top, a grader answering „vollstaendig“ for one seat
    // passes, and the badge then calls a club reachable through one person fully staffed.
    expect(kontakteBesetzung(1)).toBe("teilweise");
    expect(kontakteBesetzung(2)).toBe("teilweise");
  });
});

describe("the group filter the teams list offers", () => {
  const offered = (numberOfGroups: number | null) =>
    buildTeamFacets(numberOfGroups)
      .find((facet) => facet.param === "gruppe")
      ?.options.map((option) => option.value);

  /* A group the season does not run can hold nobody, so every letter past the count reads zero for
     every club there is (`fl_frontend/src/features/teams/facets.ts :: buildTeamFacets`). */
  it("cuts the offer to the groups the selected season runs", () => {
    expect(offered(2)).toStrictEqual(["A", "B"]);
    expect(offered(4)).toStrictEqual(["A", "B", "C", "D"]);
  });

  /* The rows still span every season, so the unnarrowed offer is the honest one — and a facet
     offering nothing is a filter cell a reader cannot use at all. */
  it("offers the whole set where no season resolves", () => {
    expect(offered(null)).toStrictEqual([...GRUPPEN_OPTIONS]);
  });

  /* Only the one dimension moves: the season and status facets read fields no group count reaches,
     and a rebuild that dropped either would take the list's default narrowing with it. */
  it("leaves the other facets and their order alone", () => {
    expect(buildTeamFacets(2).map((facet) => facet.param)).toStrictEqual(TEAM_FACETS.map((facet) => facet.param));
    for (const facet of TEAM_FACETS) {
      if (facet.param === "gruppe") continue;

      assert.ok(buildTeamFacets(2).includes(facet), `the ${facet.param} facet was rebuilt rather than passed through`);
    }
  });
});

describe("what a website box reports upward", () => {
  /* The scheme lives in the input group's prefix, so what the box holds is the rest of the URL. */
  it("puts the scheme back on whatever was typed", () => {
    expect(toWebsiteUrl("www.beispielschule.de")).toBe("https://www.beispielschule.de");
  });

  /* A pasted full address must not come back doubled. */
  it("de-duplicates a scheme that was pasted in with the address", () => {
    expect(toWebsiteUrl("https://www.beispielschule.de")).toBe("https://www.beispielschule.de");
    expect(toWebsiteUrl("HTTP://www.beispielschule.de")).toBe("https://www.beispielschule.de");
  });

  /* ONE spelling of "no website" is ever written, so no reader downstream tests for two. The
     club payload refuses `""` outright (`schemas.test.ts`), so an empty box reported as one would
     be refused rather than stored. */
  it("reports no website as null, never as the empty string", () => {
    expect(toWebsiteUrl("")).toBe(null);
    expect(toWebsiteUrl("   ")).toBe(null);
    expect(toWebsiteUrl("https://")).toBe(null);
  });
});

describe("the kit palette", () => {
  /* The option's type refuses a colour the wire does not carry, never one the palette leaves out,
     which would read with no name and no swatch on every row storing it. */
  it("names and draws every colour the wire carries, once each and in the wire's order", () => {
    expect(TRIKOT_FARBE_OPTIONS.map((option) => option.value)).toStrictEqual(FLTrikotFarbeSchema.options);
  });
});

describe("which kit colours the wish picker offers", () => {
  const alle = TRIKOT_FARBE_OPTIONS.map((option) => option.value);
  const values = (vergeben: readonly (typeof alle)[number][], value: (typeof alle)[number] | null = null) =>
    offeredTrikotFarben({ taken: vergeben, value: value }).map((option) => option.value);

  /* First, because every case below compares against the palette: a filter that had stopped reading
     `TRIKOT_FARBE_OPTIONS` would return nothing and make each of them pass over an empty list. */
  it("offers the whole palette while nothing is assigned", () => {
    expect(values([])).toStrictEqual(alle);
    assert.ok(alle.length > 1, "the palette holds one colour or none, so no exclusion below can be observed");
  });

  /* The colours an administrator ASSIGNED, off `saison_teams.trikot_farbe` and never off another
     application's wish -- reading wishes would carry one school's submission into another's form. */
  it("leaves out every colour the season has assigned", () => {
    const uebrig = values(["rot", "blau"]);

    assert.ok(!uebrig.includes("rot"), "an assigned colour is still offered");
    assert.ok(!uebrig.includes("blau"), "an assigned colour is still offered");
    expect(uebrig.length, "the exclusion dropped something other than the two assigned colours").toBe(alle.length - 2);
  });

  /* Order carries the palette's, so a school reads the same list it reads everywhere else. */
  it("keeps the palette's own order in what is left", () => {
    const uebrig = values(["rot"]);

    expect(uebrig).toStrictEqual(alle.filter((farbe) => farbe !== "rot"));
  });

  /* A stored assignment stays pickable in its own editor: without this, reopening a saved row would
     offer every colour except the one it holds. */
  it("keeps the colour the field already holds", () => {
    assert.ok(values(["rot", "blau"], "rot").includes("rot"), "the field's own colour was excluded from its own picker");
  });

  /* The boundary the palette can cross on its own: more teams than colours. An empty offer is the
     answer there, and the field stays required: the picker offers only what the season can still
     give. */
  it("offers nothing once the season has assigned every colour", () => {
    expect(values(alle)).toStrictEqual([]);
  });

  /* And only there: emptied a colour early, the picker would withhold one the season still has. */
  it("still offers the last colour the season has left", () => {
    expect(values(alle.slice(1))).toStrictEqual(alle.slice(0, 1));
  });

  /* The held value survives the exhausted season as well, its own colour being by definition one of
     the assigned ones -- so an editor reopening such a row still reads what it holds. */
  it("keeps the field's own colour even where every colour is assigned", () => {
    expect(values(alle, "rot")).toStrictEqual(["rot"]);
  });
});

describe("whether the list and the editor offer a club's retirement", () => {
  const SAISONS = [
    { id: "2025", status: "past" as const },
    { id: "2026", status: "active" as const },
    { id: "2027", status: "future" as const },
  ];
  const inSaisons = (...ids: string[]) =>
    isRetireable(
      SAISONS,
      ids.map((saison_id) => ({ saison_id })),
    );

  /* `retire_blocked` reads every season the club stands in, so the selected one alone would offer a write it refuses. */
  it("withholds it while a running or a planned season holds the club, whichever season is selected", () => {
    expect(inSaisons("2025", "2026")).toBe(false);
    expect(inSaisons("2025", "2027")).toBe(false);
  });

  it("offers it to a club whose seasons are all past, and to one in none", () => {
    expect(inSaisons("2025")).toBe(true);
    expect(inSaisons()).toBe(true);
  });
});
