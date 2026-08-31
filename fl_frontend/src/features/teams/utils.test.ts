import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIGA_EINWILLIGUNG } from "@/core/einwilligung";

import { TRIKOT_FARBE_OPTIONS } from "./constants.ts";
import { buildKontakteFacets, KONTAKTE_BESETZUNG_OPTIONS, kontakteBesetzung } from "./facets.ts";
// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import {
  buildEmptyKontaktperson,
  buildKontaktRows,
  computePlatzByTeamId,
  computeQualifyingTeamIds,
  computeSaisonVerlauf,
  describeReplacementUmfang,
  offeredTrikotFarben,
  toWebsiteUrl,
} from "./utils.ts";

import type { FLSaisonPhase } from "../saisons/schemas.ts";
import type { FLSpiel } from "../spiele/schemas.ts";
import type { FLGruppenTeam, FLKontaktperson, FLSaisonTeamKontakte, FLTeamWithMemberships } from "./schemas.ts";

const TEAM_ID = (seed: number) => `6890a1b2c3d4e5f6071900${String(seed).padStart(2, "0")}`;

/**
 * One row of a standing, reduced to the fields this derivation reads. A team is walked past because
 * `austritt_type` is non-null, never because of which route out of the season it names.
 */
const row = (seed: number, { gespielt = 3, ausstehend = 0, disqualified = false } = {}) =>
  ({
    id: TEAM_ID(seed),
    austritt_type: disqualified ? "disqualifikation" : null,
    statistik: { anzahl_gespielte_spiele: gespielt },
    anzahl_ausstehende_spiele: ausstehend,
  }) as FLGruppenTeam;

const marked = (teams: FLGruppenTeam[], qualifiersPerGroup = 2) => [...computeQualifyingTeamIds({ teams, qualifiersPerGroup })];

describe("computeQualifyingTeamIds", () => {
  it("marks the first teams in the order the backend ranked them", () => {
    assert.deepEqual(marked([row(1), row(2), row(3), row(4)]), [TEAM_ID(1), TEAM_ID(2)]);
  });

  it("passes over a disqualified team and gives the place to the team below", () => {
    assert.deepEqual(marked([row(1, { disqualified: true }), row(2), row(3)]), [TEAM_ID(2), TEAM_ID(3)]);
  });

  it("marks a team whose first fixture is still to come", () => {
    // It will have a counting match, so the backend seeds it — and a marker that passed over it
    // would highlight a different club than the bracket names.
    assert.deepEqual(marked([row(1, { gespielt: 0, ausstehend: 3 }), row(2), row(3)]), [TEAM_ID(1), TEAM_ID(2)]);
  });

  it("passes over a team with nothing played and nothing left", () => {
    // Zeroes rank above a negative goal difference, so this row can sit high while it has earned
    // nothing and can earn nothing.
    assert.deepEqual(marked([row(1, { gespielt: 0 }), row(2), row(3)]), [TEAM_ID(2), TEAM_ID(3)]);
  });

  it("marks fewer than the count when the group cannot fill it", () => {
    assert.deepEqual(marked([row(1), row(2, { disqualified: true })]), [TEAM_ID(1)]);
  });

  it("marks the leaders in a group whose matches have not started", () => {
    // A drawn group is a league table from day one: every club is on a placing, so the cutoff falls
    // where the ranking put it rather than nowhere.
    const drawn = [row(1, { gespielt: 0, ausstehend: 3 }), row(2, { gespielt: 0, ausstehend: 3 }), row(3, { gespielt: 0, ausstehend: 3 })];

    assert.deepEqual(marked(drawn), [TEAM_ID(1), TEAM_ID(2)]);
  });

  it("marks nobody in a group with no fixtures drawn at all", () => {
    // The case the legend is hidden for: a highlight nobody can see needs no explanation under it.
    assert.deepEqual(marked([row(1, { gespielt: 0 }), row(2, { gespielt: 0 })]), []);
  });

  it("takes the count from the season rather than assuming two", () => {
    assert.deepEqual(marked([row(1), row(2), row(3), row(4)], 3), [TEAM_ID(1), TEAM_ID(2), TEAM_ID(3)]);
  });
});

describe("computePlatzByTeamId", () => {
  // A raw row index prints "3" for the team the bracket calls "2. der Gruppe A", so the count has to
  // walk past a disqualification.
  it("numbers past a disqualified row, matching the backend's platz", () => {
    const platz = computePlatzByTeamId([row(1), row(2, { disqualified: true }), row(3)]);

    assert.equal(platz.get(TEAM_ID(1)), 1);
    assert.equal(platz.get(TEAM_ID(2)), undefined);
    assert.equal(platz.get(TEAM_ID(3)), 2);
  });

  // The `N/A` the cell still has to reach: nothing earned and nothing left to earn it with.
  it("gives a row with nothing played and nothing left no ordinal", () => {
    const platz = computePlatzByTeamId([row(1), row(2, { gespielt: 0 })]);

    assert.equal(platz.get(TEAM_ID(2)), undefined);
    assert.equal(platz.size, 1);
  });

  // The backend numbers a club yet to play, so a cell that skips it prints `N/A` on that row and 2
  // on the row the bracket calls 3.
  it("numbers a row whose first fixture is still to come, and moves the row below it down", () => {
    const platz = computePlatzByTeamId([row(1), row(2, { gespielt: 0, ausstehend: 2 }), row(3)]);

    assert.equal(platz.get(TEAM_ID(2)), 2);
    assert.equal(platz.get(TEAM_ID(3)), 3);
  });

  it("numbers every club in a group that has yet to kick off", () => {
    const drawn = [row(1, { gespielt: 0, ausstehend: 3 }), row(2, { gespielt: 0, ausstehend: 3 })];

    assert.deepEqual([...computePlatzByTeamId(drawn).values()], [1, 2]);
  });

  // The shared-predicate property: whoever the marker may consider, the numbering numbers.
  it("numbers exactly the rows the marker considers", () => {
    const teams = [row(1), row(2, { disqualified: true }), row(3, { gespielt: 0 }), row(4, { gespielt: 0, ausstehend: 1 })];

    const numbered = new Set(computePlatzByTeamId(teams).keys());
    const qualifying = computeQualifyingTeamIds({ teams, qualifiersPerGroup: teams.length });

    assert.deepEqual(numbered, qualifying);
  });
});

const SUBJECT = TEAM_ID(1);
const OPPONENT = TEAM_ID(2);

/** One fixture, reduced to the fields the season's progress is read from. */
const fixture = ({
  phase,
  ergebnis = null,
  heim = SUBJECT,
  gast = OPPONENT,
}: {
  phase: FLSaisonPhase;
  ergebnis?: string | null;
  heim?: string;
  gast?: string;
}) =>
  ({
    saison_phase: phase,
    ergebnis,
    team1: { team_id: heim },
    team2: { team_id: gast },
  }) as FLSpiel;

const verlaufOf = (spiele: FLSpiel[], teamId = SUBJECT) => computeSaisonVerlauf({ spiele, teamId });

describe("computeSaisonVerlauf", () => {
  // Elimination and an undrawn bracket look identical from here — a state waiting fixes.
  it("claims no outcome for a group phase the team has not visibly come through", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase", ergebnis: "3:1" }), fixture({ phase: "gruppenphase", ergebnis: "0:4" })]);

    assert.deepEqual(verlauf, [{ phase: "gruppenphase", outcome: "unknown" }]);
  });

  it("says nothing about a team with no fixtures at all", () => {
    assert.deepEqual(verlaufOf([]), []);
  });

  it("reports the group phase as come through once a knockout fixture fields the team", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase", ergebnis: "3:1" }), fixture({ phase: "viertelfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "gruppenphase", outcome: "advanced" },
      { phase: "viertelfinale", outcome: "pending" },
    ]);
  });

  // An organiser may seed a team into a knockout slot before its group has played anything, and
  // "überstanden" there claims a round that has not happened.
  it("claims no outcome for a group phase with no result, however deep the team is standing", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase" }), fixture({ phase: "viertelfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "gruppenphase", outcome: "unknown" },
      { phase: "viertelfinale", outcome: "pending" },
    ]);
  });

  // A group fixture's own result never becomes the round's outcome: come-through turns on a
  // knockout fixture.
  it("claims nothing for a group phase with no round beyond it, whatever its fixtures did", () => {
    const groupOutcomes = new Set(
      [null, "0:4", "2:2"].map((ergebnis) => verlaufOf([fixture({ phase: "gruppenphase", ergebnis })])[0]?.outcome),
    );

    assert.deepEqual(groupOutcomes, new Set(["unknown"]));
  });

  it("orders the rounds as a season plays them, not as the fixtures arrive", () => {
    // The page sorts fixtures by date, so a rescheduled semi-final played before a quarter-final
    // would otherwise show the two rounds out of order.
    const verlauf = verlaufOf([fixture({ phase: "halbfinale", ergebnis: "0:2" }), fixture({ phase: "viertelfinale", ergebnis: "3:1" })]);

    assert.deepEqual(verlauf, [
      { phase: "viertelfinale", outcome: "won" },
      { phase: "halbfinale", outcome: "out" },
    ]);
  });

  it("reads each round's result from the team's own side of the fixture", () => {
    assert.deepEqual(verlaufOf([fixture({ phase: "finale", ergebnis: "0:2", heim: OPPONENT, gast: SUBJECT })]), [
      { phase: "finale", outcome: "won" },
    ]);
  });

  // A knockout finishing level is a draw to every reader but the bracket, so with nothing downstream
  // the page has no winner to name.
  it("claims no winner for a round that finished level and led nowhere yet", () => {
    assert.deepEqual(verlaufOf([fixture({ phase: "halbfinale", ergebnis: "2:2" })]), [{ phase: "halbfinale", outcome: "level" }]);
  });

  // The one case the shoot-out would otherwise be read for: the evidence the tie broke this team's
  // way is where the team stands now.
  it("reports a level round as come through when a later round fields the team", () => {
    const verlauf = verlaufOf([fixture({ phase: "halbfinale", ergebnis: "2:2" }), fixture({ phase: "finale" })]);

    assert.deepEqual(verlauf, [
      { phase: "halbfinale", outcome: "advanced" },
      { phase: "finale", outcome: "pending" },
    ]);
  });

  // A manual pick that did not qualify is warned and never refused, so a beaten team in the next
  // round is a real state.
  it("reports a lost round as come through when a later round fields the team anyway", () => {
    const verlauf = verlaufOf([fixture({ phase: "viertelfinale", ergebnis: "0:2" }), fixture({ phase: "halbfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "viertelfinale", outcome: "advanced" },
      { phase: "halbfinale", outcome: "pending" },
    ]);
  });

  // The bound on the rule above: a team can be seeded out of an UNPLAYED round, and "überstanden"
  // would then sit beside a card with no score.
  it("claims no outcome for an unplayed round, however deep the team is standing", () => {
    const verlauf = verlaufOf([fixture({ phase: "viertelfinale" }), fixture({ phase: "halbfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "viertelfinale", outcome: "pending" },
      { phase: "halbfinale", outcome: "pending" },
    ]);
  });

  // A round the season does not play must produce no chip, never one saying the team failed to
  // reach it.
  it("produces no entry for a round the team has no fixture in", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase", ergebnis: "1:0" }), fixture({ phase: "halbfinale", ergebnis: "1:0" })]);

    assert.deepEqual(verlauf, [
      { phase: "gruppenphase", outcome: "advanced" },
      { phase: "halbfinale", outcome: "won" },
    ]);
  });

  // The guard is what keeps a caller passing the whole season's fixtures from being told the team
  // reached the final.
  it("ignores a knockout fixture the team does not occupy", () => {
    const verlauf = verlaufOf([
      fixture({ phase: "viertelfinale", ergebnis: "1:0" }),
      fixture({ phase: "finale", ergebnis: "4:0", heim: OPPONENT, gast: TEAM_ID(3) }),
    ]);

    assert.deepEqual(verlauf, [{ phase: "viertelfinale", outcome: "won" }]);
  });
});

const umfang = (fannedOutToSpiele: number, retiredSquadRows: number) => describeReplacementUmfang({ fannedOutToSpiele, retiredSquadRows });

describe("describeReplacementUmfang", () => {
  it("reports the fixtures with their own zero and their own singular", () => {
    assert.match(umfang(0, 0), /^Für das ausscheidende Team war noch kein Spiel angesetzt\./);
    assert.match(umfang(1, 0), /^Ein angesetztes Spiel wurde übernommen\./);
    assert.match(umfang(7, 0), /^7 angesetzte Spiele wurden übernommen\./);
  });

  it("reports the squad rows with their own singular", () => {
    assert.match(umfang(0, 1), /Ein Kadereintrag des ausscheidenden Teams wurde ausgetragen\./);
    assert.match(umfang(0, 4), /4 Kadereinträge des ausscheidenden Teams wurden ausgetragen\./);
  });

  /* `retired_squad_rows` counts the LIVE rows this write stamped, so zero is a fact about the squad
     at that moment and never about the club's history: one whose players were all ausgetragen first
     reports zero too. */
  it("says the squad stood empty at zero, never that the club had no players", () => {
    assert.match(umfang(0, 0), /Im Kader des ausscheidenden Teams stand kein Spieler\./);
    assert.doesNotMatch(umfang(0, 0), /hatte das ausscheidende Team keine/);
  });

  /* `stillgelegt` would report these pupils out of every pick list there is, the endpoint stamping
     `saison_spieler` and touching no `spieler` document. */
  it("never calls a squad row's retirement a Stilllegung", () => {
    for (const report of [umfang(0, 0), umfang(2, 1), umfang(2, 9)]) {
      assert.doesNotMatch(report, /stillgelegt|Stilllegen/, "the report retires the people rather than their squad entries");
      assert.doesNotMatch(report, /Spieler wurde/, "the report writes about people where the write moved entries");
    }
  });

  /* The repair is a reassignment, never the outgoing club's return: `REQ-SQUAD-001` judges the row's
     `team_id` on the PATCH as well, so no season status stands between the row and its squad. */
  it("names the reassignment as the repair, and names it only where it retired a row", () => {
    for (const report of [umfang(0, 1), umfang(3, 9)]) {
      assert.match(report, /Um einen solchen Eintrag zu reaktivieren/);
      assert.match(report, /Bereich „Kader“ einem Team dieser Saison zu/);
      assert.doesNotMatch(report, /geplante Saison|wieder in dieser Saison steht/, "the report names a repair the rule does not ask for");
    }

    assert.doesNotMatch(umfang(3, 0), /[Rr]eaktivieren/, "nothing was retired and the report warns about it anyway");
  });

  /* It lands in a toast with no figures beside it, so each half has to stand as a sentence. */
  it("writes whole sentences, with nothing left dangling", () => {
    for (const report of [umfang(0, 0), umfang(1, 1), umfang(12, 3)]) {
      assert.match(report, /^[A-ZÄÖÜ0-9]/, "the report opens lower-case");
      assert.match(report, /\.$/, "the report does not end in a full stop");
      assert.doesNotMatch(report, /dafür|diesen Platz/, "the report leans on a word with no antecedent");
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
  einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "2025-08", datum: "2025-09-01" },
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
  memberships: [{ saison_id: SAISON, gruppe: "A", austritt: null, trikot_farbe: null, kontakte }],
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
          trainer_ist_zugleich: null,
        }),
      ],
      SAISON,
    );

    assert.equal(rows.length, 1, "the club contributes something other than one row");
    assert.equal(rows[0]?.id, rows[0]?.teamId, "the row is keyed by something other than the club it stands for");
    assert.deepEqual(
      rows[0]?.seats.map((seat) => seat.rolle),
      ["trainer", "ansprechperson", "stellvertretung"],
      "the seats are not the three the editor asks for, in its order",
    );
    // Null and not five empty strings: a seat holds a whole person or none, never a half of one.
    assert.equal(rows[0]?.seats[0]?.person, null);
    assert.equal(rows[0]?.seats[1]?.person?.vorname, "Erika");
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
          trainer_ist_zugleich: null,
        }),
      ],
      SAISON,
    );
    const teilweise = buildKontaktRows(
      [club({ trainer: null, ansprechperson: kontaktperson("Erika"), stellvertretung: null, trainer_ist_zugleich: null })],
      SAISON,
    );
    const leer = buildKontaktRows([club({ trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null })], SAISON);

    assert.equal(voll[0]?.besetzt, 3);
    assert.equal(teilweise[0]?.besetzt, 1);
    assert.equal(leer[0]?.besetzt, 0);
  });

  it("badges no shared seat while the trainer holds nobody, whatever the claim asserts", () => {
    const rows = buildKontaktRows(
      [
        club({
          trainer: null,
          ansprechperson: kontaktperson("Erika"),
          stellvertretung: kontaktperson("Lena"),
          trainer_ist_zugleich: "ansprechperson",
        }),
      ],
      SAISON,
    );

    // The claim is an assertion nothing checks, so an empty Trainer seat must not badge the seat
    // beside it as holding the same person.
    assert.equal(rows[0]?.seats[1]?.istTrainerZugleich, false);
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
          trainer_ist_zugleich: "stellvertretung",
        }),
      ],
      SAISON,
    );

    assert.equal(rows[0]?.seats[1]?.istTrainerZugleich, false, "the badge stayed on the seat the claim does not name");
    assert.equal(rows[0]?.seats[2]?.istTrainerZugleich, true);
  });

  it("contributes no row at all for a club with nothing on file", () => {
    assert.deepEqual(buildKontaktRows([club(null)], SAISON), []);
  });
});

describe("the club filter a link into the contacts list preselects", () => {
  const rows = buildKontaktRows(
    [club({ trainer: kontaktperson("Tim"), ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null })],
    SAISON,
  );

  /* `?team=<id>`, the parameter `/admin/spieler` and `/admin/spielsuche` already answer to. A link
     naming a parameter the facet does not declare filters nothing and reports nothing. */
  it("reads the club off the row under the parameter the row actions link with", () => {
    const facets = buildKontakteFacets(rows.map((row) => ({ teamId: row.teamId, name: row.teamName })));
    const teamFacet = facets.find((facet) => facet.param === "team");

    assert.ok(teamFacet, "the contacts list offers no club filter for a link to preselect");
    assert.deepEqual(teamFacet.read(rows[0]!), [rows[0]!.teamId], "the club facet reads something other than the row's club");
    assert.deepEqual(
      teamFacet.options.map((option) => option.value),
      [rows[0]!.teamId],
      "the club facet offers clubs the list does not hold",
    );
  });

  /* Three arms that partition the list: every row answers exactly one, so the facet cannot leave a
     club out of all three. */
  it("grades every club's completeness as exactly one of the three", () => {
    const angeboten = new Set(KONTAKTE_BESETZUNG_OPTIONS.map((option) => option.value));

    for (const besetzt of [0, 1, 2, 3]) {
      assert.ok(angeboten.has(kontakteBesetzung(besetzt)), `${String(besetzt)} seats grade to something the filter does not offer`);
    }
    assert.equal(kontakteBesetzung(3), "vollstaendig");
    assert.equal(kontakteBesetzung(0), "leer");
    // The middle arm too: pinned only at the ends, a grader answering „vollstaendig“ for one seat
    // passes, and the badge then calls a club reachable through one person fully staffed.
    assert.equal(kontakteBesetzung(1), "teilweise");
    assert.equal(kontakteBesetzung(2), "teilweise");
  });
});

describe("what a website box reports upward", () => {
  /* The scheme lives in the input group's prefix, so what the box holds is the rest of the URL. */
  it("puts the scheme back on whatever was typed", () => {
    assert.equal(toWebsiteUrl("www.beispielschule.de"), "https://www.beispielschule.de");
  });

  /* A pasted full address must not come back doubled. */
  it("de-duplicates a scheme that was pasted in with the address", () => {
    assert.equal(toWebsiteUrl("https://www.beispielschule.de"), "https://www.beispielschule.de");
    assert.equal(toWebsiteUrl("HTTP://www.beispielschule.de"), "https://www.beispielschule.de");
  });

  /* The whole point of the function: ONE spelling of "no website" is ever written, so no reader
     downstream has to test for two. `OptionalExternalUrlSchema` admits `""` on the way in, which is
     what would let a second spelling through if this reported one. */
  it("reports no website as null, never as the empty string", () => {
    assert.equal(toWebsiteUrl(""), null);
    assert.equal(toWebsiteUrl("   "), null);
    assert.equal(toWebsiteUrl("https://"), null);
  });
});

describe("what a new consent cites", () => {
  /* Stamped from the one constant, never typed and never left blank: the version NAMES the wording,
     so a record citing nothing, or citing a value somebody keyed in, claims agreement to a text the
     league cannot identify. */
  it("stamps the league's current wording version", () => {
    const frisch = buildEmptyKontaktperson().einwilligung;

    assert.equal(frisch.text_version, LIGA_EINWILLIGUNG.textVersion, "a new consent cites a version the league did not stamp");
    assert.notEqual(frisch.text_version, "", "a new consent cites no wording at all");
  });
});

describe("which kit colours the wish picker offers", () => {
  const alle = TRIKOT_FARBE_OPTIONS.map((option) => option.value);
  const werte = (vergeben: readonly (typeof alle)[number][], value: (typeof alle)[number] | null = null) =>
    offeredTrikotFarben({ vergeben: vergeben, value: value }).optionen.map((option) => option.value);

  /* First, because every case below compares against the palette: a filter that had stopped reading
     `TRIKOT_FARBE_OPTIONS` would return nothing and make each of them pass over an empty list. */
  it("offers the whole palette while nothing is assigned", () => {
    assert.deepEqual(werte([]), alle);
    assert.ok(alle.length > 1, "the palette holds one colour or none, so no exclusion below can be observed");
  });

  /* The colours an administrator ASSIGNED, off `saison_teams.trikot_farbe` and never off another
     application's wish -- reading wishes would carry one school's submission into another's form. */
  it("leaves out every colour the season has assigned", () => {
    const uebrig = werte(["rot", "blau"]);

    assert.ok(!uebrig.includes("rot"), "an assigned colour is still offered");
    assert.ok(!uebrig.includes("blau"), "an assigned colour is still offered");
    assert.equal(uebrig.length, alle.length - 2, "the exclusion dropped something other than the two assigned colours");
  });

  /* Order carries the CI document's, so a school reads the same list it reads everywhere else. */
  it("keeps the palette's own order in what is left", () => {
    const uebrig = werte(["rot"]);

    assert.deepEqual(
      uebrig,
      alle.filter((farbe) => farbe !== "rot"),
    );
  });

  /* A stored assignment stays pickable in its own editor: without this, reopening a saved row would
     offer every colour except the one it holds. */
  it("keeps the colour the field already holds", () => {
    assert.ok(werte(["rot", "blau"], "rot").includes("rot"), "the field's own colour was excluded from its own picker");
  });

  /* The boundary the palette can cross on its own -- sixteen colours against a season capped at 64
     teams. The whole palette comes back rather than nothing: a wish is not unique, and an empty
     required picker is an application nobody can submit. */
  it("gives the whole palette back once the exclusion would leave nothing", () => {
    const ausgeschoepft = offeredTrikotFarben({ vergeben: alle, value: null });

    assert.equal(ausgeschoepft.istAusgeschoepft, true, "an exhausted palette is not reported as one");
    assert.deepEqual(
      ausgeschoepft.optionen.map((option) => option.value),
      alle,
    );
  });

  /* And only then: reported one colour early, the note would tell a school the season was full while
     fifteen colours were still on offer. */
  it("reports nothing exhausted while one colour is still free", () => {
    assert.equal(offeredTrikotFarben({ vergeben: alle.slice(1), value: null }).istAusgeschoepft, false);
    assert.equal(offeredTrikotFarben({ vergeben: [], value: null }).istAusgeschoepft, false);
  });
});
