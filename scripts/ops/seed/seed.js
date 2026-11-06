// SCRIPTS · the made-up seed: a league nobody plays in, for daily work and the end-to-end journeys.
//
// Three seasons, ten clubs, five venues, four referees the fixtures book and the journeys' own people, an
// owner and four administrators, every one of them invented, so no machine needs production's personal
// data to show a page in each of its states. The states are the ones the Spielplan, the sign-in, the
// match editor, the Spielorte table and the applications, teams and players pages draw:
//
// - a finished season: every fixture played, the match for third place among them, the final decided on
//   penalties;
// - the running season: a played matchday holding a forfeit, today's matchday holding a played, an
//   open and a cancelled fixture, next week's matchday holding an undated fixture, and a knockout
//   round drawn but not yet decided; its registration link open past the window's end, one squad at its
//   cap beside a nominee and a retired nominee, and a departed club with an open fixture and a live link;
// - a planned season: its application window open today, one group full and the others with room, and
//   applications whose seats stand in every state;
// - venues with and without rent, one retired and one with a name long enough to test a row's width;
//   referees, every one with the address both referee payloads require, one retired and one unanswered;
// - one club's confirmed Trainer, whose decline proposes another day for next week's fixture, standing on the
//   Übersicht for „Übernehmen“ and „Verwerfen“;
// - an owner and four administrators;
// - a retired club, and clubs still in the league the planned season has not entered.
//
// Every journey that writes signs in as a person no other journey signs in as, since one journey's
// writes would change what another reads (https://playwright.dev/docs/auth). One administrator per
// end-to-end project (`fl_frontend/playwright.config.ts`), the third the desktop journey's whose save
// meets the proxy signed out (`fl_frontend/e2e/desktop/signedOutSave.spec.ts`), and the fourth the
// administration's journeys' one session, set up once (`fl_frontend/e2e/support/administrator.setup.ts`): each sets up
// its own passkey, which no other journey could then answer. The referees `journeyPerson` writes, each one
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
// - Every link a seat, a registration or an invitation holds opens at `?token=made-up-<label>`, `linkHash`'s label,
//   so a drive reads each state of a link page. The token is no secret: its hash stands in this made-up stack alone.

/* global db, ObjectId, print, require */

const GERMANY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 24 * 60 * 60 * 1000;
const { createHash } = require("crypto");

// `en-CA` spells a date as the stored `YYYY-MM-DD`; the arithmetic runs on that day's UTC midnight,
// so a daylight-saving change between today and the offset moves no date.
const TODAY = GERMANY.format(new Date());

/** The German calendar day `offset` days from today, as every stored date spells one. */
function day(offset) {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** The hash of the link `?token=made-up-<label>` opens, as `fl_backend/app/shared/tokens.py :: hash_token` stores one. */
function linkHash(label) {
  return createHash("sha256").update(`made-up-${label}`, "utf8").digest("hex");
}

function address(street, house_number, postcode, district) {
  return { street, house_number, postcode, district, city: "Frankfurt am Main" };
}

// --- The clubs -----------------------------------------------------------------------------------

function clubRow(name, index) {
  return {
    _id: ObjectId(),
    name,
    shorthand: name.slice(0, 3).toUpperCase(),
    description: "",
    full_name: `${name}-Gymnasium`,
    website_url: null,
    address: address("Schulweg", String(index + 1), `6031${index}`, "Nordend"),
    schulform: index % 2 === 0 ? "gymnasium_g9" : "gesamtschule",
    inactive_since: null,
  };
}

// Pappel joined through its application for the planned season. Buche left the league and stands in no season, the
// retired filter being the one way back to it.
const CLUBS = ["Ahorn", "Birke", "Eiche", "Linde", "Ulme", "Esche", "Kastanie", "Weide", "Pappel", "Buche"].map(clubRow);

const club = Object.fromEntries(CLUBS.map((row) => [row.name, row]));
club.Buche.inactive_since = day(-400);

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
  const street = joinPresent([address.street, address.house_number], " ");
  const locality = joinPresent([address.postcode, address.district, address.city], " ");
  return `${name}, ${joinPresent([street, locality], ", ")}, Deutschland`;
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
  return { _id: ObjectId(), name, schule, default_payment: payment, kontakt: { phone: null, email }, inactive_since: inactiveSince };
}

/**
 * The instant opening `isoDay` in Germany, as `fl_backend/app/api/schiedsrichter/services.py :: erase_at_from` stores
 * it. The offset read at that day's UTC midnight is the one in force at its German midnight: Germany changes its
 * clocks at 01:00 UTC, after both.
 */
function germanMidnight(isoDay) {
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${isoDay}T00:00:00Z`))
    .find((part) => part.type === "timeZoneName").value;
  return new Date(`${isoDay}T00:00:00${zone.slice("GMT".length)}`);
}

// The link's deadline, fourteen days after the mail that owed it
// (`fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_CONFIRMATION_DEADLINE_DAYS`).
const LINK_DAYS = 14;

/**
 * The block every owed link writes (`fl_backend/app/api/schiedsrichter/services.py :: compose_mint_update`), owed on
 * the day `sentOn` days from today. No hash: the seed owes no mail, and the hand-out writes one only as it mints a link.
 */
function confirmationBlock(sentOn) {
  return { token_hashes: [], sent_at: day(sentOn), reminded_at: null, deadline: day(sentOn + LINK_DAYS) };
}

// Every person's consent as their own confirmation wrote it, on one day, each choice evidenced under its wording's
// label (`fl_frontend/src/core/consentWordings.ts`): a pupil's (`SPIELER_TEXT_VERSIONS`), whose media wording every
// kind shares.
const CONSENTED = day(-60);
const LABELS = { scope: "2026-11-name-kader-1", media: "2026-11-medien-1" };

/**
 * A referee as their own confirmation leaves the row
 * (`fl_backend/app/api/schiedsrichter/services.py :: compose_confirmation_update`), in its one write: the birthdate and
 * the consent, the name kept off the public pages and no media, its name's choice under the referees' own wording
 * (`SCHIEDSRICHTER_TEXT_VERSIONS`), and no deletion date. Every referee a fixture books is one, as the booking refuses
 * any other (`booking_unconfirmed_schiedsrichter`).
 */
function confirmed(row) {
  const evidence = (textVersion) => ({ at: `${CONSENTED}T10:00:00+00:00`, text_version: textVersion });
  return {
    ...row,
    confirmation: confirmationBlock(-62),
    birth_date: day(-20 * 365),
    einwilligung: {
      scope: "internal",
      date: CONSENTED,
      confirmed_at: CONSENTED,
      media: false,
      evidence: { scope: evidence("2026-11-name-spielplan-1"), media: evidence(LABELS.media) },
    },
  };
}

/**
 * A referee entered three days ago who has not answered: the create's block, and the deletion date its link sets
 * (`fl_backend/app/core/constraints.py :: TTL_INDEXES`), the midnight after the deadline.
 */
function unanswered(row) {
  return { ...row, confirmation: confirmationBlock(-3), erase_at: germanMidnight(day(-3 + LINK_DAYS + 1)) };
}

// A journey's person: a confirmed referee no fixture books. A referee row is its person's own only once confirmed
// (`fl_backend/app/api/identity/services.py :: is_own_schiedsrichter`), so an address change or an erasure moves
// nothing of a row without one.
function journeyPerson(name, email) {
  return confirmed(referee(name, null, 20, email, null));
}

const REFEREES = [
  confirmed(referee("Anna Ahrens", "Ahorn-Gymnasium", 20, "anna.ahrens@example.com", null)),
  confirmed(referee("Ben Brandt", null, 25, "ben.brandt@example.com", null)),
  confirmed(referee("Carla Conrad", "Ulme-Gymnasium", 20, "carla.conrad@example.com", null)),
  confirmed(referee("Dieter Dorn", null, 15, "dieter.dorn@example.com", day(-90))),
  // After every referee a fixture books, so no fixture's booking (`booked`, by index) changes.
  unanswered(referee("Elif Engin", "Weide-Gymnasium", 20, "elif.engin@example.com", null)),
  // The journeys' own. Each project's account acts (`fl_frontend/e2e/accountActs.spec.ts`), in its order: the person
  // signed in on a second device, the one whose address changes, and the one who deletes the account.
  journeyPerson("Frieda Falk", "frieda.falk@example.com"),
  journeyPerson("Clara Kranz", "clara.kranz@example.com"),
  journeyPerson("Hanna Hahn", "hanna.hahn@example.com"),
  journeyPerson("Gustav Gerber", "gustav.gerber@example.com"),
  journeyPerson("Dora Dahl", "dora.dahl@example.com"),
  journeyPerson("Ingo Imhof", "ingo.imhof@example.com"),
  // The desktop passkey journeys' (`fl_frontend/e2e/desktop/accountPasskeys.spec.ts`), one each.
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
  ["admin@example.com", "administration"],
].map(([address, admin_tier]) => ({
  _id: ObjectId(),
  address,
  admin_tier,
  granted_by: "MADE-UP-SEED",
  granted_at: GRANTED_AT,
  seen_at: GRANTED_AT,
}));

// The announced record of each, keyed by its grant's id: `fl_backend/app/api/berechtigungen/services.py :: compose_announced`.
const ANNOUNCED = GRANTS.map(({ _id, address, admin_tier }) => ({ _id, address, admin_tier, announced_at: GRANTED_AT }));

// --- Seasons -------------------------------------------------------------------------------------

// Two groups of four and a knockout of four: the smallest shape holding every phase a page draws.
const RULES = {
  win_points: 3,
  draw_points: 1,
  loss_points: 0,
  qualifiers_per_gruppe: 2,
  number_of_gruppen: 2,
  teams_per_gruppe: 4,
  tiebreak_order: "tordifferenz",
  max_kader_size: 18,
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

// A fixture stores who plays and the goals alone: every read joins the names.
function side(name, tore) {
  return { team_id: club[name]._id, tore };
}

function booked(venueIndex, refereeIndex) {
  const spielort = VENUES[venueIndex];
  const schiedsrichter = REFEREES[refereeIndex];
  return {
    spielort: { spielort_id: spielort._id, mietpreis: spielort.default_mietpreis },
    schiedsrichter: { schiedsrichter_id: schiedsrichter._id, payment: schiedsrichter.default_payment },
  };
}

const UNBOOKED = { spielort: null, schiedsrichter: null };

/**
 * One season's documents, numbered as the draw numbers them. `groups` names each group's four clubs
 * in draw order, `dates` each matchday's span, `play` what happened in the fixture of a number, and
 * `knockout` who stands in each knockout fixture, where anybody does yet.
 */
// One per row of a season, a colour being one team's.
const SEASON_COLOURS = ["blau", "gruen", "rot", "gelb", "orange", "weiss", "schwarz", "grau"];

function season({ id, status, start, end, drawn, groups, dates, play, knockout = {} }) {
  const spieltage = [];
  const spiele = [];
  let spielNr = 1;

  const spieltag = (phase, position, [start, end]) => {
    const row = { _id: ObjectId(), start, end, saison_phase: phase, saison_id: id, position };
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
      date: happened.date ?? null,
      time: happened.time ?? null,
      ...(happened.booking ?? UNBOOKED),
      ergebnis: happened.tore ? `${tore1}:${tore2}` : null,
      elfmeterschiessen: happened.elfmeterschiessen ?? null,
      sonderereignis: happened.sonderereignis ?? null,
      note: null,
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
    spielplan: { generated_at: drawn },
    bewerbung: null,
    registrierung: null,
  };

  const saisonTeams = Object.entries(groups)
    .flatMap(([gruppe, names]) => names.map((name) => ({ gruppe, name })))
    .map(({ gruppe, name }, index) => ({
      _id: ObjectId(),
      saison_id: id,
      team_id: club[name]._id,
      gruppe,
      austritt: null,
      trikot_farbe: SEASON_COLOURS[index],
      kontakte: null,
      name,
      shorthand: club[name].shorthand,
    }));

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
      date: day(FINISHED_MATCHDAYS[matchday - 1]),
      time: nr === 15 ? "13:00:00" : "15:00:00",
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
        return { date: day(-14), time: "15:00:00", booking, tore: [2, 1] };
      case 2:
        return { date: day(-14), time: "15:00:00", booking, tore: [0, 0] };
      case 3:
        // The away side never turned up: the season's award, as the editor composes it.
        return { date: day(-13), time: "16:30:00", booking, tore: [3, 0], sonderereignis: "nichtantreten_team2" };
      case 4:
        return { date: day(-13), time: "16:30:00", booking, tore: [1, 3] };
      // Matchday 2, today: played this morning, still to come, and called off.
      case 5:
        return { date: day(0), time: "09:30:00", booking, tore: [1, 2] };
      case 6:
        return { date: day(0), time: "16:00:00", booking };
      case 7:
        return { date: day(0), time: "17:30:00", booking };
      case 8:
        return { date: day(0), time: "11:00:00", booking, sonderereignis: "ausgefallen" };
      // Matchday 3, next week, one fixture not yet dated or booked.
      case 10:
        return {};
      case 9:
      case 11:
        return { date: day(7), time: "17:00:00", booking };
      case 12:
        // Not match 9's ground and referee, which its index would give: 90 minutes after it, inside the four
        // hours the write keeps between two fixtures (`spiel_double_booked`). No other fixture that day holds these.
        return { date: day(7), time: "18:30:00", booking: booked(1, 1) };
      // The knockout: drawn, undated, nobody in it.
      default:
        return {};
    }
  },
});

// The registration window ended the day before the season began, and its link stays open: an entry now is a nominee
// (`fl_backend/app/api/saisons/services.py :: entry_is_a_nominee`).
running.saison.registrierung = { open: true, end: day(-36) };

// --- A seat's person and link ---------------------------------------------------------------------

// Every phone its own: the form refuses two people one number (`find_repeated_contact_refusal`).
let seatedPeople = 0;

/** A person as the form or the league seats them, nobody having answered (`fl_backend/app/api/bewerbungen/services.py :: compose_einwilligung`). */
function seated(firstName, lastName, enteredOn, enteredBy, email = `${firstName}.${lastName}@example.com`.toLowerCase()) {
  seatedPeople += 1;
  return {
    first_name: firstName,
    last_name: lastName,
    email,
    phone: `+49 170 ${2000000 + seatedPeople}`,
    birth_date: null,
    einwilligung: { scope: "kontakt_data", date: day(enteredOn), confirmed_at: null, media: false, entered_by: enteredBy },
  };
}

/**
 * The same person after their own link (`fl_backend/app/api/bewerbungen/services.py :: compose_confirmation_update`): no
 * WhatsApp and no media, each choice evidenced under a seat's wordings
 * (`fl_backend/app/shared/schemas/einwilligung.py :: FLSeatTextVersions`).
 */
function confirmedPerson(person, answeredOn) {
  const receipt = (textVersion) => ({ at: `${day(answeredOn)}T10:00:00+00:00`, text_version: textVersion });
  return {
    ...person,
    birth_date: day(-40 * 365),
    einwilligung: {
      ...person.einwilligung,
      confirmed_at: day(answeredOn),
      evidence: { scope: receipt("2026-11-whatsapp-1"), media: receipt(LABELS.media) },
    },
  };
}

/**
 * A seat's bookkeeping beside its slot. An application's link takes one reminder
 * (`fl_backend/app/api/bewerbungen/services.py :: compose_bestaetigung`); a season row's is chased by nothing, and its
 * record model refuses the key (`fl_backend/app/api/teams/services.py :: compose_kontakt_confirmation`).
 */
function seatLink({ label, sentOn, reminded }, { remindedOn = null, declinedOn = null } = {}) {
  return {
    token_hashes: [linkHash(label)],
    sent_at: day(sentOn),
    deadline: day(sentOn + LINK_DAYS),
    ...(reminded ? { reminded_at: remindedOn === null ? null : day(remindedOn) } : {}),
    declined_at: declinedOn === null ? null : day(declinedOn),
  };
}

// Each state a seat stands in, as the pair of its slot and its entry, built from the `mail` `seats` hands it.
const openSeat =
  (firstName, lastName, { remindedOn, email } = {}) =>
  (mail) => [seated(firstName, lastName, mail.sentOn, mail.enteredBy, email), seatLink(mail, { remindedOn })];
const confirmedSeat = (firstName, lastName) => (mail) => [
  confirmedPerson(seated(firstName, lastName, mail.sentOn, mail.enteredBy), mail.sentOn + 1),
  seatLink(mail),
];
// A Widerspruch empties the slot and keeps its day beside it.
const objectedSeat = (declinedOn) => (mail) => [null, seatLink(mail, { declinedOn })];
// An erasure takes the slot and the entry with it.
const erasedSeat = () => () => [null, null];

/** The two blocks a record's seats fill. A Trainer's second seat is that person's, one link answering both. */
function seats(mail, states, trainerIsAlso = null) {
  const filled = Object.fromEntries(Object.entries(states).map(([seat, state]) => [seat, state({ ...mail, label: `${mail.owner}-${seat}` })]));
  const every = trainerIsAlso === null ? filled : { ...filled, [trainerIsAlso]: filled.trainer };
  const part = (index) => Object.fromEntries(Object.entries(every).map(([seat, pair]) => [seat, pair[index]]));
  return { kontakte: { ...part(0), trainer_is_also: trainerIsAlso }, confirmations: part(1) };
}

function rowSeats(owner, sentOn, states) {
  return seats({ owner, sentOn, enteredBy: "liga", reminded: false }, states);
}

// --- A club out of the running season, and a report on its first match ---------------------------

// Weide stayed away from match 3 and is disqualified since: it keeps its group place and its drawn fixtures, match 12
// still to play, as a departed club does (`docs/domain.md`, "A departed club holding drawn fixtures"). Its open seat's
// link takes a Widerspruch alone (`fl_backend/app/api/bewerbungen/services.py :: saison_state_of`).
Object.assign(
  running.saisonTeams.find((row) => row.name === "Weide"),
  {
    austritt: { type: "disqualifikation", reason: "Nicht zum Spiel angetreten", date: day(-12) },
    ...rowSeats("weide", -5, {
      trainer: confirmedSeat("Wiebke", "Wagner"),
      ansprechperson: openSeat("Willi", "Wendt"),
      stellvertretung: objectedSeat(-2),
    }),
  },
);

// --- A club's Kontakt, and the date it proposes ---------------------------------------------------

// Birke's Trainer, seated by the league and confirmed through her own link.
const TRAINERIN = confirmedPerson(seated("Berta", "Birkner", -62, "liga"), -60);
running.saisonTeams.find((row) => row.name === "Birke").kontakte = {
  trainer: TRAINERIN,
  ansprechperson: null,
  stellvertretung: null,
  trainer_is_also: null,
};

// The digest of a fixture's Ansetzung, as `fl_backend/app/api/spielbestaetigungen/services.py :: _digest` writes it: a
// row whose `stand` is not its fixture's is about a slot the fixture left, which neither act takes.
function ansetzungOf(spiel) {
  const values = {
    date: spiel.date,
    time: spiel.time,
    spielort_id: spiel.spielort.spielort_id,
    team1_id: spiel.team1.team_id,
    team2_id: spiel.team2.team_id,
  };
  const canonical = Object.values(values)
    .map((value) => (typeof value === "string" ? value : value.toHexString()))
    .join("|");
  return { ...values, stand: createHash("sha256").update(canonical, "utf8").digest("hex") };
}

// Match 11, Birke against Linde next week, asked about two weeks ago, as the pass asks a fixture three weeks out
// (`:: last_request_day`) and dates its deadline a week ahead of it (`:: deadline_of`), and declined by Birke's
// Trainer three days ago for the next day at the same hour, which clashes with no other fixture's ground or referee.
// The link she pressed is the seed's fiction, so her seat holds no hash: the seed owes no mail.
const PROPOSED = running.spiele.find((row) => row.spiel_nr === 11);
const PROPOSALS = [
  {
    _id: ObjectId(),
    saison_id: "2027",
    spiel_id: PROPOSED._id,
    party: { kind: "team", team_id: club.Birke._id },
    ansetzung: ansetzungOf(PROPOSED),
    deadline: day(0),
    asked_at: day(-14),
    reminded_at: null,
    kontakte: { trainer: { token_hashes: [], email: TRAINERIN.email }, ansprechperson: null, stellvertretung: null },
    answer: {
      kind: "declined",
      at: day(-3),
      by: { kind: "kontakt", rolle: "trainer" },
      vorschlag: { date: day(8), time: PROPOSED.time },
      reason: "Am Spieltag ist unsere Halle belegt.",
    },
    closed: null,
  },
];

// Match 12, Esche against Weide next week, asked of its referee like match 11 and unanswered: the first pass closes the
// row for Weide's exit and owes him the Einteilung's lifting
// (`fl_backend/app/api/spielbestaetigungen/services.py :: notice_owed`), the one mail of the kind a journey can read.
const LIFTED = running.spiele.find((row) => row.spiel_nr === 12);
const ASKED_REFEREE = {
  _id: ObjectId(),
  saison_id: "2027",
  spiel_id: LIFTED._id,
  party: { kind: "schiedsrichter", schiedsrichter_id: LIFTED.schiedsrichter.schiedsrichter_id },
  ansetzung: ansetzungOf(LIFTED),
  deadline: day(0),
  asked_at: day(-14),
  reminded_at: null,
  kontakte: null,
  answer: null,
  closed: null,
};

// The erased pupils' sentinel, as `fl_backend/app/api/spieler/services.py :: build_ghost_spieler` writes it.
const GHOST_SPIELER = {
  _id: ObjectId("000000000000000000000001"),
  first_name: null,
  last_name: null,
  einwilligung: null,
  birth_date: null,
};

// Each pupil's consent, publishing the name and no media, under the labels above `REFEREES`.
function pupil(firstName, lastName, consentedOn = CONSENTED) {
  const evidence = (choice) => ({ at: `${consentedOn}T10:00:00+00:00`, text_version: LABELS[choice] });
  return {
    _id: ObjectId(),
    first_name: firstName,
    last_name: lastName,
    email: `${firstName}.${lastName}@schule.example`.toLowerCase(),
    birth_date: day(-16 * 365),
    einwilligung: {
      scope: "kader_public",
      date: consentedOn,
      confirmed_at: consentedOn,
      media: false,
      evidence: { scope: evidence("scope"), media: evidence("media") },
    },
  };
}

const PUPILS = { mia: pupil("Mia", "Ahornberg"), jonas: pupil("Jonas", "Ahornberg"), lena: pupil("Lena", "Kastner") };

function squadRow(person, clubName, nummer, { position = "Angriff", nominee = false, retiredOn = null } = {}) {
  return {
    _id: ObjectId(),
    spieler_id: person._id,
    saison_id: "2027",
    team_id: club[clubName]._id,
    is_nachnominiert: nominee,
    rolle: null,
    stufe: "Q2",
    position,
    nummer,
    inactive_since: retiredOn === null ? null : day(retiredOn),
  };
}

// With Mia and Jonas, Ahorn's squad fills `RULES.max_kader_size`, so a full squad and a nominee outside its count stand
// together (`fl_backend/app/api/spieler/services.py :: CAPPED_SQUAD_ROW`), and the retired nominee's reactivation
// passes the cap.
const POSITIONS = ["Tor", "Abwehr", "Mittelfeld", "Angriff"];
const AHORN_SQUAD = [
  ["Noah", "Adler"],
  ["Lea", "Bauer"],
  ["Finn", "Claus"],
  ["Emma", "Dietz"],
  ["Paul", "Ebert"],
  ["Lina", "Fuchs"],
  ["Luca", "Graf"],
  ["Nora", "Hein"],
  ["Tom", "Igel"],
  ["Ida", "Jung"],
  ["Max", "Kern"],
  ["Ella", "Lang"],
  ["Leo", "Merz"],
  ["Zoe", "Nagel"],
  ["Jan", "Ott"],
  ["Amy", "Peters"],
].map(([firstName, lastName]) => pupil(firstName, lastName));
const NOMINEE = pupil("Karl", "Quast");
const RETIRED_NOMINEE = pupil("Rosa", "Reiter");

const SQUADS = [
  squadRow(PUPILS.mia, "Ahorn", "9"),
  squadRow(PUPILS.jonas, "Ahorn", "4"),
  ...AHORN_SQUAD.map((person, index) => squadRow(person, "Ahorn", String(10 + index), { position: POSITIONS[index % POSITIONS.length] })),
  squadRow(NOMINEE, "Ahorn", "30", { nominee: true }),
  squadRow(RETIRED_NOMINEE, "Ahorn", "31", { nominee: true, retiredOn: -5 }),
  squadRow(PUPILS.lena, "Kastanie", "7"),
];

// --- The registration links and what came through them --------------------------------------------

// `fl_backend/app/api/invitations/services.py :: compose_invitation`, each minted for copying. Ahorn's and Kastanie's
// stay open past the window's end, and Weide's opens as the link no longer valid
// (`fl_backend/app/api/registrierungen/services.py :: find_team_departed_refusal`).
function invitation(clubName) {
  return {
    _id: ObjectId(),
    saison_id: "2027",
    team_id: club[clubName]._id,
    token_hashes: [linkHash(`${clubName.toLowerCase()}-invitation`)],
    created_at: day(-30),
    created_by: "admin@example.com",
    revoked_at: null,
    sent_at: null,
  };
}

const INVITATIONS = { Ahorn: invitation("Ahorn"), Kastanie: invitation("Kastanie"), Weide: invitation("Weide") };

// `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS`.
const REGISTRATION_LINK_DAYS = 7;

/**
 * One pupil's row through Kastanie's link (`fl_backend/app/api/registrierungen/services.py :: compose_registrierung`),
 * past the window's end, so its admission makes a nominee.
 */
function registration(person, submittedOn, { confirmed = false, decision = null } = {}) {
  return {
    _id: ObjectId(),
    saison_id: "2027",
    team_id: club.Kastanie._id,
    invitation_id: INVITATIONS.Kastanie._id,
    submitted_at: day(submittedOn),
    status: decision === null ? "submitted" : "declined",
    first_name: person.first_name,
    last_name: person.last_name,
    email: person.email,
    position: "Abwehr",
    nummer: null,
    stufe: "Q2",
    birth_date: confirmed ? person.birth_date : null,
    einwilligung: confirmed ? person.einwilligung : null,
    confirmation: {
      token_hashes: [linkHash(`${person.first_name.toLowerCase()}-registration`)],
      sent_at: day(submittedOn),
      reminded_at: null,
      deadline: day(submittedOn + REGISTRATION_LINK_DAYS),
    },
    decision,
  };
}

const REGISTRATIONS = [
  registration(pupil("Ole", "Sommer"), -1),
  registration(pupil("Pia", "Sander", day(-2)), -3, { confirmed: true }),
  registration(pupil("Ben", "Stark"), -4, { decision: { made_at: day(-2), by: "admin@example.com", reason: "Nicht an dieser Schule" } }),
];

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
      scorers: [
        { side: "team1", spieler_id: PUPILS.mia._id, minute: "12", eigentor: false },
        { side: "team2", spieler_id: GHOST_SPIELER._id, minute: "40", eigentor: false },
        { side: "team1", spieler_id: null, minute: "45+2", eigentor: false },
      ],
      cards: [
        { side: "team2", spieler_id: PUPILS.lena._id, minute: "33", colour: "gelb", reason: "foulspiel" },
        { side: "team1", spieler_id: PUPILS.jonas._id, minute: "78", colour: "rot", reason: null },
      ],
      remarks: null,
      sides: { team1: REPORTED.team1.team_id, team2: REPORTED.team2.team_id },
      submitted_at: SENT,
      submitted_by: { kind: "schiedsrichter", schiedsrichter_id: REPORTED.schiedsrichter.schiedsrichter_id },
      changed_at: SENT,
      version: 1,
      adopted_at: new Date(`${day(-13)}T09:00:00Z`),
      adopted_by: { kind: "admin" },
      adopted_version: 1,
    },
  },
];

// --- The planned season ---------------------------------------------------------------------------

const PLANNED = "2028";

// The window opened a month ago and runs a month on, and the registration window ends before the season's first day,
// as its write holds it (`registrierung_window_reaches_saison_start`). Undrawn: the create writes no `spielplan` key.
// Four groups, so a full one stands beside room for every club the journeys enter (`PLANNED_ROWS`).
const PLANNED_SAISON = {
  _id: PLANNED,
  start_date: day(150),
  end_date: day(300),
  status: "future",
  rules: { ...RULES, number_of_gruppen: 4 },
  bewerbung: { open: true, start: day(-30), end: day(30) },
  registrierung: { open: true, end: day(140) },
};

function decided(madeOn, reason = null) {
  return { made_at: day(madeOn), by: "admin@example.com", reason };
}

/**
 * One application as the form stored it (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungRecord`): for the club
 * `picked`, or for the new school `school`, each seat in the state `states` names, its link mailed on the day of the
 * submission. `outcome` is what the triage moved, `owner` the link labels' head where a club applied twice.
 */
function application({ picked, school, owner, submittedOn, wunschfarbe, states, trainerIsAlso, wunschgegner = null, outcome = {} }) {
  const links = { owner: owner ?? (picked ?? school.name).toLowerCase(), sentOn: submittedOn, enteredBy: "bewerbung", reminded: true };
  return {
    _id: ObjectId(),
    saison_id: PLANNED,
    submitted_at: day(submittedOn),
    status: "submitted",
    team_id: picked === undefined ? null : club[picked]._id,
    schule:
      school === undefined
        ? null
        : {
            team_name: school.name,
            full_name: school.full_name,
            schulform: school.schulform,
            address: school.address,
            website_url: school.website_url,
          },
    ...seats(links, states, trainerIsAlso),
    trikot: { existing_set: "", wunschfarbe },
    kader: { expected_size: 14, good_spieler: 3 },
    stufengroesse: 96,
    wunschgegner,
    decision: null,
    ...outcome,
  };
}

const ACCEPTED_NEW_SCHOOL = application({
  school: club.Pappel,
  submittedOn: -20,
  wunschfarbe: "gelb",
  states: {
    trainer: confirmedSeat("Paula", "Pohl"),
    ansprechperson: confirmedSeat("Peter", "Pohl"),
    stellvertretung: confirmedSeat("Petra", "Pohl"),
  },
  outcome: { status: "accepted", team_id: club.Pappel._id, decision: decided(-4) },
});

const ACCEPTED_CLUB = application({
  picked: "Ulme",
  submittedOn: -18,
  wunschfarbe: "blau",
  states: {
    trainer: confirmedSeat("Ute", "Ullrich"),
    ansprechperson: confirmedSeat("Udo", "Ullrich"),
    stellvertretung: confirmedSeat("Uwe", "Ullrich"),
  },
  outcome: { status: "accepted", decision: decided(-4) },
});

// Its Ansprechperson's mail bounced, which the seat's row says, for an administrator to correct the address.
const BOUNCED = application({
  school: clubRow("Espe", 4),
  submittedOn: -2,
  wunschfarbe: "orange",
  states: {
    trainer: confirmedSeat("Egon", "Ehlers"),
    ansprechperson: openSeat("Edda", "Ehlers"),
    stellvertretung: openSeat("Emil", "Ehlers"),
  },
});

const APPLICATIONS = [
  // Nobody has answered.
  application({
    school: clubRow("Akazie", 0),
    submittedOn: -1,
    wunschfarbe: "rot",
    wunschgegner: "Ahorn-Gymnasium",
    states: {
      trainer: openSeat("Anton", "Albers"),
      ansprechperson: openSeat("Anke", "Albers"),
      stellvertretung: openSeat("Ali", "Albers"),
    },
  }),
  // Every seat confirmed: a new school ready for the acceptance, wishing for a colour the season has taken.
  application({
    school: clubRow("Erle", 1),
    submittedOn: -10,
    wunschfarbe: "blau",
    states: {
      trainer: confirmedSeat("Erik", "Engel"),
      ansprechperson: confirmedSeat("Erna", "Engel"),
      stellvertretung: confirmedSeat("Enno", "Engel"),
    },
  }),
  // A picked club ready for the acceptance, its Trainer holding the Ansprechperson's seat too, and the same club's
  // second application beside it, the Dublette.
  application({
    picked: "Kastanie",
    submittedOn: -9,
    wunschfarbe: "gruen",
    trainerIsAlso: "ansprechperson",
    states: { trainer: confirmedSeat("Kira", "Kolb"), stellvertretung: confirmedSeat("Kurt", "Kolb") },
  }),
  application({
    picked: "Kastanie",
    owner: "kastanie-second",
    submittedOn: -2,
    wunschfarbe: "hellgruen",
    states: {
      trainer: openSeat("Kai", "Kunze"),
      ansprechperson: openSeat("Karla", "Kunze"),
      stellvertretung: openSeat("Kim", "Kunze"),
    },
  }),
  // A confirmed seat, a reminded one and a Widerspruch, whose notice to the Ansprechperson named the deletion day.
  application({
    school: clubRow("Holunder", 2),
    submittedOn: -6,
    wunschfarbe: "violett",
    states: {
      trainer: confirmedSeat("Hilke", "Hoff"),
      ansprechperson: openSeat("Hauke", "Hoff", { remindedOn: -3 }),
      stellvertretung: objectedSeat(-2),
    },
    outcome: { erasure_announced_at: day(-2) },
  }),
  // A seat emptied by an erasure, the others' links still running.
  application({
    school: clubRow("Hasel", 3),
    submittedOn: -2,
    wunschfarbe: "tuerkis",
    states: {
      trainer: erasedSeat(),
      ansprechperson: confirmedSeat("Heike", "Hahnemann"),
      stellvertretung: openSeat("Horst", "Hahnemann"),
    },
  }),
  BOUNCED,
  // Past its deadline: the first pass, a minute after the frontend starts, erases it and mails the Ansprechperson, the
  // one deletion a journey can read.
  application({
    school: clubRow("Lärche", 6),
    owner: "laerche",
    submittedOn: -16,
    wunschfarbe: "braun",
    states: {
      trainer: confirmedSeat("Lea", "Lehmann"),
      ansprechperson: openSeat("Lutz", "Lehmann", { remindedOn: -13, email: "ansprechperson.laerche@example.com" }),
      stellvertretung: openSeat("Lisa", "Lehmann", { remindedOn: -13 }),
    },
  }),
  // Declined with a seat still open, whose link the decision ended.
  application({
    school: clubRow("Flieder", 5),
    submittedOn: -12,
    wunschfarbe: "flieder",
    states: {
      trainer: confirmedSeat("Frank", "Fink"),
      ansprechperson: confirmedSeat("Fenja", "Fink"),
      stellvertretung: openSeat("Fritz", "Fink"),
    },
    outcome: { status: "declined", decision: decided(-3, "Die Gruppen sind voll") },
  }),
  ACCEPTED_NEW_SCHOOL,
  ACCEPTED_CLUB,
];

// The last mail owed `BOUNCED`'s Ansprechperson, as its final state leaves the row
// (`fl_backend/app/api/outbox/services.py :: final_update`): it owes nothing and only says what became of the mail.
const SETTLED_MAILS = [
  {
    _id: ObjectId(),
    key: "made-up/bounced",
    kind: "bewerbung_received",
    to: BOUNCED.kontakte.ansprechperson.email,
    reference: { collection: "bewerbungen", id: BOUNCED._id, seat: "ansprechperson" },
    link: null,
    state: "sent",
    recorded_at: new Date(`${day(-2)}T09:00:00Z`),
    deadline: new Date(`${day(-1)}T09:00:00Z`),
    erase_at: new Date(`${day(30)}T09:00:00Z`),
    lease: null,
    leased_until: null,
    attempts: 1,
    message_id: "made-up-message",
    delivery: { state: "undeliverable", reason: "bounced", at: new Date(`${day(-2)}T09:05:00Z`) },
  },
];

function plannedRow(clubName, gruppe, trikotFarbe, people = { kontakte: null }) {
  const { name, shorthand, _id } = club[clubName];
  return { _id: ObjectId(), saison_id: PLANNED, team_id: _id, gruppe, austritt: null, trikot_farbe: trikotFarbe, ...people, name, shorthand };
}

// Group B is full, group A has room for the acceptance's journeys and group C for the administration's. The two accepted
// applications' clubs carry their people as the acceptance copies them, and Esche stands entered with nobody yet; Ahorn,
// Birke, Kastanie and Weide are the clubs left to enter, the journeys' rejected applications picking the first two and
// the administration's entering the others, so none holds a row.
const PLANNED_ROWS = [
  plannedRow("Ulme", "B", "blau", { kontakte: ACCEPTED_CLUB.kontakte }),
  plannedRow("Pappel", "B", "gelb", { kontakte: ACCEPTED_NEW_SCHOOL.kontakte }),
  plannedRow("Esche", "B", "gold"),
  plannedRow(
    "Eiche",
    "B",
    "rosa",
    rowSeats("eiche", -8, { trainer: confirmedSeat("Eva", "Ebner"), ansprechperson: objectedSeat(-6), stellvertretung: erasedSeat() }),
  ),
  plannedRow(
    "Linde",
    "A",
    "schwarz",
    rowSeats("linde", -2, {
      trainer: openSeat("Lars", "Lorenz"),
      ansprechperson: openSeat("Lotte", "Lorenz"),
      stellvertretung: confirmedSeat("Lukas", "Lorenz"),
    }),
  ),
];

// --- Writing it ----------------------------------------------------------------------------------

const DOCUMENTS = {
  teams: CLUBS,
  spielorte: VENUES,
  schiedsrichter: REFEREES,
  berechtigungen: GRANTS,
  saisons: [finished.saison, running.saison, PLANNED_SAISON],
  saison_teams: [...finished.saisonTeams, ...running.saisonTeams, ...PLANNED_ROWS],
  spieltage: [...finished.spieltage, ...running.spieltage],
  spiele: [...finished.spiele, ...running.spiele],
  spieler: [GHOST_SPIELER, ...Object.values(PUPILS), ...AHORN_SQUAD, NOMINEE, RETIRED_NOMINEE],
  saison_spieler: SQUADS,
  spielberichte: REPORTS,
  bewerbungen: APPLICATIONS,
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

// These are bookkeeping no form edits: outside `EDITED_COLLECTIONS`, their documents carry no `version`, and each
// record model refuses one.
const UNEDITED = {
  berechtigungen_angekuendigt: ANNOUNCED,
  einladungen: Object.values(INVITATIONS),
  registrierungen: REGISTRATIONS,
  outbox: SETTLED_MAILS,
};
for (const [name, documents] of Object.entries(UNEDITED)) {
  const inserted = db.getCollection(name).insertMany(documents, { ordered: true }).insertedIds;
  print(`seeded ${name}: ${Object.keys(inserted).length} document(s)`);
}

// The confirmations are no form's edit either, and their first carries the count the adoption's anchor advances.
const proposals = db.getCollection("spielbestaetigungen").insertMany(
  [...PROPOSALS, ASKED_REFEREE].map((document, index) => (index === 0 ? { ...document, bounded_writes: 1 } : document)),
  { ordered: true },
).insertedIds;
print(`seeded spielbestaetigungen: ${Object.keys(proposals).length} document(s)`);

print(`made-up seed written to '${db.getName()}', today being ${TODAY}`);
