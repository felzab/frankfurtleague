// SCRIPTS · the made-up seed: a league nobody plays in, for daily work and the end-to-end journeys.
//
// Two seasons, eight clubs, five venues, four referees the fixtures book and the journeys' own people, an
// owner and four administrators, every one of them invented, so no machine needs production's personal
// data to show a page in each of its states. The states are the ones the Spielplan, the sign-in, the
// match editor and the Spielorte table draw:
//
// - a finished season: every fixture played, the match for third place among them, the final decided on
//   penalties;
// - the running season: a played matchday holding a forfeit, today's matchday holding a played, an
//   open and a cancelled fixture, next week's matchday holding an undated fixture, and a knockout
//   round drawn but not yet decided;
// - venues with and without rent, one retired and one with a name long enough to test a row's width;
//   referees, every one with the address both referee payloads require, one retired;
// - an owner and four administrators.
//
// Every journey that writes signs in as a person no other journey signs in as, since one journey's
// writes would change what another reads (https://playwright.dev/docs/auth). One administrator per
// end-to-end project (`fl_frontend/playwright.config.ts`), the third the desktop journey's whose save
// meets the proxy signed out (`fl_frontend/e2e/desktop/signedOutSave.spec.ts`), and the fourth the
// administration's journey's (`fl_frontend/e2e/desktop/verwaltung.spec.ts`): each sets up its own
// passkey, which no other journey could then answer. The referees `journeyPerson` writes, each one
// journey's, are the account acts' three per project and the desktop passkey journeys' two. The owner's
// code is asked for and never typed (`fl_frontend/e2e/signin.spec.ts`).
//
// Run by `./scripts/ops/local.sh --e2e` and `--seed-made-up`, and by the journeys' CI job, with
// mongosh INSIDE the stack's own database container, at `mongodb://127.0.0.1:27017/<DB_BASE_NAME>`
// with `directConnection=true`: no other server is reachable by that address, so this script cannot
// write anywhere but the stack it is handed to. The backend has booted first, so every index is in
// place, and `python -m app.readback` judges every document afterwards; the frontend starts
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
  shorthand: name.slice(0, 3).toUpperCase(),
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
function mapsLink(name, address) {
  const strasse = joinPresent([address.strasse, address.hausnummer], " ");
  const ort = joinPresent([address.plz, address.stadtteil, address.stadt], " ");
  return `${name}, ${joinPresent([strasse, ort], ", ")}, Deutschland`;
}

function venue(name, rent, address, inactiveSince) {
  return {
    _id: ObjectId(),
    name,
    address,
    maps_link: mapsLink(name, address),
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

// Every person's consent as their own confirmation wrote it, on one day, each choice evidenced under its wording's
// label (`fl_frontend/src/core/consentWordings.ts`): a pupil's (`SPIELER_TEXT_VERSIONS`), whose media wording every
// kind shares.
const CONSENTED = day(-60);
const LABELS = { scope: "2026-11-name-kader-1", media: "2026-11-medien-1" };

// A journey's person: a referee no fixture books, as their own confirmation leaves the row
// (`fl_backend/app/api/schiedsrichter/services.py :: compose_confirmation_update`), in its one write: the birthdate and
// the consent, the name kept off the public pages and no media, its name's choice under the referees' own wording
// (`SCHIEDSRICHTER_TEXT_VERSIONS`). A referee row is its person's own only once confirmed
// (`fl_backend/app/api/identity/services.py :: is_own_schiedsrichter`), so an address change or an erasure moves
// nothing of a row without one.
function journeyPerson(name, email) {
  const evidence = (textVersion) => ({ at: `${CONSENTED}T10:00:00+00:00`, text_version: textVersion });
  return {
    ...referee(name, null, 20, email, null),
    geburtsdatum: day(-20 * 365),
    einwilligung: {
      scope: "intern",
      date: CONSENTED,
      confirmed_at: CONSENTED,
      media: false,
      evidence: { scope: evidence("2026-11-name-spielplan-1"), media: evidence(LABELS.media) },
    },
  };
}

const REFEREES = [
  referee("Anna Ahrens", "Ahorn-Gymnasium", 20, "anna.ahrens@example.com", null),
  referee("Ben Brandt", null, 25, "ben.brandt@example.com", null),
  referee("Carla Conrad", "Ulme-Gymnasium", 20, "carla.conrad@example.com", null),
  referee("Dieter Dorn", null, 15, "dieter.dorn@example.com", day(-90)),
  // The journeys' own, after every referee a fixture books, so no fixture's booking (`booked`, by index) changes. Each
  // project's account acts (`fl_frontend/e2e/accountActs.spec.ts`), in its order: the person signed in on a second
  // device, the one whose address changes, and the one who deletes the account.
  journeyPerson("Frieda Falk", "frieda.falk@example.com"),
  journeyPerson("Clara Kranz", "clara.kranz@example.com"),
  journeyPerson("Hanna Hahn", "hanna.hahn@example.com"),
  journeyPerson("Gustav Gerber", "gustav.gerber@example.com"),
  journeyPerson("Dora Dahl", "dora.dahl@example.com"),
  journeyPerson("Ingo Imhof", "ingo.imhof@example.com"),
  // The desktop passkey journeys' (`fl_frontend/e2e/desktop/kontoPasskeys.spec.ts`), one each.
  journeyPerson("Emil Ernst", "emil.ernst@example.com"),
  journeyPerson("Jana Jansen", "jana.jansen@example.com"),
];

// --- Grants --------------------------------------------------------------------------------------

// Each grant as the grant page's write leaves it (`fl_backend/app/api/berechtigungen/crud.py :: grant_in_session`):
// seen as it is written, and announced by a row of its own, so the reconciliation's first pass, a minute after the
// frontend starts, finds nothing to date afresh. Written as a Playground paste instead, each would be found then and
// dated by that moment, and every administrator's session signed in before it sent back to the sign-in on its next
// page (`docs/ops/runbooks.md` §3). Its notice is owed nobody: no administrator was told of a grant before it.
// Folded as the sign-in folds an address, or the grant admits nobody (`docs/ops/runbooks.md` §3).
const GRANTED_AT = new Date();
const GRANTS = [
  ["inhaber@example.com", "owner"],
  ["admin.desktop@example.com", "administration"],
  ["admin.telefon@example.com", "administration"],
  ["admin.editor@example.com", "administration"],
  ["admin.verwaltung@example.com", "administration"],
].map(([address, admin_tier]) => ({
  _id: ObjectId(),
  address,
  admin_tier,
  granted_by: "MADE-UP-SEED",
  granted_at: GRANTED_AT,
  gesehen_am: GRANTED_AT,
}));

// The announced record of each, keyed by its grant's id: `fl_backend/app/api/berechtigungen/services.py :: compose_announced`.
const ANNOUNCED = GRANTS.map(({ _id, address, admin_tier }) => ({ _id, address, admin_tier, angekuendigt_am: GRANTED_AT }));

// --- Seasons -------------------------------------------------------------------------------------

// Two groups of four and a knockout of four: the smallest shape holding every phase a page draws.
const RULES = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_gruppe: 2,
  number_of_gruppen: 2,
  teams_per_gruppe: 4,
  tiebreak_order: "tordifferenz",
  max_kadergroesse: 18,
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  allowed_stufen: ["E1", "Q1", "Q2", "Q3", "Q4"],
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
  // A1 meets B2 and B1 meets A2. The Finale's matchday plays both semi-finals' losers for third place,
  // then the final takes both winners, as `draw_spielplan` numbers them.
  const halbfinale = spieltag("halbfinale", 1, dates[3]);
  const [a, b] = Object.keys(groups);
  const seeded = (gruppe, platz) => ({ type: "gruppe", gruppe, platz });
  const [hf1Team1 = null, hf1Team2 = null] = knockout.halbfinale1 ?? [];
  const [hf2Team1 = null, hf2Team2 = null] = knockout.halbfinale2 ?? [];
  const [thirdTeam1 = null, thirdTeam2 = null] = knockout.thirdPlace ?? [];
  const [finalTeam1 = null, finalTeam2 = null] = knockout.finale ?? [];
  const first = spiel("halbfinale", halbfinale._id, hf1Team1, hf1Team2, [seeded(a, 1), seeded(b, 2)]);
  const second = spiel("halbfinale", halbfinale._id, hf2Team1, hf2Team2, [seeded(b, 1), seeded(a, 2)]);
  const finale = spieltag("finale", 1, dates[4]);
  const outcome = (nr, ausgang) => ({ type: "spiel", spiel_nr: nr, ausgang });
  spiel("finale", finale._id, thirdTeam1, thirdTeam2, [outcome(first, "verlierer"), outcome(second, "verlierer")]);
  spiel("finale", finale._id, finalTeam1, finalTeam2, [outcome(first, "sieger"), outcome(second, "sieger")]);

  const saison = {
    _id: id,
    start_date: start,
    end_date: end,
    status,
    rules: RULES,
    spielplan: { generated_at: drawn, spieltage: spieltage.length, spiele: spiele.length },
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
// Kastanie, Weide alike, which is who the knockout holds. The match for third place was won outright
// and the final went to penalties.
const FINISHED_MATCHDAYS = [-280, -266, -252, -210, -196];
const GROUP_SCORES = [
  [3, 0],
  [2, 1],
  [1, 1],
  [0, 2],
  [2, 1],
  [1, 0],
];
const KNOCKOUT_SCORES = {
  13: { tore: [2, 0] },
  14: { tore: [1, 2] },
  15: { tore: [3, 1] },
  16: { tore: [1, 1], elfmeterschiessen: { team1: 4, team2: 3 } },
};
const finished = season({
  id: "2026",
  status: "past",
  start: day(-300),
  end: day(-150),
  drawn: day(-310),
  groups: { A: ["Ahorn", "Birke", "Eiche", "Linde"], B: ["Ulme", "Esche", "Kastanie", "Weide"] },
  dates: FINISHED_MATCHDAYS.map((offset, index) => [day(offset), day(index < 3 ? offset + 4 : offset)]),
  play: (nr) => {
    // Four fixtures a group matchday, two a semi-final day, two the Finale's.
    const matchday = nr <= 12 ? Math.ceil(nr / 4) : nr <= 14 ? 4 : 5;
    // Every venue and referee, the two retired since among them: a retired row still stands on the
    // fixtures it served.
    // The match for third place, 15, kicks off ahead of the final.
    const played = {
      datum: day(FINISHED_MATCHDAYS[matchday - 1]),
      uhrzeit: nr === 15 ? "13:00:00" : "15:00:00",
      booking: booked(nr % 4, nr % 4),
    };
    // Within a group matchday group A's two pairs come first, then group B's in the same order.
    return nr <= 12 ? { ...played, tore: GROUP_SCORES[(matchday - 1) * 2 + ((nr - 1) % 2)] } : { ...played, ...KNOCKOUT_SCORES[nr] };
  },
  knockout: { halbfinale1: ["Ahorn", "Esche"], halbfinale2: ["Ulme", "Birke"], thirdPlace: ["Esche", "Ulme"], finale: ["Ahorn", "Birke"] },
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
        // hours the write keeps between two fixtures (`spiel_double_booked`). No other fixture that day holds these.
        return { datum: day(7), uhrzeit: "18:30:00", booking: booked(1, 1) };
      // The knockout: drawn, undated, nobody in it.
      default:
        return {};
    }
  },
});

// --- A club out of the running season, and a report on its first match ---------------------------

// Weide stayed away from match 3 and is disqualified since: it keeps its group place and its drawn fixtures, as a
// departed club does (`docs/domain.md`, "A departed club holding drawn fixtures").
running.saisonTeams.find((row) => row.name === "Weide").austritt = {
  type: "disqualifikation",
  grund: "Nicht zum Spiel angetreten",
  datum: day(-12),
};

// The erased pupils' sentinel, as `fl_backend/app/api/spieler/services.py :: build_ghost_spieler` writes it.
const GHOST_SPIELER = {
  _id: ObjectId("000000000000000000000001"),
  vorname: null,
  nachname: null,
  einwilligung: null,
  geburtsdatum: null,
  inactive_since: "2000-01-01",
};

// Each pupil's consent, publishing the name and no media, on the day and under the labels above `REFEREES`.
function pupil(vorname, nachname) {
  const evidence = (choice) => ({ at: `${CONSENTED}T10:00:00+00:00`, text_version: LABELS[choice] });
  return {
    _id: ObjectId(),
    vorname,
    nachname,
    email: `${vorname}.${nachname}@schule.example`.toLowerCase(),
    geburtsdatum: day(-16 * 365),
    einwilligung: {
      scope: "kader_oeffentlich",
      date: CONSENTED,
      confirmed_at: CONSENTED,
      media: false,
      evidence: { scope: evidence("scope"), media: evidence("media") },
    },
    inactive_since: null,
  };
}

const PUPILS = { mia: pupil("Mia", "Ahornberg"), jonas: pupil("Jonas", "Ahornberg"), lena: pupil("Lena", "Kastner") };

function squadRow(person, clubName, nummer) {
  return {
    _id: ObjectId(),
    spieler_id: person._id,
    saison_id: "2027",
    team_id: club[clubName]._id,
    is_nachnominiert: false,
    rolle: null,
    stufe: "Q2",
    position: "Angriff",
    nummer,
    inactive_since: null,
  };
}

const SQUADS = [squadRow(PUPILS.mia, "Ahorn", "9"), squadRow(PUPILS.jonas, "Ahorn", "4"), squadRow(PUPILS.lena, "Kastanie", "7")];

// Match 1, Ahorn 2:1 Kastanie two weeks ago, reported by its referee and adopted the next morning: a named scorer, a
// scorer nobody named, an erased pupil's goal under the sentinel, a caution with its reason and a red card without.
const REPORTED = running.spiele.find((row) => row.spiel_nr === 1);
const SENT = new Date(`${day(-14)}T17:00:00Z`);
const REPORTS = [
  {
    _id: ObjectId(),
    saison_id: "2027",
    spiel_id: REPORTED._id,
    bericht: {
      ergebnis_vorschlag: { team1_tore: 2, team2_tore: 1, elfmeterschiessen: null, sonderereignis: null },
      torschuetzen: [
        { seite: "team1", spieler_id: PUPILS.mia._id, minute: "12", eigentor: false },
        { seite: "team2", spieler_id: GHOST_SPIELER._id, minute: "40", eigentor: false },
        { seite: "team1", spieler_id: null, minute: "45+2", eigentor: false },
      ],
      karten: [
        { seite: "team2", spieler_id: PUPILS.lena._id, minute: "33", farbe: "gelb", grund: "foulspiel" },
        { seite: "team1", spieler_id: PUPILS.jonas._id, minute: "78", farbe: "rot", grund: null },
      ],
      bemerkungen: null,
      seiten: { team1: REPORTED.team1.team_id, team2: REPORTED.team2.team_id },
      submitted_at: SENT,
      submitted_by: { art: "schiedsrichter", schiedsrichter_id: REPORTED.schiedsrichter.schiedsrichter_id },
      changed_at: SENT,
      version: 1,
      adopted_at: new Date(`${day(-13)}T09:00:00Z`),
      adopted_by: { art: "admin" },
      adopted_version: 1,
    },
  },
];

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
  spieler: [GHOST_SPIELER, ...Object.values(PUPILS)],
  saison_spieler: SQUADS,
  spielberichte: REPORTS,
};

// Emptied rather than dropped: the backend's boot made each collection with its indexes, and a
// dropped collection would be re-created by the first insert with none.
for (const name of db.getCollectionNames()) {
  if (name.startsWith("system.")) continue;
  const removed = db.getCollection(name).deleteMany({}).deletedCount;
  if (removed > 0) print(`emptied ${name}: ${removed} document(s)`);
}

// Ordered: an insert a unique index refuses throws with the server's own account of the key, and
// mongosh exits non-zero on it; the read-back after the seed judges every document's shape. Each
// document carries the `version: 0` the backend's create stamps:
// every collection seeded here is in `fl_backend/app/core/collections.py :: EDITED_COLLECTIONS`, whose
// saves match on the version their editor was served, and none matches a document without one.
// The first of each collection `fl_backend/app/core/crud.py :: anchor_in_db` writes carries the count an
// anchor advances, as a document of the league's soon does, so the read-back judges that its record model declares it.
const ANCHORED = new Set(["teams", "spielorte", "schiedsrichter", "berechtigungen", "saisons", "saison_teams"]);
for (const [name, documents] of Object.entries(DOCUMENTS)) {
  const versioned = documents.map((document, index) => ({
    ...document,
    version: 0,
    ...(ANCHORED.has(name) && index === 0 ? { bounded_writes: 1 } : {}),
  }));
  const inserted = db.getCollection(name).insertMany(versioned, { ordered: true }).insertedIds;
  print(`seeded ${name}: ${Object.keys(inserted).length} document(s)`);
}

// The grants' announced record is bookkeeping no form edits: outside `EDITED_COLLECTIONS`, its documents carry no
// `version`, and its record model refuses one.
const announced = db.getCollection("berechtigungen_angekuendigt").insertMany(ANNOUNCED, { ordered: true }).insertedIds;
print(`seeded berechtigungen_angekuendigt: ${Object.keys(announced).length} document(s)`);

print(`made-up seed written to '${db.getName()}', today being ${TODAY}`);
