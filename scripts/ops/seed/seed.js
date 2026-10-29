// SCRIPTS · the made-up seed: a league nobody plays in, for daily work and the end-to-end journeys.
//
// Two seasons, eight clubs, five venues, four referees, an owner and four administrators, every one of them
// invented, so no machine needs production's personal data to show a page in each of its states.
// The states are the ones the Spielplan, the sign-in, the match editor and the Spielorte table draw:
//
// - a finished season: every fixture played, the final decided on penalties;
// - the running season: a played matchday holding a forfeit, today's matchday holding a played, an
//   open and a cancelled fixture, next week's matchday holding an undated fixture, and a knockout
//   round drawn but not yet decided;
// - venues with and without rent, one retired and one with a name long enough to test a row's width;
//   referees with and without an address, one retired;
// - an owner and four administrators.
//
// The administrators and the two referees with an address are the journeys' people: one
// administrator and one referee per end-to-end project (`fl_frontend/playwright.config.ts`), the
// third administrator the desktop journey's whose save meets the proxy signed out
// (`fl_frontend/e2e/desktop/signedOutSave.spec.ts`), and the fourth the administration's journey's
// (`fl_frontend/e2e/desktop/verwaltung.spec.ts`): each sets up its own passkey, which no other journey
// could then answer. The owner signs in in none.
//
// Run by `./scripts/ops/local.sh --e2e` and `--seed-made-up`, and by the journeys' CI job, with
// mongosh INSIDE the stack's own database container, at `mongodb://127.0.0.1:27017/<DB_BASE_NAME>`
// with `directConnection=true`: no other server is reachable by that address, so this script cannot
// write anywhere but the stack it is handed to. The backend has booted first, so every index is in
// place, and `python -m app.core.readback` judges every document afterwards; the frontend starts
// only once it has passed (`docs/ops/spec.md` §1.5).
//
// Invariants:
// - Every date is relative to today in Germany, so "today's matchday" is today whenever it runs.
// - Every document is spelled as the backend writes it: each key its record model requires, written
//   null rather than left out, and the copies a fixture embeds taken from the row they copy.
// - It empties every collection of the application database first and never touches `auth`, the
//   sign-in store the frontend keeps beside it.

/* global db, ObjectId, print */

const GERMANY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 24 * 60 * 60 * 1000;

// `en-CA` spells a date as the stored `YYYY-MM-DD`; the arithmetic runs on that day's UTC midnight,
// so a daylight-saving change between today and the offset moves no date.
const TODAY = GERMANY.format(new Date());

/** The German calendar day `offset` days from today, as every stored date spells one. */
function day(offset) {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

function address(strasse, hausnummer, plz, stadtteil) {
  return { strasse, hausnummer, plz, stadtteil, stadt: "Frankfurt am Main" };
}

// --- The clubs -----------------------------------------------------------------------------------

const CLUBS = ["Ahorn", "Birke", "Eiche", "Linde", "Ulme", "Esche", "Kastanie", "Weide"].map((name, index) => ({
  _id: ObjectId(),
  name,
  shorthand: name.slice(0, 2).toUpperCase(),
  description: "",
  full_name: `${name}-Gymnasium`,
  website_url: null,
  address: address("Schulweg", String(index + 1), `6031${index}`, "Nordend"),
  schulform: index % 2 === 0 ? "gymnasium_g9" : "gesamtschule",
  inactive_since: null,
}));

const club = Object.fromEntries(CLUBS.map((row) => [row.name, row]));

// --- Venues and referees -------------------------------------------------------------------------

/** The parts holding more than blanks, joined: `fl_backend/app/shared/schemas/addresses.py :: _join_present`. */
function joinPresent(parts, separator) {
  return parts.filter((part) => part.trim() !== "").join(separator);
}

/**
 * The search string the public match facts hand to a map search, never a URL, as
 * `fl_backend/app/api/spielorte/admin_router.py :: _maps_link` writes it.
 */
function mapsLink(name, adresse) {
  const strasse = joinPresent([adresse.strasse, adresse.hausnummer], " ");
  const ort = joinPresent([adresse.plz, adresse.stadtteil, adresse.stadt], " ");
  return `${name}, ${joinPresent([strasse, ort], ", ")}, Deutschland`;
}

function venue(name, rent, adresse, inactiveSince) {
  return {
    _id: ObjectId(),
    name,
    address: adresse,
    maps_link: mapsLink(name, adresse),
    default_mietpreis: rent,
    inactive_since: inactiveSince,
  };
}

const VENUES = [
  venue("Sportplatz Ahornweg", 0, address("Ahornweg", "2", "60316", "Nordend"), null),
  venue("Sporthalle Birkenallee", 40, address("Birkenallee", "14a", "60489", "Rödelheim"), null),
  venue("Kunstrasen Eichenhain", 25, address("Eichenhain", "7", "60599", "Sachsenhausen"), null),
  venue("Bolzplatz Lindenstraße", 0, address("Lindenstraße", "30", "60325", "Westend"), day(-120)),
  // Last, so no fixture's booking (`booked`, by index) changes: a name as long as a real ground's can be.
  venue("Bezirkssportanlage Frankfurt-Nieder-Eschbach Nord", 30, address("Deuil-la-Barre-Straße", "100", "60437", "Nieder-Eschbach"), null),
];

function referee(name, schule, payment, email, inactiveSince) {
  return { _id: ObjectId(), name, schule, default_payment: payment, kontakt: { telefon: null, email }, inactive_since: inactiveSince };
}

const REFEREES = [
  referee("Anna Ahrens", "Ahorn-Gymnasium", 20, "anna.ahrens@example.com", null),
  referee("Ben Brandt", null, 25, "ben.brandt@example.com", null),
  referee("Carla Conrad", "Ulme-Gymnasium", 20, null, null),
  referee("Dieter Dorn", null, 15, null, day(-90)),
];

// --- Grants --------------------------------------------------------------------------------------

// Folded as the sign-in folds an address, or the grant admits nobody (`docs/ops/runbooks.md` §3).
const GRANTS = [
  ["inhaber@example.com", "owner"],
  ["admin.desktop@example.com", "administration"],
  ["admin.telefon@example.com", "administration"],
  ["admin.editor@example.com", "administration"],
  ["admin.verwaltung@example.com", "administration"],
].map(([adresse, verwaltung]) => ({ _id: ObjectId(), adresse, verwaltung, erteilt_von: "MADE-UP-SEED", erteilt_am: new Date() }));

// --- Seasons -------------------------------------------------------------------------------------

// Two groups of four and a knockout of four: the smallest shape holding every phase a page draws.
const RULES = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  tiebreak_order: "tordifferenz",
  max_kadergroesse: 18,
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1", "Q2", "Q3", "Q4"],
};

// `fl_backend/app/api/saisons/spielplan.py :: circle_rounds` for a group of four: each round's pairs
// as indexes into the group, the first index being `team1`.
const ROUNDS = [
  [
    [0, 3],
    [1, 2],
  ],
  [
    [2, 0],
    [3, 1],
  ],
  [
    [0, 1],
    [2, 3],
  ],
];

function side(name, tore) {
  return { team_id: club[name]._id, name, shorthand: club[name].shorthand, tore };
}

function booked(venueIndex, refereeIndex) {
  const ort = VENUES[venueIndex];
  const schiedsrichter = REFEREES[refereeIndex];
  return {
    ort: { spielort_id: ort._id, name: ort.name, maps_link: ort.maps_link, mietpreis: ort.default_mietpreis },
    schiedsrichter: { schiedsrichter_id: schiedsrichter._id, name: schiedsrichter.name, payment: schiedsrichter.default_payment },
  };
}

const UNBOOKED = { ort: null, schiedsrichter: null };

/**
 * One season's documents, numbered as the draw numbers them. `groups` names each group's four clubs
 * in draw order, `dates` each matchday's span, `play` what happened in the fixture of a number, and
 * `knockout` who stands in each knockout fixture, where anybody does yet.
 */
function season({ id, status, start, end, drawn, groups, dates, play, knockout = {} }) {
  const spieltage = [];
  const spiele = [];
  let spielNr = 1;

  const spieltag = (phase, position, [beginn, ende]) => {
    const row = { _id: ObjectId(), beginn, ende, saison_phase: phase, saison_id: id, position };
    spieltage.push(row);
    return row;
  };

  const spiel = (phase, spieltagId, team1Name, team2Name, quellen) => {
    const nr = spielNr++;
    const happened = play(nr);
    const [tore1, tore2] = happened.tore ?? [null, null];
    spiele.push({
      _id: ObjectId(),
      spiel_nr: nr,
      saison_id: id,
      saison_phase: phase,
      spieltag_id: spieltagId,
      team1: team1Name === null ? null : side(team1Name, tore1),
      team2: team2Name === null ? null : side(team2Name, tore2),
      team1_quelle: quellen[0],
      team2_quelle: quellen[1],
      datum: happened.datum ?? null,
      uhrzeit: happened.uhrzeit ?? null,
      ...(happened.booking ?? UNBOOKED),
      ergebnis: happened.tore ? `${tore1}:${tore2}` : null,
      elfmeterschiessen: happened.elfmeterschiessen ?? null,
      sonderereignis: happened.sonderereignis ?? null,
      notiz: null,
    });
    return nr;
  };

  ROUNDS.forEach((pairs, round) => {
    const row = spieltag("gruppenphase", round + 1, dates[round]);
    for (const group of Object.values(groups)) {
      for (const [one, other] of pairs) spiel("gruppenphase", row._id, group[one], group[other], [null, null]);
    }
  });

  // `fl_backend/app/api/saisons/spielplan.py :: bracket_seeding` for two groups of two qualifiers:
  // A1 meets B2 and B1 meets A2, and the final takes both winners.
  const halbfinale = spieltag("halbfinale", 1, dates[3]);
  const [a, b] = Object.keys(groups);
  const seeded = (gruppe, platz) => ({ type: "gruppe", gruppe, platz });
  const [hf1Team1 = null, hf1Team2 = null] = knockout.halbfinale1 ?? [];
  const [hf2Team1 = null, hf2Team2 = null] = knockout.halbfinale2 ?? [];
  const [finalTeam1 = null, finalTeam2 = null] = knockout.finale ?? [];
  const first = spiel("halbfinale", halbfinale._id, hf1Team1, hf1Team2, [seeded(a, 1), seeded(b, 2)]);
  const second = spiel("halbfinale", halbfinale._id, hf2Team1, hf2Team2, [seeded(b, 1), seeded(a, 2)]);
  const finale = spieltag("finale", 1, dates[4]);
  const winner = (nr) => ({ type: "spiel", spiel_nr: nr, ausgang: "sieger" });
  spiel("finale", finale._id, finalTeam1, finalTeam2, [winner(first), winner(second)]);

  const saison = {
    _id: id,
    start_date: start,
    end_date: end,
    status,
    rules: RULES,
    spielplan: { generiert_am: drawn, spieltage: spieltage.length, spiele: spiele.length },
    bewerbung: null,
    registrierung: null,
  };

  const saisonTeams = Object.entries(groups).flatMap(([gruppe, names]) =>
    names.map((name, index) => ({
      _id: ObjectId(),
      saison_id: id,
      team_id: club[name]._id,
      gruppe,
      austritt: null,
      trikot_farbe: index % 2 === 0 ? "blau" : "gruen",
      kontakte: null,
      name,
      shorthand: club[name].shorthand,
    })),
  );

  return { saison, saisonTeams, spieltage, spiele };
}

// The finished season. Both groups play one pattern of scores, each fixture's taken by its place in
// its group's round: group A ends Ahorn 7, Birke 6, Eiche 4, Linde 0 points and group B Ulme, Esche,
// Kastanie, Weide alike, which is who the knockout holds. The final went to penalties.
const FINISHED_MATCHDAYS = [-280, -266, -252, -210, -196];
const GROUP_SCORES = [
  [3, 0],
  [2, 1],
  [1, 1],
  [0, 2],
  [2, 1],
  [1, 0],
];
const KNOCKOUT_SCORES = { 13: { tore: [2, 0] }, 14: { tore: [1, 2] }, 15: { tore: [1, 1], elfmeterschiessen: { team1: 4, team2: 3 } } };
const finished = season({
  id: "2026",
  status: "past",
  start: day(-300),
  end: day(-150),
  drawn: day(-310),
  groups: { A: ["Ahorn", "Birke", "Eiche", "Linde"], B: ["Ulme", "Esche", "Kastanie", "Weide"] },
  dates: FINISHED_MATCHDAYS.map((offset, index) => [day(offset), day(index < 3 ? offset + 4 : offset)]),
  play: (nr) => {
    // Four fixtures a group matchday, two a semi-final day, the final alone.
    const matchday = nr <= 12 ? Math.ceil(nr / 4) : nr <= 14 ? 4 : 5;
    // Every venue and referee, the two retired since among them: a retired row still stands on the
    // fixtures it served.
    const played = { datum: day(FINISHED_MATCHDAYS[matchday - 1]), uhrzeit: "15:00:00", booking: booked(nr % 4, nr % 4) };
    // Within a group matchday group A's two pairs come first, then group B's in the same order.
    return nr <= 12 ? { ...played, tore: GROUP_SCORES[(matchday - 1) * 2 + ((nr - 1) % 2)] } : { ...played, ...KNOCKOUT_SCORES[nr] };
  },
  knockout: { halbfinale1: ["Ahorn", "Esche"], halbfinale2: ["Ulme", "Birke"], finale: ["Ahorn", "Birke"] },
});

// The running season, new groups. Matchday 1 is played and holds a forfeit, matchday 2 is today,
// matchday 3 is next week, and the knockout is drawn with nobody in it yet.
const running = season({
  id: "2027",
  status: "active",
  start: day(-35),
  end: day(120),
  drawn: day(-40),
  groups: { A: ["Ahorn", "Eiche", "Ulme", "Kastanie"], B: ["Birke", "Linde", "Esche", "Weide"] },
  dates: [
    [day(-14), day(-10)],
    [day(-2), day(2)],
    [day(5), day(9)],
    [null, null],
    [null, null],
  ],
  play: (nr) => {
    const booking = booked(nr % 3, nr % 3);
    switch (nr) {
      // Matchday 1, two weeks ago.
      case 1:
        return { datum: day(-14), uhrzeit: "15:00:00", booking, tore: [2, 1] };
      case 2:
        return { datum: day(-14), uhrzeit: "15:00:00", booking, tore: [0, 0] };
      case 3:
        // The away side never turned up: the season's award, as the editor composes it.
        return { datum: day(-13), uhrzeit: "16:30:00", booking, tore: [3, 0], sonderereignis: "nichtantreten_team2" };
      case 4:
        return { datum: day(-13), uhrzeit: "16:30:00", booking, tore: [1, 3] };
      // Matchday 2, today: played this morning, still to come, and called off.
      case 5:
        return { datum: day(0), uhrzeit: "09:30:00", booking, tore: [1, 2] };
      case 6:
        return { datum: day(0), uhrzeit: "16:00:00", booking };
      case 7:
        return { datum: day(0), uhrzeit: "17:30:00", booking };
      case 8:
        return { datum: day(0), uhrzeit: "11:00:00", booking, sonderereignis: "ausgefallen" };
      // Matchday 3, next week, one fixture not yet dated or booked.
      case 10:
        return {};
      case 9:
      case 11:
        return { datum: day(7), uhrzeit: "17:00:00", booking };
      case 12:
        // Not match 9's ground and referee, which its index would give: 90 minutes after it, inside the four
        // hours the write keeps between two fixtures (`REQ-CLASH-001`). No other fixture that day holds these.
        return { datum: day(7), uhrzeit: "18:30:00", booking: booked(1, 1) };
      // The knockout: drawn, undated, nobody in it.
      default:
        return {};
    }
  },
});

// --- Writing it ----------------------------------------------------------------------------------

const DOCUMENTS = {
  teams: CLUBS,
  spielorte: VENUES,
  schiedsrichter: REFEREES,
  berechtigungen: GRANTS,
  saisons: [finished.saison, running.saison],
  saison_teams: [...finished.saisonTeams, ...running.saisonTeams],
  spieltage: [...finished.spieltage, ...running.spieltage],
  spiele: [...finished.spiele, ...running.spiele],
};

// Emptied rather than dropped: the backend's boot made each collection with its validator and its
// indexes, and a dropped collection would be re-created by the first insert with neither.
for (const name of db.getCollectionNames()) {
  if (name.startsWith("system.")) continue;
  const removed = db.getCollection(name).deleteMany({}).deletedCount;
  if (removed > 0) print(`emptied ${name}: ${removed} document(s)`);
}

// Ordered: an insert the validator refuses throws with the server's own account of the field, and
// mongosh exits non-zero on it.
for (const [name, documents] of Object.entries(DOCUMENTS)) {
  const inserted = db.getCollection(name).insertMany(documents, { ordered: true }).insertedIds;
  print(`seeded ${name}: ${Object.keys(inserted).length} document(s)`);
}

print(`made-up seed written to '${db.getName()}', today being ${TODAY}`);
