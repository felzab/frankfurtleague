import "server-only";

export const CheckIsLiveResponseValue = {
  status: "ok",
} as const;
export type CheckIsLiveResponse = typeof CheckIsLiveResponseValue;

export type Code = (typeof Code)[keyof typeof Code];

export const Code = {
  "DB-COMMON-001": "DB-COMMON-001",
  "DB-COMMON-002": "DB-COMMON-002",
  "DB-CONN-001": "DB-CONN-001",
  "DB-FAIL-001": "DB-FAIL-001",
  "DB-FAIL-002": "DB-FAIL-002",
  "REQ-ACTIVATE-001": "REQ-ACTIVATE-001",
  "REQ-ACTIVATE-002": "REQ-ACTIVATE-002",
  "REQ-ACTIVATE-003": "REQ-ACTIVATE-003",
  "REQ-ACTIVATE-004": "REQ-ACTIVATE-004",
  "REQ-ADRESSWECHSEL-001": "REQ-ADRESSWECHSEL-001",
  "REQ-ADRESSWECHSEL-002": "REQ-ADRESSWECHSEL-002",
  "REQ-ADRESSWECHSEL-003": "REQ-ADRESSWECHSEL-003",
  "REQ-ADRESSWECHSEL-004": "REQ-ADRESSWECHSEL-004",
  "REQ-ADRESSWECHSEL-005": "REQ-ADRESSWECHSEL-005",
  "REQ-ADRESSWECHSEL-006": "REQ-ADRESSWECHSEL-006",
  "REQ-ADRESSWECHSEL-007": "REQ-ADRESSWECHSEL-007",
  "REQ-ADRESSWECHSEL-008": "REQ-ADRESSWECHSEL-008",
  "REQ-ADRESSWECHSEL-009": "REQ-ADRESSWECHSEL-009",
  "REQ-ADRESSWECHSEL-010": "REQ-ADRESSWECHSEL-010",
  "REQ-ADRESSWECHSEL-011": "REQ-ADRESSWECHSEL-011",
  "REQ-ADRESSWECHSEL-012": "REQ-ADRESSWECHSEL-012",
  "REQ-ADRESSWECHSEL-013": "REQ-ADRESSWECHSEL-013",
  "REQ-ADRESSWECHSEL-014": "REQ-ADRESSWECHSEL-014",
  "REQ-ADRESSWECHSEL-015": "REQ-ADRESSWECHSEL-015",
  "REQ-ADRESSWECHSEL-016": "REQ-ADRESSWECHSEL-016",
  "REQ-ADRESSWECHSEL-017": "REQ-ADRESSWECHSEL-017",
  "REQ-ADRESSWECHSEL-018": "REQ-ADRESSWECHSEL-018",
  "REQ-ANSETZUNG-001": "REQ-ANSETZUNG-001",
  "REQ-ANSETZUNG-002": "REQ-ANSETZUNG-002",
  "REQ-ANSETZUNG-003": "REQ-ANSETZUNG-003",
  "REQ-ANSETZUNG-004": "REQ-ANSETZUNG-004",
  "REQ-ANSETZUNG-005": "REQ-ANSETZUNG-005",
  "REQ-ANSETZUNG-007": "REQ-ANSETZUNG-007",
  "REQ-ANSETZUNG-009": "REQ-ANSETZUNG-009",
  "REQ-ANSETZUNG-011": "REQ-ANSETZUNG-011",
  "REQ-ANSETZUNG-013": "REQ-ANSETZUNG-013",
  "REQ-ANSETZUNG-014": "REQ-ANSETZUNG-014",
  "REQ-ANSETZUNG-015": "REQ-ANSETZUNG-015",
  "REQ-AUTH-001": "REQ-AUTH-001",
  "REQ-AUTH-002": "REQ-AUTH-002",
  "REQ-AUTH-003": "REQ-AUTH-003",
  "REQ-AUTH-004": "REQ-AUTH-004",
  "REQ-AUTH-005": "REQ-AUTH-005",
  "REQ-AUTH-006": "REQ-AUTH-006",
  "REQ-AUTH-007": "REQ-AUTH-007",
  "REQ-AUTH-008": "REQ-AUTH-008",
  "REQ-AUTH-009": "REQ-AUTH-009",
  "REQ-BERECHTIGUNG-001": "REQ-BERECHTIGUNG-001",
  "REQ-BERECHTIGUNG-002": "REQ-BERECHTIGUNG-002",
  "REQ-BERECHTIGUNG-003": "REQ-BERECHTIGUNG-003",
  "REQ-BERECHTIGUNG-004": "REQ-BERECHTIGUNG-004",
  "REQ-BERECHTIGUNG-005": "REQ-BERECHTIGUNG-005",
  "REQ-BERECHTIGUNG-007": "REQ-BERECHTIGUNG-007",
  "REQ-BERECHTIGUNG-008": "REQ-BERECHTIGUNG-008",
  "REQ-BERECHTIGUNG-009": "REQ-BERECHTIGUNG-009",
  "REQ-BERECHTIGUNG-010": "REQ-BERECHTIGUNG-010",
  "REQ-BERECHTIGUNG-011": "REQ-BERECHTIGUNG-011",
  "REQ-BERECHTIGUNG-012": "REQ-BERECHTIGUNG-012",
  "REQ-BERICHT-001": "REQ-BERICHT-001",
  "REQ-BERICHT-002": "REQ-BERICHT-002",
  "REQ-BERICHT-003": "REQ-BERICHT-003",
  "REQ-BERICHT-004": "REQ-BERICHT-004",
  "REQ-BERICHT-005": "REQ-BERICHT-005",
  "REQ-BERICHT-006": "REQ-BERICHT-006",
  "REQ-BERICHT-007": "REQ-BERICHT-007",
  "REQ-BERICHT-008": "REQ-BERICHT-008",
  "REQ-BERICHT-009": "REQ-BERICHT-009",
  "REQ-BEWERBUNG-001": "REQ-BEWERBUNG-001",
  "REQ-BEWERBUNG-002": "REQ-BEWERBUNG-002",
  "REQ-BEWERBUNG-003": "REQ-BEWERBUNG-003",
  "REQ-BEWERBUNG-004": "REQ-BEWERBUNG-004",
  "REQ-BEWERBUNG-005": "REQ-BEWERBUNG-005",
  "REQ-BEWERBUNG-006": "REQ-BEWERBUNG-006",
  "REQ-BEWERBUNG-007": "REQ-BEWERBUNG-007",
  "REQ-BEWERBUNG-008": "REQ-BEWERBUNG-008",
  "REQ-BEWERBUNG-009": "REQ-BEWERBUNG-009",
  "REQ-BEWERBUNG-010": "REQ-BEWERBUNG-010",
  "REQ-BEWERBUNG-011": "REQ-BEWERBUNG-011",
  "REQ-BEWERBUNG-012": "REQ-BEWERBUNG-012",
  "REQ-BEWERBUNG-013": "REQ-BEWERBUNG-013",
  "REQ-BEWERBUNG-014": "REQ-BEWERBUNG-014",
  "REQ-BEWERBUNG-015": "REQ-BEWERBUNG-015",
  "REQ-BEWERBUNG-017": "REQ-BEWERBUNG-017",
  "REQ-BEWERBUNG-018": "REQ-BEWERBUNG-018",
  "REQ-BEWERBUNG-019": "REQ-BEWERBUNG-019",
  "REQ-BEWERBUNG-020": "REQ-BEWERBUNG-020",
  "REQ-BEWERBUNG-021": "REQ-BEWERBUNG-021",
  "REQ-BOOKING-001": "REQ-BOOKING-001",
  "REQ-BOOKING-002": "REQ-BOOKING-002",
  "REQ-BOOKING-003": "REQ-BOOKING-003",
  "REQ-CLASH-001": "REQ-CLASH-001",
  "REQ-DATE-001": "REQ-DATE-001",
  "REQ-DATE-002": "REQ-DATE-002",
  "REQ-DATE-003": "REQ-DATE-003",
  "REQ-DATE-004": "REQ-DATE-004",
  "REQ-DATE-005": "REQ-DATE-005",
  "REQ-DATE-008": "REQ-DATE-008",
  "REQ-DATE-009": "REQ-DATE-009",
  "REQ-DROSSELUNG-001": "REQ-DROSSELUNG-001",
  "REQ-EINLADUNG-001": "REQ-EINLADUNG-001",
  "REQ-EINLADUNG-002": "REQ-EINLADUNG-002",
  "REQ-EINLADUNG-003": "REQ-EINLADUNG-003",
  "REQ-EINWILLIGUNG-001": "REQ-EINWILLIGUNG-001",
  "REQ-EINWILLIGUNG-002": "REQ-EINWILLIGUNG-002",
  "REQ-EINWILLIGUNG-003": "REQ-EINWILLIGUNG-003",
  "REQ-EINWILLIGUNG-004": "REQ-EINWILLIGUNG-004",
  "REQ-ELIGIBILITY-001": "REQ-ELIGIBILITY-001",
  "REQ-ELIGIBILITY-002": "REQ-ELIGIBILITY-002",
  "REQ-ENTER-001": "REQ-ENTER-001",
  "REQ-ENTER-002": "REQ-ENTER-002",
  "REQ-ENTER-003": "REQ-ENTER-003",
  "REQ-ENTER-004": "REQ-ENTER-004",
  "REQ-ENTER-005": "REQ-ENTER-005",
  "REQ-FUNKTION-001": "REQ-FUNKTION-001",
  "REQ-KONTAKT-001": "REQ-KONTAKT-001",
  "REQ-KONTAKT-002": "REQ-KONTAKT-002",
  "REQ-KONTAKT-003": "REQ-KONTAKT-003",
  "REQ-KONTAKT-004": "REQ-KONTAKT-004",
  "REQ-KONTAKT-005": "REQ-KONTAKT-005",
  "REQ-KONTAKT-006": "REQ-KONTAKT-006",
  "REQ-PURGE-003": "REQ-PURGE-003",
  "REQ-PURGE-004": "REQ-PURGE-004",
  "REQ-PURGE-005": "REQ-PURGE-005",
  "REQ-PURGE-006": "REQ-PURGE-006",
  "REQ-PURGE-007": "REQ-PURGE-007",
  "REQ-REFERENZEN-001": "REQ-REFERENZEN-001",
  "REQ-REGISTRIERUNG-001": "REQ-REGISTRIERUNG-001",
  "REQ-REGISTRIERUNG-002": "REQ-REGISTRIERUNG-002",
  "REQ-REGISTRIERUNG-003": "REQ-REGISTRIERUNG-003",
  "REQ-REGISTRIERUNG-004": "REQ-REGISTRIERUNG-004",
  "REQ-REGISTRIERUNG-005": "REQ-REGISTRIERUNG-005",
  "REQ-REGISTRIERUNG-006": "REQ-REGISTRIERUNG-006",
  "REQ-REGISTRIERUNG-007": "REQ-REGISTRIERUNG-007",
  "REQ-REGISTRIERUNG-008": "REQ-REGISTRIERUNG-008",
  "REQ-REGISTRIERUNG-009": "REQ-REGISTRIERUNG-009",
  "REQ-REGISTRIERUNG-010": "REQ-REGISTRIERUNG-010",
  "REQ-REGISTRIERUNG-011": "REQ-REGISTRIERUNG-011",
  "REQ-REGISTRIERUNG-012": "REQ-REGISTRIERUNG-012",
  "REQ-REGISTRIERUNG-013": "REQ-REGISTRIERUNG-013",
  "REQ-REGISTRIERUNG-014": "REQ-REGISTRIERUNG-014",
  "REQ-REGISTRIERUNG-015": "REQ-REGISTRIERUNG-015",
  "REQ-REGISTRIERUNG-016": "REQ-REGISTRIERUNG-016",
  "REQ-REGISTRIERUNG-017": "REQ-REGISTRIERUNG-017",
  "REQ-REGISTRIERUNG-018": "REQ-REGISTRIERUNG-018",
  "REQ-REGISTRIERUNG-019": "REQ-REGISTRIERUNG-019",
  "REQ-REPLACE-001": "REQ-REPLACE-001",
  "REQ-REPLACE-002": "REQ-REPLACE-002",
  "REQ-REPLACE-003": "REQ-REPLACE-003",
  "REQ-REPLACE-004": "REQ-REPLACE-004",
  "REQ-RESULT-001": "REQ-RESULT-001",
  "REQ-RETIRE-001": "REQ-RETIRE-001",
  "REQ-RETIRE-003": "REQ-RETIRE-003",
  "REQ-RETIRE-004": "REQ-RETIRE-004",
  "REQ-ROUTE-001": "REQ-ROUTE-001",
  "REQ-ROUTE-002": "REQ-ROUTE-002",
  "REQ-RULES-001": "REQ-RULES-001",
  "REQ-RULES-002": "REQ-RULES-002",
  "REQ-RULES-003": "REQ-RULES-003",
  "REQ-RULES-004": "REQ-RULES-004",
  "REQ-RULES-005": "REQ-RULES-005",
  "REQ-RULES-006": "REQ-RULES-006",
  "REQ-RULES-007": "REQ-RULES-007",
  "REQ-RULES-008": "REQ-RULES-008",
  "REQ-RULES-009": "REQ-RULES-009",
  "REQ-RULES-010": "REQ-RULES-010",
  "REQ-RULES-011": "REQ-RULES-011",
  "REQ-RULES-012": "REQ-RULES-012",
  "REQ-RULES-013": "REQ-RULES-013",
  "REQ-RULES-014": "REQ-RULES-014",
  "REQ-RULES-015": "REQ-RULES-015",
  "REQ-RULES-016": "REQ-RULES-016",
  "REQ-RULES-017": "REQ-RULES-017",
  "REQ-RULES-018": "REQ-RULES-018",
  "REQ-SCHIEDSRICHTER-001": "REQ-SCHIEDSRICHTER-001",
  "REQ-SCHIEDSRICHTER-002": "REQ-SCHIEDSRICHTER-002",
  "REQ-SCHIEDSRICHTER-003": "REQ-SCHIEDSRICHTER-003",
  "REQ-SCHIEDSRICHTER-004": "REQ-SCHIEDSRICHTER-004",
  "REQ-SCHIEDSRICHTER-005": "REQ-SCHIEDSRICHTER-005",
  "REQ-SCHIEDSRICHTER-006": "REQ-SCHIEDSRICHTER-006",
  "REQ-SCHIEDSRICHTER-007": "REQ-SCHIEDSRICHTER-007",
  "REQ-SCHIEDSRICHTER-008": "REQ-SCHIEDSRICHTER-008",
  "REQ-SCHIEDSRICHTER-009": "REQ-SCHIEDSRICHTER-009",
  "REQ-SCHIEDSRICHTER-011": "REQ-SCHIEDSRICHTER-011",
  "REQ-SPERRLISTE-001": "REQ-SPERRLISTE-001",
  "REQ-SPERRLISTE-002": "REQ-SPERRLISTE-002",
  "REQ-SPERRLISTE-003": "REQ-SPERRLISTE-003",
  "REQ-SPERRLISTE-004": "REQ-SPERRLISTE-004",
  "REQ-SPIELPLAN-001": "REQ-SPIELPLAN-001",
  "REQ-SPIELPLAN-002": "REQ-SPIELPLAN-002",
  "REQ-SPIELPLAN-003": "REQ-SPIELPLAN-003",
  "REQ-SPIELPLAN-004": "REQ-SPIELPLAN-004",
  "REQ-SPIELPLAN-005": "REQ-SPIELPLAN-005",
  "REQ-SPIELPLAN-006": "REQ-SPIELPLAN-006",
  "REQ-SPIELPLAN-007": "REQ-SPIELPLAN-007",
  "REQ-SPIELTAG-001": "REQ-SPIELTAG-001",
  "REQ-SPIELTAG-002": "REQ-SPIELTAG-002",
  "REQ-SQUAD-001": "REQ-SQUAD-001",
  "REQ-SQUAD-003": "REQ-SQUAD-003",
  "REQ-SQUAD-004": "REQ-SQUAD-004",
  "REQ-SQUAD-005": "REQ-SQUAD-005",
  "REQ-STATE-002": "REQ-STATE-002",
  "REQ-STATE-003": "REQ-STATE-003",
  "REQ-SWAP-001": "REQ-SWAP-001",
  "REQ-SWAP-002": "REQ-SWAP-002",
  "REQ-SWAP-003": "REQ-SWAP-003",
  "REQ-SWAP-004": "REQ-SWAP-004",
  "REQ-SWAP-005": "REQ-SWAP-005",
  "REQ-SWAP-006": "REQ-SWAP-006",
  "REQ-SWAP-007": "REQ-SWAP-007",
  "REQ-VAL-001": "REQ-VAL-001",
  "REQ-VAL-002": "REQ-VAL-002",
  "REQ-WIRING-001": "REQ-WIRING-001",
  "REQ-WIRING-002": "REQ-WIRING-002",
  "REQ-WIRING-003": "REQ-WIRING-003",
  "SRV-FAIL-001": "SRV-FAIL-001",
  "SRV-VAL-001": "SRV-VAL-001",
} as const;

/**
 * Why the application was declined.
 *
 * Its own declaration and never shared with the acceptance's: the two are not inverses, and a
 * payload reaching both would let a value typed for one arrive at the other.
 */
export interface FLAblehnenBewerbungPayload {
  /**
   * @minLength 1
   * @maxLength 1000
   */
  grund: string;
}

export type FLBewerbungZustellungStand = (typeof FLBewerbungZustellungStand)[keyof typeof FLBewerbungZustellungStand];

export const FLBewerbungZustellungStand = {
  angenommen: "angenommen",
  zugestellt: "zugestellt",
  verzoegert: "verzoegert",
  unzustellbar: "unzustellbar",
  unterdrueckt: "unterdrueckt",
  beschwerde: "beschwerde",
} as const;

/**
 * What became of the last message to one seat.
 *
 * Inside the seat's block rather than a collection of its own: an erasure empties that block, so
 * this goes with the person it is about.
 */
export interface FLBewerbungZustellung {
  am: string;
  grund: string | null;
  nachricht_id: string;
  stand: FLBewerbungZustellungStand;
}

/**
 * One seat's confirmation bookkeeping as the triage reads it -- and NO `token_hash`.
 *
 * The hash is a raw document key the confirm query alone reads; a model declaring it would serve
 * it through every admin read.
 */
export interface FLBewerbungBestaetigung {
  abgelehnt_am: string | null;
  erinnert_am: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  verschickt_am: string;
  zustellung?: FLBewerbungZustellung | null;
}

/**
 * The three seats' bookkeeping, mirroring `kontakte`'s slots. Nullable per SEAT: an erasure empties the one naming the person.
 */
export interface FLBewerbungBestaetigungen {
  ansprechperson: FLBewerbungBestaetigung | null;
  stellvertretung: FLBewerbungBestaetigung | null;
  trainer: FLBewerbungBestaetigung | null;
}

/**
 * A decision as every read serves it: the stored one, its administrator withheld where the ban list holds that address.
 */
export interface FLBewerbungEntscheidungZeile {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  getroffen_am: string;
  grund: string | null;
  von: string | null;
  von_gesperrt: boolean;
}

/**
 * The school's own estimate of its squad, on the application alone.
 *
 * Unbounded on read for `FLBewerbungSchule.website_url`'s reason. Nothing checks either number
 * against a squad afterwards -- they are what the school expected, not what it fielded.
 */
export interface FLBewerbungKader {
  gute_spieler: number;
  voraussichtliche_groesse: number;
}

export type FLKontaktEingetragenVon = (typeof FLKontaktEingetragenVon)[keyof typeof FLKontaktEingetragenVon];

export const FLKontaktEingetragenVon = {
  bewerbung: "bewerbung",
  liga: "liga",
} as const;

/**
 * When a person set one consent choice, and under which wording.
 */
export interface FLEinwilligungBeleg {
  am: string;
  text_version: string;
}

/**
 * The evidence one consent choice keeps: the act that set its value, and on a withdrawal the grant it ended.
 */
export interface FLEinwilligungNachweis {
  am: string;
  erteilt_zuvor?: FLEinwilligungBeleg | null;
  text_version: string;
}

/**
 * Each choice's evidence, null until its person sets it: a record no person has answered carries none.
 */
export interface FLEinwilligungNachweise {
  medien?: FLEinwilligungNachweis | null;
  umfang?: FLEinwilligungNachweis | null;
}

export type FLKontaktKenntnisnahmeUmfang = (typeof FLKontaktKenntnisnahmeUmfang)[keyof typeof FLKontaktKenntnisnahmeUmfang];

export const FLKontaktKenntnisnahmeUmfang = {
  kontaktdaten: "kontaktdaten",
  kontaktdaten_whatsapp: "kontaktdaten_whatsapp",
} as const;

/**
 * Which wording this person was shown, and how the record came to be held.
 *
 * Kenntnisnahme and not Einwilligung: the published basis is Art. 6(1)(b)/(f), and the pupil's
 * `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` holds other values entirely
 * (`docs/glossary.md :: Einwilligung`).
 */
export interface FLKontaktKenntnisnahme {
  bestaetigt_am: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  eingetragen_von: FLKontaktEingetragenVon;
  medien: boolean;
  nachweis?: FLEinwilligungNachweise;
  text_version: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * One person the league reaches this team through, for one season.
 */
export interface FLKontaktperson {
  einwilligung: FLKontaktKenntnisnahme;
  email: string;
  geburtsdatum: string | null;
  /** @minLength 1 */
  nachname: string;
  telefon: string;
  /** @minLength 1 */
  vorname: string;
}

export type FLTrainerZugleich = (typeof FLTrainerZugleich)[keyof typeof FLTrainerZugleich];

export const FLTrainerZugleich = {
  ansprechperson: "ansprechperson",
  stellvertretung: "stellvertretung",
} as const;

/**
 * The three people a team is reached through, for ONE season.
 *
 * On the junction rather than the club: a school's staff turns over between seasons, and a
 * finished season is the record of who was reachable while it ran.
 */
export interface FLSaisonTeamKontakte {
  ansprechperson: FLKontaktperson | null;
  stellvertretung: FLKontaktperson | null;
  trainer: FLKontaktperson | null;
  trainer_ist_zugleich: FLTrainerZugleich | null;
}

export interface FLAddress {
  /** @pattern ^([0-9\-abcABC]+)?$ */
  hausnummer: string;
  /** @pattern ^[0-9]{5}$ */
  plz: string;
  /** @minLength 1 */
  stadt: string;
  stadtteil: string;
  /** @minLength 1 */
  strasse: string;
}

export type FLSchulform = (typeof FLSchulform)[keyof typeof FLSchulform];

export const FLSchulform = {
  gymnasium_g8: "gymnasium_g8",
  gymnasium_g9: "gymnasium_g9",
  gesamtschule: "gesamtschule",
  privatschule_g8: "privatschule_g8",
  privatschule_g9: "privatschule_g9",
  oberstufengymnasium: "oberstufengymnasium",
} as const;

/**
 * The club a new school proposes, in the shape acceptance will create it in.
 *
 * While the application is `eingereicht`, exactly one of this and `team_id` carries a value, held
 * by the write path rather than the validator.
 */
export interface FLBewerbungSchule {
  address: FLAddress;
  /** @minLength 1 */
  full_name: string;
  schulform: FLSchulform | null;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  /** @minLength 1 */
  team_name: string;
  website_url: string | null;
}

export type FLBewerbungStatus = (typeof FLBewerbungStatus)[keyof typeof FLBewerbungStatus];

export const FLBewerbungStatus = {
  eingereicht: "eingereicht",
  angenommen: "angenommen",
  abgelehnt: "abgelehnt",
} as const;

export type FLTrikotFarbe = (typeof FLTrikotFarbe)[keyof typeof FLTrikotFarbe];

export const FLTrikotFarbe = {
  schwarz: "schwarz",
  weiss: "weiss",
  grau: "grau",
  braun: "braun",
  bordeaux: "bordeaux",
  rot: "rot",
  koralle: "koralle",
  orange: "orange",
  gold: "gold",
  gelb: "gelb",
  limette: "limette",
  hellgruen: "hellgruen",
  gruen: "gruen",
  smaragd: "smaragd",
  tuerkis: "tuerkis",
  cyan: "cyan",
  hellblau: "hellblau",
  meerblau: "meerblau",
  blau: "blau",
  dunkelblau: "dunkelblau",
  flieder: "flieder",
  violett: "violett",
  magenta: "magenta",
  rosa: "rosa",
} as const;

/**
 * What kit the school already owns, and the colour it would like.
 *
 * Never copied onto the team: `saison_teams.trikot_farbe` is the colour an administrator ASSIGNED,
 * and two schools may wish for one colour.
 */
export interface FLBewerbungTrikot {
  vorhandener_satz: string;
  wunschfarbe: FLTrikotFarbe;
}

/**
 * One school's application to play one season, as stored, its decision as served.
 *
 * The submission is never rewritten: `status`, `entscheidung` and `team_id` move through the
 * triage, and a contact seat through the two administrative repairs in
 * `app/api/bewerbungen/admin_router.py`.
 */
export interface FLBewerbung {
  bestaetigungen: FLBewerbungBestaetigungen;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  eingereicht_am: string;
  entscheidung: FLBewerbungEntscheidungZeile | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  kader: FLBewerbungKader;
  kontakte: FLSaisonTeamKontakte;
  saison_id: string;
  schule: FLBewerbungSchule | null;
  status: FLBewerbungStatus;
  stufengroesse: number;
  team_id: string | null;
  trikot: FLBewerbungTrikot;
  wunschgegner: string | null;
}

export interface FLAblehnenBewerbungResponse {
  updated_document: FLBewerbung;
}

/**
 * The mailbox whose every session the page ends next, looked up as the erasure looks one up.
 */
export interface FLAbmeldungPayload {
  /**
   * @maxLength 254
   * @pattern @
   */
  email: string;
}

/**
 * The envelope alone: the log row it filed names no address to answer with.
 */
export interface FLAbmeldungResponse {
  [key: string]: unknown;
}

/**
 * When the league accepts applications for this season.
 *
 * The two halves that record it: the span, and the `offen` flag an administrator sets beside it.
 */
export interface FLSaisonBewerbung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bis: string;
  offen: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  von: string;
}

/**
 * When a pupil may register for this season.
 *
 * Its own model rather than an alias of `FLSaisonBewerbung` above: the two windows are two
 * decisions an administrator takes apart, and one component name on both would publish them as one.
 */
export interface FLSaisonRegistrierung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bis: string;
  offen: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  von: string;
}

export type FLSpielerStufe = (typeof FLSpielerStufe)[keyof typeof FLSpielerStufe];

export const FLSpielerStufe = {
  E1: "E1",
  E2: "E2",
  Q1: "Q1",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4",
} as const;

/**
 * What a fixture is awarded when one side does not appear.
 *
 * Both sides' goals rather than a margin, composed at `app/api/spiele/services.py :: apply_payload_to_spiel`.
 * A LEVEL award needs a season with no knockout round (`REQ-RULES-010`).
 */
export interface FLSaisonForfeitErgebnis {
  /** @minimum 0 */
  sieger_tore: number;
  /** @minimum 0 */
  verlierer_tore: number;
}

export type FLSaisonRulesTiebreakOrder = (typeof FLSaisonRulesTiebreakOrder)[keyof typeof FLSaisonRulesTiebreakOrder];

export const FLSaisonRulesTiebreakOrder = {
  tordifferenz: "tordifferenz",
  direkter_vergleich: "direkter_vergleich",
} as const;

export interface FLSaisonRules {
  /** @minimum 0 */
  draw_points: number;
  /** @minItems 1 */
  erlaubte_stufen: FLSpielerStufe[];
  forfeit_ergebnis: FLSaisonForfeitErgebnis;
  /** @exclusiveMinimum 0 */
  max_kadergroesse: number;
  /**
   * @maximum 16
   * @exclusiveMinimum 0
   */
  number_of_groups: number;
  /** @exclusiveMinimum 0 */
  qualifiers_per_group: number;
  /**
   * @minimum 2
   * @maximum 16
   */
  teams_per_group: number;
  tiebreak_order: FLSaisonRulesTiebreakOrder;
  /** @exclusiveMinimum 0 */
  win_points: number;
}

export type FLSaisonPhase = (typeof FLSaisonPhase)[keyof typeof FLSaisonPhase];

export const FLSaisonPhase = {
  gruppenphase: "gruppenphase",
  achtelfinale: "achtelfinale",
  viertelfinale: "viertelfinale",
  halbfinale: "halbfinale",
  finale: "finale",
} as const;

/**
 * One phase of a season: how many matchdays it takes, and how many matches each holds.
 *
 * A phase the bracket does not reach is ABSENT rather than present with zeroes, so the list IS the
 * phases the season plays, in playing order.
 */
export interface FLSaisonPhaseSchedule {
  /** @minimum 0 */
  matchdays: number;
  /** @minimum 0 */
  matches_per_matchday: number;
  phase: FLSaisonPhase;
}

/**
 * What the generator left behind on the season it wrote.
 *
 * Counts rather than a hash: these are the two numbers an admin can compare against the page in
 * front of them, and a hash answers no question anyone standing there is asking.
 */
export interface FLSaisonSpielplan {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  generiert_am: string;
  /** @minimum 0 */
  spiele: number;
  /** @minimum 0 */
  spieltage: number;
}

export type FLSaisonStatus = (typeof FLSaisonStatus)[keyof typeof FLSaisonStatus];

export const FLSaisonStatus = {
  past: "past",
  active: "active",
  future: "future",
} as const;

export interface FLSaison {
  bewerbung: FLSaisonBewerbung | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  /**
   * @minLength 4
   * @maxLength 4
   */
  id: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  schedule: FLSaisonPhaseSchedule[];
  spielplan?: FLSaisonSpielplan | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  status: FLSaisonStatus;
}

/**
 * The season now active, plus how many were moved off it -- normally exactly one.
 */
export interface FLActivateSaisonResponse {
  deactivated: number;
  updated_document: FLSaison;
}

export interface FLAddressPayload {
  /**
   * @maxLength 16
   * @pattern ^([0-9\-abcABC]+)?$
   */
  hausnummer: string;
  /** @pattern ^[0-9]{5}$ */
  plz: string;
  /**
   * @minLength 1
   * @maxLength 80
   */
  stadt: string;
  /** @maxLength 80 */
  stadtteil: string;
  /**
   * @minLength 1
   * @maxLength 120
   */
  strasse: string;
}

/**
 * Exactly one key: the new mailbox's link token, or the change an approval names.
 */
export interface FLAdresswechselAdressePayload {
  adresswechsel_id?: string | null;
  token?: string | null;
}

/**
 * A live change's new address and nothing else, server to server alone (`READ-ADRESSWECHSEL-002`).
 */
export interface FLAdresswechselAdresseResponse {
  email: string | null;
}

export type FLAdresswechselAnsichtBeendetSeite = (typeof FLAdresswechselAnsichtBeendetSeite)[keyof typeof FLAdresswechselAnsichtBeendetSeite];

export const FLAdresswechselAnsichtBeendetSeite = {
  neu: "neu",
  bisherig: "bisherig",
} as const;

export type FLAdresswechselEndeArt = (typeof FLAdresswechselEndeArt)[keyof typeof FLAdresswechselEndeArt];

export const FLAdresswechselEndeArt = {
  wirksam: "wirksam",
  abgelehnt: "abgelehnt",
  gestoppt: "gestoppt",
  abgelaufen: "abgelaufen",
  ersetzt: "ersetzt",
  verworfen: "verworfen",
} as const;

/**
 * What either link opens once its change ended, for as long as its record is kept.
 */
export interface FLAdresswechselAnsichtBeendet {
  art: FLAdresswechselEndeArt;
  seite: FLAdresswechselAnsichtBeendetSeite;
  zustand: "beendet";
}

export type FLAdresswechselAnsichtBisherigZustand =
  (typeof FLAdresswechselAnsichtBisherigZustand)[keyof typeof FLAdresswechselAnsichtBisherigZustand];

export const FLAdresswechselAnsichtBisherigZustand = {
  freigabe_offen: "freigabe_offen",
  offen: "offen",
  genehmigung: "genehmigung",
  wartezeit: "wartezeit",
} as const;

export type FLAdresswechselWeg = (typeof FLAdresswechselWeg)[keyof typeof FLAdresswechselWeg];

export const FLAdresswechselWeg = {
  konto: "konto",
  freigabe: "freigabe",
  wartezeit: "wartezeit",
} as const;

/**
 * What the address on file's stop link opens: the step the change waits on, never whether it could be confirmed.
 */
export interface FLAdresswechselAnsichtBisherig {
  gueltig_bis: string | null;
  seite: "bisherig";
  weg: FLAdresswechselWeg;
  wirksam_ab: string | null;
  zustand: FLAdresswechselAnsichtBisherigZustand;
}

export type FLAdresswechselAnsichtNeuZustand = (typeof FLAdresswechselAnsichtNeuZustand)[keyof typeof FLAdresswechselAnsichtNeuZustand];

export const FLAdresswechselAnsichtNeuZustand = {
  gueltig: "gueltig",
  abgelaufen: "abgelaufen",
  gesperrt: "gesperrt",
  nicht_bestaetigbar: "nicht_bestaetigbar",
  bestaetigt: "bestaetigt",
  genehmigung_abgelaufen: "genehmigung_abgelaufen",
} as const;

/**
 * What the new mailbox's link opens while the change stands.
 */
export interface FLAdresswechselAnsichtNeu {
  genehmigung_offen: boolean | null;
  gueltig_bis: string | null;
  seite: "neu";
  weg: FLAdresswechselWeg;
  wirksam_ab: string | null;
  zustand: FLAdresswechselAnsichtNeuZustand;
}

export interface FLAdresswechselAnsichtPayload {
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
}

/**
 * What one address link opens: never a name, either address or the id (`READ-ADRESSWECHSEL-001`).
 */
export interface FLAdresswechselAnsichtResponse {
  ansicht: FLAdresswechselAnsichtNeu | FLAdresswechselAnsichtBisherig | FLAdresswechselAnsichtBeendet;
}

export type FLAdresswechselAntwortPayloadAntwort =
  (typeof FLAdresswechselAntwortPayloadAntwort)[keyof typeof FLAdresswechselAntwortPayloadAntwort];

export const FLAdresswechselAntwortPayloadAntwort = {
  bestaetigt: "bestaetigt",
  abgelehnt: "abgelehnt",
} as const;

export interface FLAdresswechselAntwortPayload {
  antwort: FLAdresswechselAntwortPayloadAntwort;
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
}

export type FLAdresswechselAntwortResponseAntwort =
  (typeof FLAdresswechselAntwortResponseAntwort)[keyof typeof FLAdresswechselAntwortResponseAntwort];

export const FLAdresswechselAntwortResponseAntwort = {
  bestaetigt: "bestaetigt",
  abgelehnt: "abgelehnt",
} as const;

/**
 * The answer recorded, and no address of the change: the notices an effect owes are queued, never answered.
 */
export interface FLAdresswechselAntwortResponse {
  antwort: FLAdresswechselAntwortResponseAntwort;
  genehmigung_offen: boolean;
  wirksam: boolean;
  wirksam_ab: string | null;
}

export type FLAdresswechselEinsehbarVerwehrt = (typeof FLAdresswechselEinsehbarVerwehrt)[keyof typeof FLAdresswechselEinsehbarVerwehrt];

export const FLAdresswechselEinsehbarVerwehrt = {
  eigene: "eigene",
  verwaltung: "verwaltung",
} as const;

export interface FLAdresswechselGenehmigungResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  wirksam: boolean;
}

export type FLAdresswechselGenehmigungStandVerwaltung =
  (typeof FLAdresswechselGenehmigungStandVerwaltung)[keyof typeof FLAdresswechselGenehmigungStandVerwaltung];

export const FLAdresswechselGenehmigungStandVerwaltung = {
  administration: "administration",
  owner: "owner",
} as const;

/**
 * The approval a change of the person's own grant waits on, as their account page reads it: never who gave it.
 */
export interface FLAdresswechselGenehmigungStand {
  bis: string;
  genehmigt: boolean;
  verwaltung: FLAdresswechselGenehmigungStandVerwaltung;
}

export interface FLAdresswechselIdResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

export type FLAdresswechselPostausgangZeileArt = (typeof FLAdresswechselPostausgangZeileArt)[keyof typeof FLAdresswechselPostausgangZeileArt];

export const FLAdresswechselPostausgangZeileArt = {
  wirksam: "wirksam",
  verworfen: "verworfen",
} as const;

/**
 * One owed notice a pass claimed, server to server alone: no browser receives an address of it.
 *
 * `wirksam`: whom the completion notice greets, and the sign-in account to carry. `verworfen`: the new address alone,
 * never told why.
 */
export interface FLAdresswechselPostausgangZeile {
  art: FLAdresswechselPostausgangZeileArt;
  aufgegeben: boolean;
  bisherige_email: string | null;
  email: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  vorname: string | null;
  weg: FLAdresswechselWeg | null;
}

/**
 * The owed notices one claim holds, oldest first; `beanspruchung` and `beansprucht_bis` null exactly where it holds none.
 */
export interface FLAdresswechselPostausgangResponse {
  beansprucht_bis: string | null;
  beanspruchung: string | null;
  mitteilungen: FLAdresswechselPostausgangZeile[];
}

export interface FLAdresswechselStoppPayload {
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
}

export const FLAdresswechselStoppResponseValue = {
  gestoppt: true,
} as const;
export type FLAdresswechselStoppResponse = typeof FLAdresswechselStoppResponseValue;

/**
 * One call's share of the live changes whose step lapsed or whose waiting time ended.
 */
export interface FLAdresswechselSweepResponse {
  entfernt: number;
  nach: string | null;
  verbleibend: number;
  /** @minimum 0 */
  verworfen: number;
  /** @minimum 0 */
  wirksam: number;
}

/**
 * Exactly one key: the address typed, or the change a page links to.
 */
export interface FLAdresswechselVerwaltungAnsichtPayload {
  adresse?: string | null;
  adresswechsel_id?: string | null;
}

export type FLAdresswechselVerwaltungBestandBerechtigung =
  (typeof FLAdresswechselVerwaltungBestandBerechtigung)[keyof typeof FLAdresswechselVerwaltungBestandBerechtigung] | null;

export const FLAdresswechselVerwaltungBestandBerechtigung = {
  administration: "administration",
  owner: "owner",
} as const;

/**
 * What the address holds that a change moves, counted: the tool names the kinds, the editors the records.
 */
export interface FLAdresswechselVerwaltungBestand {
  berechtigung: FLAdresswechselVerwaltungBestandBerechtigung;
  /** @minimum 0 */
  bewerbungssitze: number;
  /** @minimum 0 */
  registrierungen: number;
  /** @minimum 0 */
  schiedsrichter: number;
  /** @minimum 0 */
  sitze: number;
  /** @minimum 0 */
  spieler: number;
}

export type FLAdresswechselVerwaltungGenehmigungVerwaltung =
  (typeof FLAdresswechselVerwaltungGenehmigungVerwaltung)[keyof typeof FLAdresswechselVerwaltungGenehmigungVerwaltung];

export const FLAdresswechselVerwaltungGenehmigungVerwaltung = {
  administration: "administration",
  owner: "owner",
} as const;

/**
 * The approval a change moving a grant waits on, read-only here: the administrators page approves it.
 *
 * Never who approved: a barred administrator's address is answered on no read.
 */
export interface FLAdresswechselVerwaltungGenehmigung {
  bis: string;
  genehmigt_am: string | null;
  verwaltung: FLAdresswechselVerwaltungGenehmigungVerwaltung;
}

export type FLAdresswechselWartetAuf = (typeof FLAdresswechselWartetAuf)[keyof typeof FLAdresswechselWartetAuf];

export const FLAdresswechselWartetAuf = {
  freigabe: "freigabe",
  neue_adresse: "neue_adresse",
  genehmigung: "genehmigung",
  wartezeit: "wartezeit",
} as const;

/**
 * The address's live change whole, admin tier: the new address and the reason included, never a hash.
 */
export interface FLAdresswechselVerwaltungOffen {
  abgelaufen: boolean;
  bestaetigt_am: string | null;
  email: string;
  freigegeben_am: string | null;
  genehmigung: FLAdresswechselVerwaltungGenehmigung | null;
  grund: string | null;
  gueltig_bis: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  verschickt_am: string;
  wartet_auf: FLAdresswechselWartetAuf;
  weg: FLAdresswechselWeg;
  wirksam_ab: string | null;
  zustellung: FLBewerbungZustellung | null;
}

export interface FLAdresswechselVerwaltungAnsichtResponse {
  adresse: string;
  bestand: FLAdresswechselVerwaltungBestand;
  moeglich: boolean;
  offen: FLAdresswechselVerwaltungOffen | null;
}

/**
 * A started or re-sent change's raw links, answered ONCE and stored nowhere, admin-tier whole.
 */
export interface FLAdresswechselVerwaltungMintResponse {
  bisherige_email: string;
  /** @minLength 1 */
  email: string;
  /** @minimum 0 */
  genehmiger_anzahl: number;
  gueltig_bis: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  stopp_token: string | null;
  token: string | null;
  vorname: string | null;
  weg: FLAdresswechselWeg;
}

/**
 * The address a change starts on, the address it goes to, and the reason where the address on file is gone.
 */
export interface FLAdresswechselVerwaltungPayload {
  /** @maxLength 254 */
  adresse: string;
  /** @maxLength 254 */
  email: string;
  grund: string | null;
}

export interface FLAdresswechselZugestelltPayload {
  /** @minLength 1 */
  beanspruchung: string;
  /**
   * @minItems 1
   * @maxItems 1024
   * @items.pattern ^[0-9a-fA-F]{24}$
   */
  ids: string[];
}

export interface FLAdresswechselZugestelltResponse {
  /** @minimum 0 */
  ignoriert: number;
  /** @minimum 0 */
  zugestellt: number;
}

export type FLAktionDbFilter = { [key: string]: string } | null;

export type FLAktionOperation = (typeof FLAktionOperation)[keyof typeof FLAktionOperation];

export const FLAktionOperation = {
  insert: "insert",
  insert_many: "insert_many",
  patch_one: "patch_one",
  patch_many: "patch_many",
  delete_many: "delete_many",
  erase_many: "erase_many",
} as const;

export type FLAktorMitAdresseZeileKind = (typeof FLAktorMitAdresseZeileKind)[keyof typeof FLAktorMitAdresseZeileKind];

export const FLAktorMitAdresseZeileKind = {
  admin_session: "admin_session",
  system: "system",
  public: "public",
} as const;

/**
 * An actor named by `email` as both reads serve one: the stored actor, its address withheld where the ban list holds it.
 */
export interface FLAktorMitAdresseZeile {
  email: string | null;
  email_gesperrt: boolean;
  kind: FLAktorMitAdresseZeileKind;
}

export type FLAktorPersonFunktion = (typeof FLAktorPersonFunktion)[keyof typeof FLAktorPersonFunktion];

export const FLAktorPersonFunktion = {
  kontakt: "kontakt",
  spieler: "spieler",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A signed-in person, named by a pseudonym and the kind of person the write was made as.
 *
 * Mirrors `app/core/recording.py :: PersonActor`, and carries no address.
 */
export interface FLAktorPerson {
  funktion: FLAktorPersonFunktion;
  kind: "person_session";
  pseudonym: string;
}

export interface FLAktionRequest {
  method: string;
  path: string;
}

/**
 * One recorded write.
 *
 * A read model, so nothing here refuses a stored value: this
 * collection holds copies of documents from every other one, and a row it cannot serve is a row
 * nobody can see was recorded.
 */
export interface FLAktion {
  actor: FLAktorMitAdresseZeile | FLAktorPerson;
  anlass: string | null;
  at: string;
  collection: string;
  db_filter: FLAktionDbFilter;
  document_id: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  modified_count: number | null;
  operation: FLAktionOperation;
  redacted_at: string | null;
  request: FLAktionRequest | null;
  stand_gesichert: boolean;
  trace_id: string;
}

export type FLAktionMitStandBefore = { [key: string]: unknown } | { [key: string]: unknown }[] | null;

export type FLAktionMitStandDbFilter = { [key: string]: string } | null;

export type FLAktionMitStandOperation = (typeof FLAktionMitStandOperation)[keyof typeof FLAktionMitStandOperation];

export const FLAktionMitStandOperation = {
  insert: "insert",
  insert_many: "insert_many",
  patch_one: "patch_one",
  patch_many: "patch_many",
  delete_many: "delete_many",
  erase_many: "erase_many",
} as const;

/**
 * One row WITH the document its write replaced, which only `GET /aktionen/{aktion_id}` serves.
 *
 * Its own model so the list cannot carry an image by accident.
 */
export interface FLAktionMitStand {
  actor: FLAktorMitAdresseZeile | FLAktorPerson;
  anlass: string | null;
  at: string;
  before: FLAktionMitStandBefore;
  collection: string;
  db_filter: FLAktionMitStandDbFilter;
  document_id: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  modified_count: number | null;
  operation: FLAktionMitStandOperation;
  redacted_at: string | null;
  request: FLAktionRequest | null;
  stand_gesichert: boolean;
  trace_id: string;
}

export interface FLAktionSingleResponse {
  aktion: FLAktionMitStand;
}

export type FLAktionenListResponseAnzahlJeCollection = { [key: string]: number };

export type FLAktionenListResponseAnzahlJeHerkunft = { [key: string]: number };

export type FLAktionenListResponseAnzahlJeOperation = { [key: string]: number };

export interface FLAktionenListResponse {
  aktionen: FLAktion[];
  anzahl_je_collection: FLAktionenListResponseAnzahlJeCollection;
  anzahl_je_herkunft: FLAktionenListResponseAnzahlJeHerkunft;
  anzahl_je_operation: FLAktionenListResponseAnzahlJeOperation;
  vollstaendig: boolean;
}

export type FLVerwaltung = (typeof FLVerwaltung)[keyof typeof FLVerwaltung];

export const FLVerwaltung = {
  owner: "owner",
  administration: "administration",
} as const;

/**
 * The sign-in gate's whole answer: the records' two flags, the ban and the grant, and no record itself.
 *
 * The ban narrows neither flag: whether a barred person signs in is the gate's to decide.
 */
export interface FLAnmeldungResponse {
  gesperrt: boolean;
  konto: boolean;
  unbestaetigt: boolean;
  verwaltung: FLVerwaltung | null;
}

export type FLGruppenNames = (typeof FLGruppenNames)[keyof typeof FLGruppenNames];

export const FLGruppenNames = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  E: "E",
  F: "F",
  G: "G",
  H: "H",
  I: "I",
  J: "J",
  K: "K",
  L: "L",
  M: "M",
  N: "N",
  O: "O",
  P: "P",
} as const;

/**
 * Which group the school enters, and the kit colour the league assigns it.
 *
 * No `saison_id`: the application names its own season, so a payload carrying one could only
 * disagree with it.
 */
export interface FLAnnehmenBewerbungPayload {
  gruppe: FLGruppenNames;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * The application as the acceptance left it, plus what the acceptance wrote beyond it.
 */
export interface FLAnnehmenBewerbungResponse {
  created_team: boolean;
  gruppe: FLGruppenNames;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  trikot_farbe: FLTrikotFarbe | null;
  updated_document: FLBewerbung;
}

export type FLAustrittType = (typeof FLAustrittType)[keyof typeof FLAustrittType];

export const FLAustrittType = {
  disqualifikation: "disqualifikation",
  rueckzug: "rueckzug",
} as const;

/**
 * How a team came to be out of one season, why, and from when.
 *
 * `grund` is FREE TEXT and PUBLIC -- it appears on the team's page, and this league publishes no
 * disciplinary code an enum could cite.
 */
export interface FLAustritt {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  /** @minLength 1 */
  grund: string;
  type: FLAustrittType;
}

export type FLBerechtigungAenderungArt = (typeof FLBerechtigungAenderungArt)[keyof typeof FLBerechtigungAenderungArt];

export const FLBerechtigungAenderungArt = {
  erteilt: "erteilt",
  entzogen: "entzogen",
  geaendert: "geaendert",
  beantragt: "beantragt",
  adresswechsel: "adresswechsel",
  antrag_abgelehnt: "antrag_abgelehnt",
  antrag_beendet: "antrag_beendet",
} as const;

/**
 * One grant's address and tier at one moment.
 */
export interface FLBerechtigungStand {
  adresse: string | null;
  verwaltung: FLVerwaltung;
}

export type FLBerechtigungAenderungUrheber = (typeof FLBerechtigungAenderungUrheber)[keyof typeof FLBerechtigungAenderungUrheber];

export const FLBerechtigungAenderungUrheber = {
  anwendung: "anwendung",
  datenbank: "datenbank",
} as const;

/**
 * One claimed change to announce: what the grant is now, what everyone was last told, and who made it.
 */
export interface FLBerechtigungAenderung {
  an: string[] | null;
  art: FLBerechtigungAenderungArt;
  aufgegeben: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  berechtigung_id: string;
  geaendert_am: string | null;
  geaendert_von: string | null;
  geaendert_von_gesperrt: boolean;
  geloescht: boolean;
  gesperrt: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  jetzt: FLBerechtigungStand | null;
  urheber: FLBerechtigungAenderungUrheber;
  vorher: FLBerechtigungStand | null;
}

export interface FLBerechtigungAbgleichResponse {
  aenderungen: FLBerechtigungAenderung[];
  beansprucht_bis: string | null;
  beanspruchung: string | null;
  empfaenger: string[];
  /** @minimum 0 */
  uebersprungen: number;
}

export type FLGenehmigungVerwehrt = (typeof FLGenehmigungVerwehrt)[keyof typeof FLGenehmigungVerwehrt];

export const FLGenehmigungVerwehrt = {
  eigene: "eigene",
  gestartet: "gestartet",
  inhaber: "inhaber",
  juenger: "juenger",
} as const;

/**
 * The change of a grant's address waiting on an administrator's approval, which the list's reader may press.
 *
 * Who started it, how and why is what a pretext hides.
 */
export interface FLBerechtigungAdresswechsel {
  bestaetigt: boolean;
  bis: string;
  einsehbar_verwehrt: FLAdresswechselEinsehbarVerwehrt | null;
  email: string | null;
  email_gesperrt: boolean;
  gestartet_von: string | null;
  gestartet_von_gesperrt: boolean;
  grund: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  verwehrt: FLGenehmigungVerwehrt | null;
  weg: FLAdresswechselWeg;
}

export interface FLBerechtigungAngekuendigtPayload {
  /** @minLength 1 */
  beanspruchung: string;
  /**
   * @minItems 1
   * @maxItems 1024
   * @items.pattern ^[0-9a-fA-F]{24}$
   */
  ids: string[];
}

export interface FLBerechtigungAngekuendigtResponse {
  /** @minimum 0 */
  angekuendigt: number;
  /** @minimum 0 */
  ignoriert: number;
}

/**
 * The request a refusal or a withdrawal removed: a removal is hard, so the id is all there is to answer with.
 */
export interface FLBerechtigungAntragAbgelehntResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  antrag_id: string;
}

/**
 * The grant an approval wrote or promoted.
 */
export interface FLBerechtigungAntragGenehmigtResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  berechtigung_id: string;
}

/**
 * One request as the list serves it, while it may still be decided.
 */
export interface FLBerechtigungAntragZeile {
  adresse: string | null;
  angefragt_am: string;
  berechtigung_id: string | null;
  bis: string;
  gesperrt: boolean;
  gestartet_von: string | null;
  gestartet_von_gesperrt: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  steht: boolean;
  verwaltung: FLVerwaltung;
  verwehrt: FLGenehmigungVerwehrt | null;
}

/**
 * The grant a tier change named, and whether its promotion waits on another owner's approval rather than taking effect.
 */
export interface FLBerechtigungStufeResponse {
  beantragt: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  berechtigung_id: string;
}

/**
 * The grant a revoke removed or a tier change moved: a removal is hard, so the id is all there is to answer with.
 */
export interface FLBerechtigungWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  berechtigung_id: string;
}

/**
 * One grant as the list serves it.
 */
export interface FLBerechtigungZeile {
  adresse: string | null;
  adresswechsel: FLBerechtigungAdresswechsel | null;
  erteilt_am: string;
  erteilt_von: string | null;
  erteilt_von_gesperrt: boolean;
  gesperrt: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  verwaltung: FLVerwaltung;
}

/**
 * Every live grant, uncapped: a list the floor of two is judged over is never served in part.
 */
export interface FLBerechtigungenListResponse {
  antraege: FLBerechtigungAntragZeile[];
  berechtigungen: FLBerechtigungZeile[];
  /** @minimum 0 */
  uebersprungen: number;
}

/**
 * One person's confirmation bookkeeping as an administrator reads it, and no token hash.
 *
 * The hash is a raw document key the confirmation query alone reads, so no read serves one.
 */
export interface FLBestaetigung {
  erinnert_am: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  verschickt_am: string;
  zustellung?: FLBewerbungZustellung | null;
}

export type FLBestaetigungZustand = (typeof FLBestaetigungZustand)[keyof typeof FLBestaetigungZustand];

export const FLBestaetigungZustand = {
  gueltig: "gueltig",
  bestaetigt: "bestaetigt",
  abgelaufen: "abgelaufen",
  gesperrt: "gesperrt",
} as const;

/**
 * The school's address, with the Stadtteil REQUIRED.
 *
 * Its own subclass rather than a change to `FLAddressPayload`, which an admin address shares: a
 * venue can genuinely lack a district, and a Frankfurt school does not.
 */
export interface FLBewerbungAddressPayload {
  /**
   * @maxLength 16
   * @pattern ^([0-9\-abcABC]+)?$
   */
  hausnummer: string;
  /** @pattern ^[0-9]{5}$ */
  plz: string;
  /**
   * @minLength 1
   * @maxLength 80
   */
  stadt: string;
  /**
   * @minLength 1
   * @maxLength 80
   */
  stadtteil: string;
  /**
   * @minLength 1
   * @maxLength 120
   */
  strasse: string;
}

/**
 * The three RAW tokens the create or its replay minted, one per seat.
 *
 * This response and the inboxes are the only places a raw token exists: the database holds
 * hashes, and no read model declares one.
 */
export interface FLBewerbungBestaetigungTokens {
  ansprechperson: string;
  stellvertretung: string;
  trainer: string;
}

/**
 * A POST that reads: the token travels in a body, never in a second URL.
 */
export interface FLBewerbungEinwilligungAnsichtPayload {
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
}

export type FLBewerbungEinwilligungAnsichtResponseQuelle =
  (typeof FLBewerbungEinwilligungAnsichtResponseQuelle)[keyof typeof FLBewerbungEinwilligungAnsichtResponseQuelle];

export const FLBewerbungEinwilligungAnsichtResponseQuelle = {
  bewerbung: "bewerbung",
  saison: "saison",
} as const;

export type FLBewerbungEinwilligungAnsichtResponseZustand =
  (typeof FLBewerbungEinwilligungAnsichtResponseZustand)[keyof typeof FLBewerbungEinwilligungAnsichtResponseZustand];

export const FLBewerbungEinwilligungAnsichtResponseZustand = {
  gueltig: "gueltig",
  bestaetigt: "bestaetigt",
  abgelehnt: "abgelehnt",
  abgelaufen: "abgelaufen",
  saison_vorbei: "saison_vorbei",
  gesperrt: "gesperrt",
} as const;

export type FLKontaktRolle = (typeof FLKontaktRolle)[keyof typeof FLKontaktRolle];

export const FLKontaktRolle = {
  trainer: "trainer",
  ansprechperson: "ansprechperson",
  stellvertretung: "stellvertretung",
} as const;

export type FLKontaktZeile = (typeof FLKontaktZeile)[keyof typeof FLKontaktZeile];

export const FLKontaktZeile = {
  offen: "offen",
  saison_vorbei: "saison_vorbei",
  ausgetreten: "ausgetreten",
} as const;

/**
 * What the page renders for one seat, and no contact record (`READ-BEWERBUNG-002`).
 *
 * A leaked link's holder learns what its mail said: a school, a season and the roles one answer
 * covers, and nothing of the person.
 */
export interface FLBewerbungEinwilligungAnsichtResponse {
  laufende_fassung: string;
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  mindestalter: number;
  quelle: FLBewerbungEinwilligungAnsichtResponseQuelle;
  rolle: FLKontaktRolle;
  saison_id: string;
  schule: string;
  zeile: FLKontaktZeile | null;
  zugleich_rolle: FLKontaktRolle | null;
  zustand: FLBewerbungEinwilligungAnsichtResponseZustand;
}

export type FLBewerbungEinwilligungAntwortPayloadAntwort =
  (typeof FLBewerbungEinwilligungAntwortPayloadAntwort)[keyof typeof FLBewerbungEinwilligungAntwortPayloadAntwort];

export const FLBewerbungEinwilligungAntwortPayloadAntwort = {
  erteilt: "erteilt",
  abgelehnt: "abgelehnt",
} as const;

/**
 * One person's answer for one seat: the consent, or a decline that empties their slot.
 */
export interface FLBewerbungEinwilligungAntwortPayload {
  antwort: FLBewerbungEinwilligungAntwortPayloadAntwort;
  geburtsdatum: string | null;
  medien: boolean;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
  whatsapp: boolean;
}

export type FLBewerbungEinwilligungAntwortResponseErgebnis =
  (typeof FLBewerbungEinwilligungAntwortResponseErgebnis)[keyof typeof FLBewerbungEinwilligungAntwortResponseErgebnis];

export const FLBewerbungEinwilligungAntwortResponseErgebnis = {
  bestaetigt: "bestaetigt",
  abgelehnt: "abgelehnt",
} as const;

/**
 * What the answer did, and which seats are still open -- the whole application's, not this person's.
 *
 * Widened rather than given a read: one field of an admin-tier document would be a new surface to
 * withhold the rest at.
 */
export interface FLBewerbungEinwilligungAntwortResponse {
  ansprechperson_email: string | null;
  ansprechperson_rollen: FLKontaktRolle[];
  ausstehend: FLKontaktRolle[];
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  ergebnis: FLBewerbungEinwilligungAntwortResponseErgebnis;
  geburtsdatum: string | null;
  medien: boolean;
  quelle: "bewerbung";
  rolle: FLKontaktRolle;
  saison_id: string;
  vorname: string;
  whatsapp: boolean;
}

/**
 * A fresh link for one seat, RAW, for the admin action to mail; the old one then opens nothing.
 */
export interface FLBewerbungEinwilligungErneutResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  email: string;
  rolle: FLKontaktRolle;
  rollen: FLKontaktRolle[];
  token: string;
}

/**
 * What the applicant agreed to, and nothing about how the record of it is composed.
 *
 * `umfang` and `datum` are the SERVER's: a client offered them could claim the person's own
 * answer, or backdate a record.
 */
export interface FLBewerbungEinwilligungPayload {
  erteilt: true;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
}

/**
 * One season's application window and whether that season has ended, and NOTHING else about it.
 *
 * A season taking applications is `future`, which the rule withholds -- so
 * the window gets its own shape rather than widening a season read.
 */
export interface FLBewerbungFensterResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bis: string;
  laeuft: boolean;
  offen: boolean;
  saison_beendet: boolean;
  saison_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  von: string;
}

export interface FLBewerbungKaderPayload {
  /**
   * @minimum 0
   * @maximum 200
   */
  gute_spieler: number;
  /**
   * @minimum 1
   * @maximum 200
   */
  voraussichtliche_groesse: number;
}

/**
 * A season that records no application window: its id, and nothing else about it.
 *
 * The rule is narrowed to the id resolving to a season, which is what parts
 * this answer from the 404 a mistyped id keeps.
 */
export interface FLBewerbungKeinFensterResponse {
  /** @nullable */
  fenster: null;
  saison_id: string;
}

/**
 * The corrected address, and NOTHING else of the person: a bounced link is repaired, not the submission rewritten.
 */
export interface FLBewerbungKontaktEmailPayload {
  /** @maxLength 254 */
  bisherige_email: string;
  /** @maxLength 254 */
  email: string;
}

/**
 * The corrected address as stored, the fresh link it is to be mailed at, and every seat both reached.
 */
export interface FLBewerbungKontaktEmailResponse {
  abgang_email: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  email: string;
  rollen: FLKontaktRolle[];
  token: string;
}

/**
 * The person seated where a contact person stepped out, carrying no `einwilligung` block.
 *
 * `FLBewerbungKontaktpersonPayload`'s is `erteilt: Literal[True]`, and this person has agreed to
 * nothing: their own link is what asks them.
 */
export interface FLBewerbungKontaktSitzPayload {
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  nachname: string;
  /** @pattern ^([+]?[ 0-9\-().]{2,19}[0-9])$ */
  telefon: string;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  vorname: string;
}

/**
 * The new person's address as stored, every seat they now hold, and the fresh link the caller mails them there.
 */
export interface FLBewerbungKontaktSitzResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  email: string;
  rollen: FLKontaktRolle[];
  token: string;
}

/**
 * One of the three people, as a member of the public submits them.
 *
 * No birthdate: each types their own on the confirmation page, so
 * the key is refused outright rather than accepted as a null.
 */
export interface FLBewerbungKontaktpersonPayload {
  einwilligung: FLBewerbungEinwilligungPayload;
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  nachname: string;
  /** @pattern ^([+]?[ 0-9\-().]{2,19}[0-9])$ */
  telefon: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  vorname: string;
}

/**
 * The three people an application is reached through, all three REQUIRED and non-null.
 *
 * Unlike the junction payload, whose nulls keep a row an erasure emptied editable: an application
 * is the form those three filled in, and there is nothing yet to erase.
 */
export interface FLBewerbungKontaktePayload {
  ansprechperson: FLBewerbungKontaktpersonPayload;
  stellvertretung: FLBewerbungKontaktpersonPayload;
  trainer: FLBewerbungKontaktpersonPayload;
  trainer_ist_zugleich: FLTrainerZugleich | null;
}

/**
 * Whether a proposed Kürzel is already a club's.
 *
 * It names no club and does not tell an active one from a retired one: the uniqueness it mirrors
 * spans both, and a shape distinguishing them would publish which schools have left.
 */
export interface FLBewerbungKuerzelResponse {
  shorthand: string;
  vergeben: boolean;
}

export interface FLEinwilligungStandPayload {
  medien: string | null;
  umfang: string | null;
}

/**
 * The season seat's payload on a pending application, where its press takes withdrawals alone.
 *
 * The same shape, so one control serves both; a grant on it is refused rather than unrepresentable.
 */
export interface FLBewerbungPersonEinwilligungPayload {
  medien: boolean;
  nachweis_stand: FLEinwilligungStandPayload;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * Each choice's stand where the account page was served, null where the record carried no evidence for it.
 *
 * A consent PATCH's precondition, echoed back as served, never a secret.
 */
export interface FLEinwilligungStand {
  medien: string | null;
  umfang: string | null;
}

/**
 * Which of the application's seats the withdrawal reached, and the two answers they now all hold.
 */
export interface FLBewerbungPersonEinwilligungResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  medien: boolean;
  nachweis_stand: FLEinwilligungStand;
  rollen: FLKontaktRolle[];
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * One club as the public form offers it: an autocomplete row, and nothing more.
 *
 * An allow-list declared from nothing, never a narrowing of `FLTeam` (`READ-BEWERBUNG-001`): an
 * anonymous visitor picks from it, and a club's address is a school's street.
 */
export interface FLBewerbungSchuleOption {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
}

/**
 * The club a new school proposes, bounded and stripped for the write side.
 *
 * A subclass rather than a second declaration, as `FLKontaktpersonPayload` is: the field set is the
 * stored block's, and two spellings of it would drift on every field they share.
 */
export interface FLBewerbungSchulePayload {
  address: FLBewerbungAddressPayload;
  /**
   * @minLength 1
   * @maxLength 120
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  full_name: string;
  schulform: FLSchulform;
  /** @pattern ^\s*[A-Za-z]{3}\s*$ */
  shorthand: string;
  /**
   * @minLength 1
   * @maxLength 60
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  team_name: string;
  website_url: string | null;
}

export interface FLBewerbungSchulenResponse {
  schulen: FLBewerbungSchuleOption[];
}

export interface FLBewerbungSingleResponse {
  bestaetigungsfrist_abgelaufen: boolean;
  bewerbung: FLBewerbung;
}

/**
 * Which candidates' notices the caller delivered. The backend re-judges them: an id that has stopped qualifying is skipped.
 */
export interface FLBewerbungSweepAngekuendigtPayload {
  /**
   * @maxItems 83
   * @items.pattern ^[0-9a-fA-F]{24}$
   */
  bewerbung_ids: string[];
}

export interface FLBewerbungSweepAngekuendigtResponse {
  angekuendigt: number;
  fehlgeschlagen: number;
  saison_id: string;
}

/**
 * A seat the deletion notice lists as never confirmed. `vorname` is null where the slot was emptied by a decline or an erasure.
 */
export interface FLBewerbungSweepAusstehend {
  rolle: FLKontaktRolle;
  vorname: string | null;
}

/**
 * One LINK a reminder carries: the RAW fresh token, which exists here and in the mail alone.
 */
export interface FLBewerbungSweepSeat {
  rollen: FLKontaktRolle[];
  token: string;
  vorname: string;
}

/**
 * One reminder to send: one MAILBOX of one application, every seat it holds due today.
 *
 * Grouped as the first mail groups (`fl_frontend/src/features/bewerbungen/notifications.ts`), so
 * one person holding two seats gets one message and two people on one inbox get two.
 */
export interface FLBewerbungSweepErinnerung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  email: string;
  saison_id: string;
  schule: string;
  seats: FLBewerbungSweepSeat[];
}

/**
 * Which candidates to erase. The backend re-selects them: an id that has stopped qualifying, or that was never announced, is skipped.
 */
export interface FLBewerbungSweepLoeschenPayload {
  /**
   * @maxItems 83
   * @items.pattern ^[0-9a-fA-F]{24}$
   */
  bewerbung_ids: string[];
}

export interface FLBewerbungSweepLoeschenResponse {
  fehlgeschlagen: number;
  geloescht: number;
  redigierte_aktionen: number;
  saison_id: string;
}

/**
 * One application past its deadline, still standing: the notice goes out first, the erasure follows in a second call.
 */
export interface FLBewerbungSweepLoeschung {
  angekuendigt: boolean;
  ansprechperson_email: string | null;
  ansprechperson_rollen: FLKontaktRolle[];
  ausstehend: FLBewerbungSweepAusstehend[];
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  saison_id: string;
  schule: string;
}

/**
 * One season's pass: the reminders already stamped, the deletions still to notify, and the four silent clocks' counts.
 */
export interface FLBewerbungSweepResponse {
  abgelehnte_geloescht: number;
  angenommene_geloescht: number;
  erinnerungen: FLBewerbungSweepErinnerung[];
  fehlgeschlagen: number;
  kontaktbloecke_geleert: number;
  loeschungen: FLBewerbungSweepLoeschung[];
  ohne_entscheidung_geloescht: number;
  redigierte_aktionen: number;
  saison_id: string;
}

/**
 * Every season's id, for the caller to sweep one by one, and the day each retention pass last ran anywhere in this database.
 */
export interface FLBewerbungSweepSaisonsResponse {
  registrierung_sweep_gelaufen_am: string | null;
  saison_ids: string[];
  sweep_gelaufen_am: string | null;
}

/**
 * Which kit colours one season has already ASSIGNED. A set, and nothing about who holds one.
 *
 * An allow-list declared from nothing, as `FLBewerbungSchuleOption` is (`READ-BEWERBUNG-001`): a
 * colour beside a club would publish which kit that school wears.
 */
export interface FLBewerbungTrikotFarbenResponse {
  saison_id: string;
  vergeben: FLTrikotFarbe[];
}

export interface FLBewerbungTrikotPayload {
  /** @maxLength 500 */
  vorhandener_satz: string;
  wunschfarbe: FLTrikotFarbe;
}

export type FLBewerbungZustellEreignis = (typeof FLBewerbungZustellEreignis)[keyof typeof FLBewerbungZustellEreignis];

export const FLBewerbungZustellEreignis = {
  zugestellt: "zugestellt",
  verzoegert: "verzoegert",
  unzustellbar: "unzustellbar",
  unterdrueckt: "unterdrueckt",
  beschwerde: "beschwerde",
} as const;

/**
 * One message the provider accepted. `stand` is not a key: this endpoint records `angenommen` and no other state.
 */
export interface FLBewerbungZustellungAngenommenPayload {
  /**
   * @minLength 1
   * @maxLength 64
   */
  am: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  /**
   * @minLength 1
   * @maxLength 128
   */
  nachricht_id: string;
  rollen: FLKontaktRolle[];
}

/**
 * One delivery event about a message this application's seats were sent.
 */
export interface FLBewerbungZustellungEreignisPayload {
  /**
   * @minLength 1
   * @maxLength 64
   */
  am: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  grund: string | null;
  /**
   * @minLength 1
   * @maxLength 128
   */
  nachricht_id: string;
  rollen: FLKontaktRolle[];
  stand: FLBewerbungZustellEreignis;
}

/**
 * Which seats the write reached, empty where the event was about a message no seat still holds.
 *
 * Empty rather than a refusal: the provider repeats a settled event for hours if anything but a
 * success answers it.
 */
export interface FLBewerbungZustellungResponse {
  angewendet: FLKontaktRolle[];
}

/**
 * The queue, newest first, and whether that is the whole of it.
 *
 * A cut answer still marks a collision: `dubletten_schluessel` is taken over every open
 * application, so a pair the cap parted is named at both ends.
 */
export interface FLBewerbungenListResponse {
  anzahl_je_saisonbezug: Partial<Record<"diese_saison" | "andere_saison", number>>;
  anzahl_je_status: Partial<Record<"eingereicht" | "angenommen" | "abgelehnt", number>>;
  bewerbungen: FLBewerbung[];
  dubletten_schluessel: string[];
  vollstaendig: boolean;
}

export type FLBracketFaultBookingBooking = (typeof FLBracketFaultBookingBooking)[keyof typeof FLBracketFaultBookingBooking];

export const FLBracketFaultBookingBooking = {
  ort: "ort",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A fixture still to be played booked onto a retired venue or referee.
 *
 * Nothing is taken off: only a person chooses between reactivating the row and booking another.
 */
export interface FLBracketFaultBooking {
  booking: FLBracketFaultBookingBooking;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  booking_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  inactive_since: string;
  name: string | null;
  reason: "retired_booking";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFaultClashBooking = (typeof FLBracketFaultClashBooking)[keyof typeof FLBracketFaultClashBooking];

export const FLBracketFaultClashBooking = {
  ort: "ort",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A venue or referee claimed less than `REQ-CLASH-001`'s buffer from another fixture's claim, one entry per claim.
 *
 * It names the fixture that refusal names, so the report and a save's 409 point at one match.
 */
export interface FLBracketFaultClash {
  booking: FLBracketFaultClashBooking;
  name: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  other_datum: string;
  other_saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  other_spiel_id: string;
  /** @exclusiveMinimum 0 */
  other_spiel_nr: number;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  other_uhrzeit: string;
  reason: "double_booked";
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFaultGruppeReason = (typeof FLBracketFaultGruppeReason)[keyof typeof FLBracketFaultGruppeReason];

export const FLBracketFaultGruppeReason = {
  gruppe_too_small: "gruppe_too_small",
  gruppe_not_run: "gruppe_not_run",
  seed_past_the_opening_round: "seed_past_the_opening_round",
  tie_unresolved: "tie_unresolved",
} as const;

/**
 * One bracket slot whose `gruppe` reference names a placing no standing will hand it.
 *
 * `tie_unresolved` alone empties the slot: every other reason names wiring the season cannot hold,
 * and a slot is never emptied over one.
 */
export interface FLBracketFaultGruppe {
  gruppe: FLGruppenNames;
  /** @exclusiveMinimum 0 */
  platz: number;
  reason: FLBracketFaultGruppeReason;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFaultOccupantSide = (typeof FLBracketFaultOccupantSide)[keyof typeof FLBracketFaultOccupantSide];

export const FLBracketFaultOccupantSide = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * One fixture fielding a team that left the season.
 *
 * The date rule and the carve-out are `REQ-ELIGIBILITY-001`'s. Nothing is emptied
 * (`docs/domain.md`'s what the model permits on purpose).
 */
export interface FLBracketFaultOccupant {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  ausgeschieden_seit: string;
  austritt_type: FLAustrittType;
  reason: "departed_occupant";
  side: FLBracketFaultOccupantSide;
  spiel_datum: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  team_name: string;
}

export type FLBracketFaultQuelleReason = (typeof FLBracketFaultQuelleReason)[keyof typeof FLBracketFaultQuelleReason];

export const FLBracketFaultQuelleReason = {
  spiel_missing: "spiel_missing",
  reference_cycle: "reference_cycle",
  gruppenphase_feeder: "gruppenphase_feeder",
  feeder_not_played_first: "feeder_not_played_first",
} as const;

/**
 * One bracket slot whose `spiel` reference names a match that cannot feed it.
 *
 * Each leaves the slot as it stands, and a cycle is reported on every fixture it reaches.
 */
export interface FLBracketFaultQuelle {
  /** @exclusiveMinimum 0 */
  quelle_spiel_nr: number;
  reason: FLBracketFaultQuelleReason;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFaultSlotReason = (typeof FLBracketFaultSlotReason)[keyof typeof FLBracketFaultSlotReason];

export const FLBracketFaultSlotReason = {
  gruppenphase_fixture_wired: "gruppenphase_fixture_wired",
  source_feeds_another_fixture: "source_feeds_another_fixture",
} as const;

export type FLBracketFaultSlotSide = (typeof FLBracketFaultSlotSide)[keyof typeof FLBracketFaultSlotSide];

export const FLBracketFaultSlotSide = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * A slot fed by the group phase: the team finishing `platz` in `gruppe`.
 */
export interface FLSpielQuelleGruppe {
  gruppe: FLGruppenNames;
  /** @exclusiveMinimum 0 */
  platz: number;
  type: "gruppe";
}

export type FLSpielQuelleSpielAusgang = (typeof FLSpielQuelleSpielAusgang)[keyof typeof FLSpielQuelleSpielAusgang];

export const FLSpielQuelleSpielAusgang = {
  sieger: "sieger",
  verlierer: "verlierer",
} as const;

/**
 * A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`.
 */
export interface FLSpielQuelleSpiel {
  ausgang: FLSpielQuelleSpielAusgang;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  type: "spiel";
}

/**
 * One slot carrying a reference it must not carry, whatever that reference names.
 *
 * The reference travels whole rather than decomposed: it groups the entries of a shared source, and
 * a toast arrives with no fixture to read it off.
 */
export interface FLBracketFaultSlot {
  quelle: FLSpielQuelleGruppe | FLSpielQuelleSpiel;
  reason: FLBracketFaultSlotReason;
  side: FLBracketFaultSlotSide;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

/**
 * One fixture whose two references resolve to the SAME club.
 *
 * It survives the write-path rule, which keys a source by identity, so two DIFFERENT sources
 * naming one club pass. The fixture keeps its stored sides.
 */
export interface FLBracketFaultSpiel {
  reason: "same_team";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFaultSpieltagSide = (typeof FLBracketFaultSpieltagSide)[keyof typeof FLBracketFaultSpieltagSide];

export const FLBracketFaultSpieltagSide = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * A club standing more than once on one Spieltag.
 *
 * One entry per APPEARANCE, the granularity `fl_backend/app/core/constraints.py :: report_relations`
 * counts in -- never deduplicated, because which to correct is a competition decision.
 */
export interface FLBracketFaultSpieltag {
  reason: "fielded_twice";
  side: FLBracketFaultSpieltagSide;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  team_name: string;
}

/**
 * The id a create minted, which the caller reads the new record by.
 */
export interface FLCreatedResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
}

/**
 * The link a visitor presents, and nothing else: the row it opens says which team and season it is for.
 */
export interface FLEinladungAnsichtPayload {
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
}

/**
 * What an invite's holder is told before they type anything.
 *
 * Each field is something the link's own message already said, or something the form is bounded
 * by: a select offering more than the write accepts is a drifted client.
 */
export interface FLEinladungAnsichtResponse {
  erlaubte_stufen: FLSpielerStufe[];
  kader_frei: boolean;
  laeuft: boolean;
  nachnominierung: boolean;
  saison_id: string;
  saison_status: FLSaisonStatus;
  /** @minLength 1 */
  schule: string;
  /** @minLength 1 */
  team: string;
  team_eingetragen: boolean;
}

/**
 * One mailbox a link goes to, and the seat it is addressed as.
 */
export interface FLEinladungEmpfaenger {
  /** @minLength 1 */
  email: string;
  rolle: FLKontaktRolle;
  /** @minLength 1 */
  vorname: string;
}

/**
 * A freshly minted registration link, and the only answer that ever carries its raw value.
 *
 * Shown once for copying and mailed on a separate press; no later read recovers it from the hash.
 */
export interface FLEinladungMintResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  einladung_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  erstellt_am: string;
  /** @minLength 1 */
  erstellt_von: string;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  token: string;
}

/**
 * The carrier a message about this invite is recorded in.
 *
 * A carrier rather than the record itself: `zustellung_pfad` composes a dotted path out of it, and
 * the accepted send skips a row holding no carrier at all.
 */
export interface FLEinladungVersand {
  zustellung?: FLBewerbungZustellung | null;
}

/**
 * One live link as the team's read serves it: the stored row, its minter withheld where the ban list holds that address.
 */
export interface FLEinladungZeile {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  erstellt_am: string;
  erstellt_von: string | null;
  erstellt_von_gesperrt: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  versand?: FLEinladungVersand | null;
  widerrufen_am: string | null;
}

/**
 * The team's live link for one season, or nothing, beside the window deciding what it opens.
 *
 * Declared here rather than in `app/api/teams/schemas.py`, whose endpoint answers it: moving it
 * there is an import cycle through `app/api/bewerbungen/schemas.py`.
 */
export interface FLEinladungResponse {
  einladung: FLEinladungZeile | null;
  laeuft: boolean;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLEinladungVersandPayload {
  erneut?: boolean;
}

export type FLEinladungVersandZeileUebersprungen =
  (typeof FLEinladungVersandZeileUebersprungen)[keyof typeof FLEinladungVersandZeileUebersprungen] | null;

export const FLEinladungVersandZeileUebersprungen = {
  austritt_eingetragen: "austritt_eingetragen",
  erzeugung_fehlgeschlagen: "erzeugung_fehlgeschlagen",
  erzeugung_ungewiss: "erzeugung_ungewiss",
  kein_kontaktblock: "kein_kontaktblock",
  keine_bestaetigte_kontaktperson: "keine_bestaetigte_kontaktperson",
  kontakte_gesperrt: "kontakte_gesperrt",
  bereits_gesendet: "bereits_gesendet",
} as const;

/**
 * One team as the press left it.
 */
export interface FLEinladungVersandZeile {
  einladung_id: string | null;
  empfaenger: FLEinladungEmpfaenger[];
  ersetzt_link: boolean;
  hatte_link: boolean | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  team_name: string;
  token: string | null;
  uebersprungen: FLEinladungVersandZeileUebersprungen;
}

/**
 * What the press did, per admitted team of the season.
 */
export interface FLEinladungVersandResponse {
  /** @minLength 1 */
  saison_id: string;
  zeilen: FLEinladungVersandZeile[];
}

export type FLEinladungVersandVorschauZeileUebersprungen =
  (typeof FLEinladungVersandVorschauZeileUebersprungen)[keyof typeof FLEinladungVersandVorschauZeileUebersprungen] | null;

export const FLEinladungVersandVorschauZeileUebersprungen = {
  austritt_eingetragen: "austritt_eingetragen",
  erzeugung_fehlgeschlagen: "erzeugung_fehlgeschlagen",
  erzeugung_ungewiss: "erzeugung_ungewiss",
  kein_kontaktblock: "kein_kontaktblock",
  keine_bestaetigte_kontaktperson: "keine_bestaetigte_kontaktperson",
  kontakte_gesperrt: "kontakte_gesperrt",
  bereits_gesendet: "bereits_gesendet",
} as const;

/**
 * One team as the preview reports it. It mints nothing, so it answers no link.
 */
export interface FLEinladungVersandVorschauZeile {
  empfaenger: FLEinladungEmpfaenger[];
  ersetzt_link: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  team_name: string;
  uebersprungen: FLEinladungVersandVorschauZeileUebersprungen;
}

/**
 * Who the press would mail, over the same rule the press then performs.
 */
export interface FLEinladungVersandVorschauResponse {
  /** @minLength 1 */
  saison_id: string;
  zeilen: FLEinladungVersandVorschauZeile[];
}

/**
 * The revoked row. Revoking keeps it, so a delivery event about its link still lands somewhere.
 */
export interface FLEinladungWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  einladung_id: string;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export type FLEinwilligungUmfang = (typeof FLEinwilligungUmfang)[keyof typeof FLEinwilligungUmfang];

export const FLEinwilligungUmfang = {
  kader_oeffentlich: "kader_oeffentlich",
  intern: "intern",
} as const;

/**
 * What this person agreed may be published about them.
 *
 * The keys the validator requires stand TOGETHER, as `FLAustritt` does: a scope with no
 * confirmation date claims somebody consented, and no surface can tell that from one somebody gave.
 */
export interface FLEinwilligung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigt_am: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  medien: boolean;
  nachweis: FLEinwilligungNachweise;
  text_version: string;
  umfang: FLEinwilligungUmfang;
}

export type FLEinwilligungFassungAbsaetzeNachSchluessel = { [key: string]: string } | null;

export type FLEinwilligungFassungBedienelemente = { [key: string]: string };

/**
 * The words one consent label names, as the person stamping it was shown them.
 *
 * Never changed once served: different words are a new label.
 */
export interface FLEinwilligungFassung {
  absaetze: string[];
  absaetze_nach_schluessel: FLEinwilligungFassungAbsaetzeNachSchluessel;
  bedienelemente: FLEinwilligungFassungBedienelemente;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  gilt_ab: string;
  platzhalter: string[];
  schalter: string;
  seite: string;
  text_version: string;
}

export interface FLEinwilligungFassungResponse {
  fassung: FLEinwilligungFassung;
}

export type FLEinwilligungSeitenResponseLaufendeFassungen = { [key: string]: string };

/**
 * The label each page stamps on a new acceptance today, which a deploy moves: never cached by a reader.
 */
export interface FLEinwilligungSeitenResponse {
  laufende_fassungen: FLEinwilligungSeitenResponseLaufendeFassungen;
}

/**
 * Another address's live change naming this one as its new address: the change ends, its address's records standing.
 */
export interface FLErasureAnsichtAdresswechsel {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  adresswechsel_id: string;
  einsehbar_verwehrt: FLAdresswechselEinsehbarVerwehrt | null;
}

export type FLErasureAnsichtAntragRolle = (typeof FLErasureAnsichtAntragRolle)[keyof typeof FLErasureAnsichtAntragRolle];

export const FLErasureAnsichtAntragRolle = {
  betroffen: "betroffen",
  gestellt: "gestellt",
} as const;

/**
 * An open request for a grant, about the address (`betroffen`) or made by it (`gestellt`), which the erasure removes.
 */
export interface FLErasureAnsichtAntrag {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  antrag_id: string;
  rolle: FLErasureAnsichtAntragRolle;
  verwaltung: FLVerwaltung;
}

export interface FLErasureAnsichtBewerbung {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  vorname: string;
}

/**
 * The address's own live change, which the erasure ends with the records it would move.
 */
export interface FLErasureAnsichtEigenerAdresswechsel {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  adresswechsel_id: string;
}

/**
 * One squad row of a pupil the erasure reaches.
 */
export interface FLErasureAnsichtKader {
  inactive_since: string | null;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string | null;
}

/**
 * The mailbox the reveal is read for, in the BODY for `FLSubjektPayload`'s reason.
 */
export interface FLErasureAnsichtPayload {
  /**
   * @maxLength 254
   * @pattern @
   */
  email: string;
}

export type FLRegistrierungStatus = (typeof FLRegistrierungStatus)[keyof typeof FLRegistrierungStatus];

export const FLRegistrierungStatus = {
  eingereicht: "eingereicht",
  abgelehnt: "abgelehnt",
} as const;

export interface FLErasureAnsichtRegistrierung {
  nachname: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  status: FLRegistrierungStatus;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string | null;
  vorname: string;
}

export interface FLErasureAnsichtSchiedsrichter {
  inactive_since: string | null;
  name: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
  spiele_ohne_ergebnis_saison_ids: string[];
}

export interface FLErasureAnsichtSitz {
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
  vorname: string;
}

export interface FLErasureAnsichtSpieler {
  kader: FLErasureAnsichtKader[];
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  vorname: string;
}

export interface FLErasureAnsichtResponse {
  adresswechsel: FLErasureAnsichtAdresswechsel[];
  antraege: FLErasureAnsichtAntrag[];
  bewerbungen: FLErasureAnsichtBewerbung[];
  eigener_adresswechsel: FLErasureAnsichtEigenerAdresswechsel | null;
  gesperrt: boolean;
  registrierungen: FLErasureAnsichtRegistrierung[];
  schiedsrichter: FLErasureAnsichtSchiedsrichter[];
  sitze: FLErasureAnsichtSitz[];
  spieler: FLErasureAnsichtSpieler[];
  verwaltung: FLVerwaltung | null;
}

/**
 * The mailbox, and the request the erasure answers, which every log row the erasure files keeps.
 */
export interface FLErasurePayload {
  /**
   * @minLength 1
   * @maxLength 200
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  anlass: string;
  /**
   * @maxLength 254
   * @pattern @
   */
  email: string;
}

export interface FLErasureResponse {
  /** @minimum 0 */
  adresswechsel: number;
  /** @minimum 0 */
  berechtigungen: number;
  /** @minimum 0 */
  berechtigungen_antraege: number;
  /** @minimum 0 */
  drosselung: number;
  /** @minimum 0 */
  kontakt_sitze: number;
  /** @minimum 0 */
  registrierungen: number;
  /** @minimum 0 */
  saison_spieler: number;
  /** @minimum 0 */
  schiedsrichter: number;
  /** @minimum 0 */
  spiele: number;
  /** @minimum 0 */
  spieler: number;
}

export interface FLFailureBody {
  error_code: Code;
  trace_id: string;
}

/**
 * The three rules a season's fixture list is a function of, as this draw is to run from.
 *
 * All three or none: the draw is one function of the whole shape, and a payload naming half
 * of it would take the rest off a season about to stop matching it.
 */
export interface FLSpielplanShape {
  /**
   * @maximum 16
   * @exclusiveMinimum 0
   */
  number_of_groups: number;
  /** @exclusiveMinimum 0 */
  qualifiers_per_group: number;
  /**
   * @minimum 2
   * @maximum 16
   */
  teams_per_group: number;
}

/**
 * Whether this draw may REPLACE what the season already holds, and the shape it runs from.
 *
 * An absent body is a first draw off the season's own rules: nothing is destroyed and no
 * number moves by omission. `REQ-SPIELPLAN-005` bounds a confirmed one.
 */
export interface FLGenerateSpielplanPayload {
  replace?: boolean;
  shape?: FLSpielplanShape | null;
}

/**
 * What the draw wrote, and what a confirmed replace deleted first, flat rather than nested.
 *
 * An admin reads the written counts without a second request, and they are the same numbers the
 * season's own watermark keeps, so the two can be compared by eye.
 */
export interface FLGenerateSpielplanResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  generiert_am: string;
  /** @minimum 0 */
  removed_spiele: number;
  /** @minimum 0 */
  removed_spieltage: number;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  /** @minimum 0 */
  spiele: number;
  /** @minimum 0 */
  spieltage: number;
}

/**
 * The one address a message is about to go to.
 */
export interface FLGesperrtPayload {
  /**
   * @maxLength 254
   * @pattern @
   */
  email: string;
}

/**
 * Whether a standing ban holds that address, and nothing of any record: the mailer needs none.
 */
export interface FLGesperrtResponse {
  gesperrt: boolean;
}

export interface FLTeamStatistik {
  /** @minimum 0 */
  anzahl_abgesagte_spiele?: number;
  /** @minimum 0 */
  anzahl_gespielte_spiele?: number;
  /** @minimum 0 */
  niederlagen?: number;
  /** @minimum 0 */
  punkte?: number;
  /** @minimum 0 */
  siege?: number;
  /** @minimum 0 */
  tore_geschossen?: number;
  /** @minimum 0 */
  tore_kassiert?: number;
  /** @minimum 0 */
  unentschieden?: number;
}

/**
 * One row of a league table: what a standing shows and nothing more.
 *
 * Narrower than `FLTeam` on purpose: a public CLIENT component renders this, so every field is
 * serialised into the page, and a club's address is a school's street.
 */
export interface FLGruppenTeam {
  /** @minimum 0 */
  anzahl_ausstehende_spiele: number;
  austritt_type: FLAustrittType | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  statistik: FLTeamStatistik;
}

/**
 * Every group the SEASON offers, all of them and no other, in standing order.
 *
 * Built by `fl_backend/app/api/teams/services.py :: build_gruppen` alone: the order is the tiebreak
 * chain, whose head-to-head criterion reads the season's matches.
 */
export type FLGruppen = Partial<Record<FLGruppenNames, FLGruppenTeam[]>>;

export type FLSpielerPosition = (typeof FLSpielerPosition)[keyof typeof FLSpielerPosition];

export const FLSpielerPosition = {
  Tor: "Tor",
  Abwehr: "Abwehr",
  Mittelfeld: "Mittelfeld",
  Angriff: "Angriff",
} as const;

export type FLSpielerRolle = (typeof FLSpielerRolle)[keyof typeof FLSpielerRolle];

export const FLSpielerRolle = {
  kapitaen: "kapitaen",
  co_kapitaen: "co_kapitaen",
} as const;

/**
 * One squad row as its team's seat holder reads it (`READ-KADER-001`).
 *
 * Declared from nothing rather than a public model unmasked, so the whole surname reaches no
 * base-tier model, and no address or telephone number reaches this one.
 */
export interface FLKaderZeile {
  inactive_since: string | null;
  ist_nachnominiert: boolean;
  nachname: string | null;
  nummer: string | null;
  nummer_doppelt: boolean;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  /** @minLength 1 */
  vorname: string;
}

/**
 * A team's squad for one season, live and ausgetragen rows alike, with the Stufen the season's rules offer.
 */
export interface FLKaderResponse {
  /** @minItems 1 */
  erlaubte_stufen: FLSpielerStufe[];
  kader: FLKaderZeile[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * The row as a representative's edit or austragen left it, its shirt marker judged against the squad after the write.
 */
export interface FLKaderZeileResponse {
  inactive_since: string | null;
  ist_nachnominiert: boolean;
  nachname: string | null;
  nummer: string | null;
  nummer_doppelt: boolean;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  /** @minLength 1 */
  vorname: string;
}

export interface FLKontakt {
  email: string | null;
  telefon: string | null;
}

/**
 * One mailbox a write took off a seat of a season row, for the admin's notice; the server action reads it and the browser never does.
 */
export interface FLKontaktAbgang {
  bleibt_als: FLKontaktRolle[];
  email: string;
  rollen: FLKontaktRolle[];
  schule: string;
}

/**
 * One person's fresh confirmation link, RAW, for the admin action to mail; it is answered here and in no other response, ever.
 */
export interface FLKontaktMint {
  email: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  rollen: FLKontaktRolle[];
  schule: string;
  token: string;
  zeile: FLKontaktZeile;
}

/**
 * A fresh link for one seat, and its pair where the Trainer holds both; the old link then opens nothing.
 */
export interface FLKontaktEinladenResponse {
  bestaetigung: FLKontaktMint;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  saison_team_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLKontaktKenntnisnahmePayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  umfang: "kontaktdaten";
}

export interface FLKontaktPayload {
  /** @maxLength 254 */
  email: string;
  telefon: string | null;
}

export interface FLKontaktpersonPayload {
  einwilligung: FLKontaktKenntnisnahmePayload;
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  nachname: string;
  /** @pattern ^([+]?[ 0-9\-().]{2,19}[0-9])$ */
  telefon: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  vorname: string;
}

/**
 * The change the page showed: an administrator's later start replaces it, and the approval then reaches nothing.
 */
export interface FLKontoAdresswechselFreigabePayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * The approval, answered ONCE to the frontend's server, which mails the new mailbox its link.
 */
export interface FLKontoAdresswechselFreigabeResponse {
  email: string;
  gueltig_bis: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  token: string;
}

/**
 * The person's start, answered ONCE to the frontend's server, which mails both links and answers the browser neither.
 */
export interface FLKontoAdresswechselMintResponse {
  bisherige_email: string;
  email: string;
  /** @minimum 0 */
  genehmiger_anzahl: number;
  gueltig_bis: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  stopp_token: string;
  token: string;
  vorname: string;
}

/**
 * The address's live change as its own account page reads it.
 */
export interface FLKontoAdresswechselOffen {
  abgelaufen: boolean;
  email: string;
  genehmigung: FLAdresswechselGenehmigungStand | null;
  gueltig_bis: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  wartet_auf: FLAdresswechselWartetAuf;
  weg: FLAdresswechselWeg;
  wirksam_ab: string | null;
}

export interface FLKontoAdresswechselPayload {
  /** @maxLength 254 */
  email: string;
}

/**
 * Whether the signed-in address may change, and the change pending on it.
 */
export interface FLKontoAdresswechselResponse {
  moeglich: boolean;
  offen: FLKontoAdresswechselOffen | null;
}

/**
 * What the contact confirmation page's slots name for this seat today.
 */
export interface FLSitzKontext {
  saison: string;
  schule: string | null;
  team: string;
  vorname: string | null;
}

/**
 * One confirmation a person gave on a row: the seats it answered, its words and the floor its page named.
 */
export interface FLSitzBestaetigt {
  bestaetigt_am: string | null;
  kontext: FLSitzKontext;
  mindestalter: number;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  text_version: string;
}

/**
 * One pending application on which the address holds a confirmed contact seat, with its two choices to withdraw.
 *
 * Pending alone: an accepted application's seats are its season row's, listed under `sitze`.
 */
export interface FLKontoBewerbungSitzEinwilligung {
  /** @minItems 1 */
  bestaetigt: FLSitzBestaetigt[];
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  medien: boolean;
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  nachweis_stand: FLEinwilligungStand;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  schule: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * What the pupil confirmation page's slots name for this record today, so its agreed words render whole.
 *
 * Null where no squad row names a team and season; the words then render without them.
 */
export interface FLSpielerKontext {
  saison: string | null;
  schule: string | null;
  team: string | null;
}

/**
 * One pending registration its pupil confirmed: its choices to withdraw, and what it stores.
 */
export interface FLKontoRegistrierungEinwilligung {
  bestaetigt_text_version: string;
  geburtsdatum: string | null;
  kontext: FLSpielerKontext;
  medien: boolean | null;
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  mindestalter: number;
  nachname: string;
  nachweis_stand: FLEinwilligungStand;
  nummer: string | null;
  position: FLSpielerPosition | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string | null;
  umfang: FLEinwilligungUmfang | null;
  vorname: string;
}

/**
 * One referee record on the account page, for `FLKontoSpielerEinwilligung`'s reasons.
 */
export interface FLKontoSchiedsrichterEinwilligung {
  bestaetigt_text_version: string;
  einwilligung: FLEinwilligung;
  erteilbar: boolean;
  geburtsdatum?: string | null;
  honorar: number;
  inactive_since: string | null;
  kontakt: FLKontakt;
  medien_angeboten: boolean;
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  mindestalter: number;
  nachweis_stand: FLEinwilligungStand;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
  schule: string | null;
}

/**
 * One team season on which the address holds a confirmed contact seat, with its WhatsApp and media choices.
 *
 * Per season row and not per slot: one person holding two of a row's slots answers one choice for both.
 */
export interface FLKontoSitzEinwilligung {
  /** @minItems 1 */
  bestaetigt: FLSitzBestaetigt[];
  erteilbar: boolean;
  medien: boolean;
  medien_angeboten: boolean;
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  nachweis_stand: FLEinwilligungStand;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * One squad row as its own pupil reads it, with the name the club played that season under.
 */
export interface FLSpielerSelbstKaderZeile {
  inactive_since: string | null;
  ist_nachnominiert: boolean;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  saison_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
}

/**
 * The pupil's record on the account page: its stored data and the consent the page moves.
 */
export interface FLKontoSpielerEinwilligung {
  bestaetigt_text_version: string;
  einwilligung: FLEinwilligung;
  erteilbar: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  inactive_since: string | null;
  kader: FLSpielerSelbstKaderZeile[];
  kontext: FLSpielerKontext;
  medien_angeboten: boolean;
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  mindestalter: number;
  nachname: string | null;
  nachweis_stand: FLEinwilligungStand;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * Every confirmed consent record the signed-in address holds, for the account page; empty where it holds none.
 *
 * The referees a list where the pupil is one: `spieler.email` is unique, a referee's typed address is not.
 */
export interface FLKontoEinwilligungenResponse {
  bewerbungen: FLKontoBewerbungSitzEinwilligung[];
  registrierungen: FLKontoRegistrierungEinwilligung[];
  schiedsrichter: FLKontoSchiedsrichterEinwilligung[];
  sitze: FLKontoSitzEinwilligung[];
  spieler: FLKontoSpielerEinwilligung | null;
}

/**
 * One call's share of the season-after rule: what it erased, whom it passed over, and how many are still due.
 */
export interface FLLoeschungLaufResponse {
  abgeschlossene_saison_id: string | null;
  fehlgeschlagen: number;
  nach: string | null;
  registrierungen: number;
  saison_spieler: number;
  spieler: number;
  uebersprungen: number;
  verbleibend: number;
}

/**
 * How many pupils the run erases once this season is activated, counted and never named.
 */
export interface FLLoeschungVorschauResponse {
  abgeschlossene_saison_id: string | null;
  spieler: number;
}

/**
 * The stored person a confirmed registration's address resolves to, named so the team can be asked whether it is the same one.
 */
export interface FLRegistrierungPerson {
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  /** @minLength 1 */
  vorname: string;
  weicht_ab: boolean;
}

/**
 * One pending registration as the team deciding it reads it.
 */
export interface FLOffeneRegistrierung {
  aufnehmbar: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  eingereicht_am: string;
  /** @minLength 1 */
  nachname: string;
  nummer: string | null;
  nummer_doppelt: boolean;
  person: FLRegistrierungPerson | null;
  position: FLSpielerPosition | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  stufe: FLSpielerStufe | null;
  /** @minLength 1 */
  vorname: string;
}

/**
 * One team's pending registrations for one season, and whether that is the whole of them.
 */
export interface FLOffeneRegistrierungenResponse {
  registrierungen: FLOffeneRegistrierung[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  vollstaendig: boolean;
}

export interface FLPatchBerechtigungPayload {
  verwaltung: FLVerwaltung;
}

/**
 * What a team's seat holder may change on a live squad row, WHOLESALE for `FLPatchSpielerPayload`'s reason.
 *
 * Never `_SaisonSpielerPayload`'s child, which carries `team_id`: a representative moves no pupil
 * to another team, and `extra="forbid"` refuses that key.
 */
export interface FLPatchKaderZeilePayload {
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  stufe: FLSpielerStufe | null;
}

export interface FLPatchSaisonPayload {
  bewerbung: FLSaisonBewerbung | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
}

export interface FLPatchSaisonResponse {
  updated_document: FLSaison;
}

/**
 * Replaces the squad row WHOLESALE — see `FLPatchSpielerPayload` for why nothing has a default.
 *
 * `team_id` is editable here: a mid-season transfer is a change to the junction row.
 */
export interface FLPatchSaisonSpielerPayload {
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * The write side of the three, with the empty slot an erasure leaves.
 *
 * Three whole people is the editor's own guarantee
 * (`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontakteSection.tsx`).
 */
export interface FLSaisonTeamKontaktePayload {
  ansprechperson: FLKontaktpersonPayload | null;
  stellvertretung: FLKontaktpersonPayload | null;
  trainer: FLKontaktpersonPayload | null;
  trainer_ist_zugleich: FLTrainerZugleich | null;
}

/**
 * The contact block alone, plus the token naming which block it was composed against.
 *
 * `extra="forbid"`: a `gruppe` or an `austritt` sent here is a 422 rather than a value this
 * endpoint was never asked to decide.
 */
export interface FLPatchSaisonTeamKontaktePayload {
  kontakte: FLSaisonTeamKontaktePayload | null;
  kontakte_stand: string;
}

/**
 * The block as STORED after the write, its row, and the links it minted.
 *
 * No other field off that row: the caller sent none, and echoing one would invite a client to
 * believe this endpoint owns it.
 */
export interface FLPatchSaisonTeamKontakteResponse {
  abgaenge: FLKontaktAbgang[];
  bestaetigungen: FLKontaktMint[];
  kontakte: FLSaisonTeamKontakte | null;
  /** The AFTER image's token: this save has moved the row past what its caller read, so an undo of it can replay against no other. */
  readonly kontakte_stand: string;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  saison_team_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * The row's own fields. NO `kontakte`: `FLPatchSaisonTeamKontaktePayload` owns it.
 *
 * A stored contact is shapeless on read and bounded on write, so round-tripping it here refuses
 * every save a club with one bad row can make.
 */
export interface FLPatchSaisonTeamPayload {
  austritt: FLAustritt | null;
  gruppe: FLGruppenNames;
  trikot_farbe: FLTrikotFarbe | null;
}

export interface FLPatchSchiedsrichterPayload {
  /** @minimum 0 */
  default_payment: number;
  kontakt: FLKontaktPayload;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  name: string;
  schule: string | null;
}

/**
 * A freshly minted link, answered ONCE and stored nowhere.
 *
 * The raw token exists here and in the recipient's inbox; the database holds its hash. Admin-tier
 * whole — every mint answering it is on `app/api/schiedsrichter/admin_router.py`.
 */
export interface FLSchiedsrichterMint {
  /** @minLength 1 */
  email: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  token: string;
}

export interface FLSchiedsrichter {
  bestaetigung?: FLBestaetigung | null;
  /** @minimum 0 */
  default_payment: number;
  einwilligung?: FLEinwilligung | null;
  geburtsdatum?: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  kontakt: FLKontakt;
  name: string | null;
  schule: string | null;
}

export interface FLPatchSchiedsrichterResponse {
  bestaetigung: FLSchiedsrichterMint | null;
  fanned_out_to_spiele: number;
  updated_document: FLSchiedsrichter;
}

/**
 * The penalty shoot-out that settled a knockout fixture whose goals finished level.
 *
 * No `sieger`: a stored one could contradict the counts, and the `$expr` barring it is outside the
 * database validators' ratified scope.
 */
export interface FLSpielElfmeterschiessen {
  /** @minimum 0 */
  team1: number;
  /** @minimum 0 */
  team2: number;
}

/**
 * The venue as the admin PATCH SUBMITS it: which ground, and what this fixture pays for it.
 */
export interface FLSpielOrtFieldPayload {
  /** @minimum 0 */
  mietpreis: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielort_id: string;
}

/**
 * The referee as the admin PATCH SUBMITS it; `payment` stays for `mietpreis`' reason.
 */
export interface FLSpielSchiedsrichterFieldPayload {
  /** @minimum 0 */
  payment: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

export type FLSonderereignis = (typeof FLSonderereignis)[keyof typeof FLSonderereignis];

export const FLSonderereignis = {
  ausgefallen: "ausgefallen",
  nichtantreten_team1: "nichtantreten_team1",
  nichtantreten_team2: "nichtantreten_team2",
  abgebrochen: "abgebrochen",
  annulliert: "annulliert",
} as const;

/**
 * One side of a fixture as the admin PATCH SUBMITS it.
 *
 * No name and no shorthand: the server composes them from the season's `saison_teams` row.
 * A submitted copy is IGNORED rather than refused, as
 * the rule allows.
 */
export interface FLSpielTeamFieldPayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  tore: number | null;
}

export interface FLPatchSpielDataPayload {
  datum: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  notiz: string | null;
  ort: FLSpielOrtFieldPayload | null;
  schiedsrichter: FLSpielSchiedsrichterFieldPayload | null;
  schiedsrichter_stand: string | null;
  sonderereignis: FLSonderereignis | null;
  team1: FLSpielTeamFieldPayload | null;
  team1_quelle: FLSpielQuelleGruppe | FLSpielQuelleSpiel | null;
  team2: FLSpielTeamFieldPayload | null;
  team2_quelle: FLSpielQuelleGruppe | FLSpielQuelleSpiel | null;
  uhrzeit: string | null;
}

/**
 * One fixture the bracket resolution rewrote, and the result that rewrite destroyed.
 *
 * Every voided field is `None` where a slot merely filled from empty, so "was anything destroyed"
 * is a null check.
 */
export interface FLSpielAdvancement {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  voided_elfmeterschiessen: FLSpielElfmeterschiessen | null;
  voided_ergebnis: string | null;
  voided_sonderereignis: FLSonderereignis | null;
}

export type FLSpielReleasedSideSide = (typeof FLSpielReleasedSideSide)[keyof typeof FLSpielReleasedSideSide];

export const FLSpielReleasedSideSide = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * One side another fixture gave up so a team can play this Spieltag.
 *
 * `team_name` rather than an id: the message quoting this has no `spiele` list to join against,
 * and the rename fan-out keeps the copy it reads fresh.
 */
export interface FLSpielReleasedSide {
  side: FLSpielReleasedSideSide;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  /** @minLength 1 */
  team_name: string;
  voided_elfmeterschiessen: FLSpielElfmeterschiessen | null;
  voided_ergebnis: string | null;
  voided_sonderereignis: FLSonderereignis | null;
}

/**
 * What `patch_spiel_data` returns: every fixture it moved, and what that cost.
 *
 * Both lists report writes the caller did not ask for, each carrying the result it destroyed.
 */
export interface FLPatchSpielDataResponse {
  advanced_to: FLSpielAdvancement[];
  bracket_faults: (
    | FLBracketFaultGruppe
    | FLBracketFaultQuelle
    | FLBracketFaultSpiel
    | FLBracketFaultSlot
    | FLBracketFaultOccupant
    | FLBracketFaultSpieltag
    | FLBracketFaultBooking
    | FLBracketFaultClash
  )[];
  released_sides: FLSpielReleasedSide[];
}

/**
 * Replaces the person's names WHOLESALE.
 *
 * The handler `$set`s this model's dump, so a field with a default would let a form that forgot it
 * write that default over a stored value.
 */
export interface FLPatchSpielerPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  nachname: string | null;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  vorname: string;
}

export interface FLPatchSpielortPayload {
  address: FLAddressPayload;
  /** @minimum 0 */
  default_mietpreis: number;
  /** @minLength 1 */
  name: string;
}

export interface FLSpielort {
  address: FLAddress;
  /** @minimum 0 */
  default_mietpreis: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  /** @minLength 1 */
  maps_link: string;
  /** @minLength 1 */
  name: string;
}

export interface FLPatchSpielortResponse {
  fanned_out_to_spiele: number;
  updated_document: FLSpielort;
}

export interface FLPatchSpieltagPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  beginn: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  ende: string;
}

export interface FLPatchTeamPayload {
  address: FLAddressPayload;
  /** @maxLength 4096 */
  description: string;
  /**
   * @minLength 1
   * @maxLength 120
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  full_name: string;
  /**
   * @minLength 1
   * @maxLength 60
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  name: string;
  schulform: FLSchulform | null;
  /** @pattern ^\s*[A-Za-z]{3}\s*$ */
  shorthand: string;
  website_url: string | null;
}

/**
 * The club document as it is STORED, and what the write endpoints echo.
 *
 * The season-scoped fields would mean re-running the team pipeline, whose junction join is strict
 * -- and a club being created holds no row yet.
 */
export interface FLTeamRecord {
  address: FLAddress;
  /** @maxLength 4096 */
  description: string;
  /** @minLength 1 */
  full_name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  /** @minLength 1 */
  name: string;
  schulform: FLSchulform | null;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  website_url: string | null;
}

export interface FLPatchTeamResponse {
  fanned_out_to_saison_teams: number;
  fanned_out_to_spiele: number;
  updated_document: FLTeamRecord;
}

export interface FLPostBerechtigungPayload {
  /** @maxLength 254 */
  email: string;
}

export interface FLPostBerechtigungResponse {
  beantragt: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
}

/**
 * One school's application, as the public form submits it.
 *
 * `status`, `eingereicht_am` and `entscheidung` are on no payload: the server sets all three, so a
 * client can neither arrive already accepted nor backdate its own submission.
 */
export interface FLPostBewerbungPayload {
  kader: FLBewerbungKaderPayload;
  kontakte: FLBewerbungKontaktePayload;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  schule: FLBewerbungSchulePayload | null;
  /**
   * @minimum 1
   * @maximum 999
   */
  stufengroesse: number;
  team_id: string | null;
  trikot: FLBewerbungTrikotPayload;
  wunschgegner?: string | null;
}

/**
 * What the submission wrote, and nothing the submission carried.
 *
 * The three people's details went one way, and a body repeating them is a copy in a browser's
 * cache and in every proxy between.
 */
export interface FLPostBewerbungResponse {
  bestaetigungen: FLBewerbungBestaetigungTokens | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigungsfrist: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  eingereicht_am: string;
  saison_id: string;
}

/**
 * One pupil registering through a team's link.
 *
 * The league's own fields -- the team, the season, the state, the deadline and the confirmation
 * link -- are taken off the invite and the clock, never off this body.
 */
export interface FLPostRegistrierungPayload {
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  nachname: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  stufe: FLSpielerStufe | null;
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  vorname: string;
}

/**
 * The stored registration and a raw confirmation link, which no read ever answers.
 *
 * The database holds its hash alone, so a lost link is re-minted by the sweep's reminder rather
 * than recovered from any read.
 */
export interface FLPostRegistrierungResponse {
  bestaetigung_token: string | null;
  /** @minLength 1 */
  email: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  /** @minLength 1 */
  team: string;
}

export interface FLPostSaisonPayload {
  bewerbung: FLSaisonBewerbung | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  /**
   * @minLength 4
   * @maxLength 4
   * @pattern ^[0-9]+$
   */
  id: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
}

export interface FLPostSaisonResponse {
  created_id: string;
}

/**
 * One player's membership of one team's squad for one season.
 *
 * Every field is required, including those a squad often does not know: a caller states `null`
 * rather than omitting, so the answer is theirs and not a default nobody chose.
 */
export interface FLPostSaisonSpielerPayload {
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * One team's membership of one season. `team_id` comes from the path, `saison_id` from here.
 */
export interface FLPostSaisonTeamPayload {
  gruppe: FLGruppenNames;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
}

export interface FLPostSchiedsrichterPayload {
  /** @minimum 0 */
  default_payment: number;
  kontakt: FLKontaktPayload;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  name: string;
  schule: string | null;
}

export interface FLPostSchiedsrichterResponse {
  bestaetigung: FLSchiedsrichterMint;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
}

export interface FLPostSperrlistePayload {
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 500
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  grund: string;
}

/**
 * Answers the bound as well as the id: the mail telling the person names the season, and a second read would race the lapse.
 */
export interface FLPostSperrlisteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
  /**
   * @minLength 4
   * @maxLength 4
   */
  gesperrt_bis_saison_id: string;
}

export interface FLPostSpielortPayload {
  address: FLAddressPayload;
  /** @minimum 0 */
  default_mietpreis: number;
  /** @minLength 1 */
  name: string;
}

export interface FLPostTeamPayload {
  address: FLAddressPayload;
  /** @maxLength 4096 */
  description: string;
  /**
   * @minLength 1
   * @maxLength 120
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  full_name: string;
  /**
   * @minLength 1
   * @maxLength 60
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  name: string;
  schulform: FLSchulform | null;
  /** @pattern ^\s*[A-Za-z]{3}\s*$ */
  shorthand: string;
  website_url: string | null;
}

export interface FLPostTeamResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
}

/**
 * The sign-in addresses a pass of the account sweep asks about.
 */
export interface FLReferenzenPayload {
  /**
   * @minItems 1
   * @maxItems 250
   */
  identifiers: string[];
}

/**
 * Which of them nothing references, and nothing of the records that reference the others.
 */
export interface FLReferenzenResponse {
  unreferenziert: string[];
}

export type FLRefusedFieldIn = (typeof FLRefusedFieldIn)[keyof typeof FLRefusedFieldIn];

export const FLRefusedFieldIn = {
  body: "body",
  query: "query",
  path: "path",
  header: "header",
  cookie: "cookie",
} as const;

export interface FLRefusedField {
  in: FLRefusedFieldIn;
  kind: string;
  path: (string | number)[];
}

export interface FLRefusedPayloadBody {
  error_code: Code;
  fields: FLRefusedField[];
  trace_id: string;
}

/**
 * One registration's confirmation bookkeeping as an administrator reads it -- and NO `token_hash`.
 *
 * The hash is a raw document key the confirmation query alone reads, as
 * `app/api/bewerbungen/schemas.py :: FLBewerbungBestaetigung` keeps its own off the wire.
 */
export interface FLRegistrierungBestaetigung {
  erinnert_am: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  verschickt_am: string;
  zustellung?: FLBewerbungZustellung | null;
}

/**
 * A pending registration's consent record, each choice and `datum` optional here alone.
 *
 * A returning pupil's page asks no choice.
 */
export interface FLRegistrierungEinwilligung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigt_am: string;
  datum?: string | null;
  medien?: boolean | null;
  nachweis?: FLEinwilligungNachweise;
  text_version: string;
  umfang?: FLEinwilligungUmfang | null;
}

/**
 * A decision as the list serves it: the stored one, its decider withheld where the ban list holds that address.
 */
export interface FLRegistrierungEntscheidungZeile {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  getroffen_am: string;
  grund: string | null;
  von: string | null;
  von_gesperrt: boolean;
}

/**
 * One pupil's registration for one team's season, as stored, its decision as served.
 *
 * The submission is never rewritten: its pupil fills and withdraws `einwilligung` and fills
 * `geburtsdatum`, and a decline writes `status` and `entscheidung`.
 */
export interface FLRegistrierung {
  bestaetigt: boolean;
  bestaetigung: FLRegistrierungBestaetigung | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  eingereicht_am: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  einladung_id: string;
  einwilligung: FLRegistrierungEinwilligung | null;
  /** @minLength 1 */
  email: string;
  entscheidung: FLRegistrierungEntscheidungZeile | null;
  geburtsdatum: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  nachname: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  saison_id: string;
  status: FLRegistrierungStatus;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * Why the team declines, from a closed set or not at all.
 */
export interface FLRegistrierungAblehnenPayload {
  grund: "andere_person" | null;
}

/**
 * What the decline mail needs, answered to the frontend's server and never further.
 */
export interface FLRegistrierungAblehnungResponse {
  bestaetigt: boolean;
  /** @minLength 1 */
  email: string;
  grund: "andere_person" | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  /** @minLength 1 */
  team: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * The squad entry the admission wrote, and the person it belongs to.
 */
export interface FLRegistrierungAufnahmeResponse {
  ist_nachnominiert: boolean;
  /** @minLength 1 */
  nachname: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * The team's answer to the question the read asked: the person this registration is admitted into, or none.
 */
export interface FLRegistrierungAufnehmenPayload {
  spieler_id: string | null;
}

/**
 * A POST that reads: the token travels in a body, never in a second URL.
 */
export interface FLRegistrierungBestaetigungAnsichtPayload {
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
}

export type FLRegistrierungBestaetigungAnsichtResponseSeite =
  (typeof FLRegistrierungBestaetigungAnsichtResponseSeite)[keyof typeof FLRegistrierungBestaetigungAnsichtResponseSeite];

export const FLRegistrierungBestaetigungAnsichtResponseSeite = {
  bestaetigung_spieler: "bestaetigung_spieler",
  bestaetigung_spieler_wiederkehrend: "bestaetigung_spieler_wiederkehrend",
} as const;

export type FLRegistrierungBestaetigungAnsichtResponseZustand =
  (typeof FLRegistrierungBestaetigungAnsichtResponseZustand)[keyof typeof FLRegistrierungBestaetigungAnsichtResponseZustand];

export const FLRegistrierungBestaetigungAnsichtResponseZustand = {
  gueltig: "gueltig",
  bestaetigt: "bestaetigt",
  abgelaufen: "abgelaufen",
  gesperrt: "gesperrt",
} as const;

/**
 * What one confirmation link opens, and no field past the ones declared here.
 */
export interface FLRegistrierungBestaetigungAnsichtResponse {
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  mindestalter: number;
  saison_id: string;
  /** @minLength 1 */
  schule: string;
  seite: FLRegistrierungBestaetigungAnsichtResponseSeite;
  /** @minLength 1 */
  team: string;
  zustand: FLRegistrierungBestaetigungAnsichtResponseZustand;
}

export type FLRegistrierungBestaetigungPayloadUmfang =
  (typeof FLRegistrierungBestaetigungPayloadUmfang)[keyof typeof FLRegistrierungBestaetigungPayloadUmfang] | null;

export const FLRegistrierungBestaetigungPayloadUmfang = {
  kader_oeffentlich: "kader_oeffentlich",
  intern: "intern",
} as const;

/**
 * One pupil's own answer: their date of birth where the page asks it, and on the new pupil's page the two consents.
 */
export interface FLRegistrierungBestaetigungPayload {
  geburtsdatum: string | null;
  medien: boolean | null;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  /**
   * @minLength 1
   * @maxLength 128
   */
  token: string;
  umfang: FLRegistrierungBestaetigungPayloadUmfang;
}

export type FLRegistrierungBestaetigungResponseUmfang =
  (typeof FLRegistrierungBestaetigungResponseUmfang)[keyof typeof FLRegistrierungBestaetigungResponseUmfang] | null;

export const FLRegistrierungBestaetigungResponseUmfang = {
  kader_oeffentlich: "kader_oeffentlich",
  intern: "intern",
} as const;

/**
 * What the pupil just recorded, echoed so the answer panel states it rather than opening the link a second time.
 */
export interface FLRegistrierungBestaetigungResponse {
  ergebnis: "bestaetigt";
  geburtsdatum: string | null;
  medien: boolean | null;
  umfang: FLRegistrierungBestaetigungResponseUmfang;
}

export type FLRegistrierungSelbstEinwilligungPayloadUmfang =
  (typeof FLRegistrierungSelbstEinwilligungPayloadUmfang)[keyof typeof FLRegistrierungSelbstEinwilligungPayloadUmfang];

export const FLRegistrierungSelbstEinwilligungPayloadUmfang = {
  kader_oeffentlich: "kader_oeffentlich",
  intern: "intern",
} as const;

/**
 * The pupil's own two choices on one pending registration, the pupil's account control's shape: a grant is refused.
 */
export interface FLRegistrierungSelbstEinwilligungPayload {
  medien: boolean;
  nachweis_stand: FLEinwilligungStandPayload;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  umfang: FLRegistrierungSelbstEinwilligungPayloadUmfang;
}

/**
 * The registration's consent record as it stands after the write, everything the pupil did not move unchanged.
 */
export interface FLRegistrierungSelbstEinwilligungResponse {
  einwilligung: FLRegistrierungEinwilligung;
  nachweis_stand: FLEinwilligungStand;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
}

/**
 * One pupil whose confirmed registration was erased at its season's end, and who is told after the fact.
 *
 * No token and no deadline: the row is gone, and this message asks for nothing.
 */
export interface FLRegistrierungSweepBenachrichtigung {
  /** @minLength 1 */
  email: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  team: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * One reminder to send: a pupil whose link has reached its reminder age and who has not answered it.
 *
 * The token is the RAW fresh one.
 */
export interface FLRegistrierungSweepErinnerung {
  /** @minLength 1 */
  email: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  team: string;
  /** @minLength 1 */
  token: string;
}

/**
 * One season's pass: the reminders already stamped, the erasures already made, and the one note each of them owes.
 */
export interface FLRegistrierungSweepResponse {
  benachrichtigt: FLRegistrierungSweepBenachrichtigung[];
  erinnerungen: FLRegistrierungSweepErinnerung[];
  fehlgeschlagen: number;
  geloescht_abgelehnt: number;
  geloescht_ohne_entscheidung: number;
  geloescht_unbestaetigt: number;
  redigierte_aktionen: number;
  saison_id: string;
}

/**
 * The pending rows, newest first, and whether that is the whole of them.
 */
export interface FLRegistrierungenListResponse {
  registrierungen: FLRegistrierung[];
  vollstaendig: boolean;
}

/**
 * Which club takes this season's row over. The path names the club going OUT.
 */
export interface FLReplaceSaisonTeamPayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  incoming_team_id: string;
}

/**
 * The junction row as the replacement left it, plus what it reached beyond that row.
 *
 * `austritt` is cleared and not echoed: a club that has not withdrawn needs nothing done about it.
 */
export interface FLReplaceSaisonTeamResponse {
  ausgetragene_squad_rows: number;
  fanned_out_to_spiele: number;
  gruppe: FLGruppenNames;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  incoming_team_id: string;
  kontakte: FLSaisonTeamKontakte | null;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  outgoing_team_id: string;
  saison_id: string;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * A junction row, which has no read model of its own -- so it is echoed as it was written.
 */
export interface FLSaisonSpielerResponse {
  inactive_since: string | null;
  ist_nachnominiert: boolean;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLSaisonTeamAdresswechselVerwehrt {
  ansprechperson: FLAdresswechselEinsehbarVerwehrt | null;
  stellvertretung: FLAdresswechselEinsehbarVerwehrt | null;
  trainer: FLAdresswechselEinsehbarVerwehrt | null;
}

/**
 * The live change of each confirmed seat's address, which the address tool shows.
 *
 * Null where none stands, the seat is empty, or its person never confirmed it, the change moving nothing of theirs.
 */
export interface FLSaisonTeamAdresswechsel {
  ansprechperson: string | null;
  einsehbar_verwehrt: FLSaisonTeamAdresswechselVerwehrt;
  stellvertretung: string | null;
  trainer: string | null;
}

/**
 * One seat's link as the contacts editor reads it: the stored link and whether it has lapsed.
 */
export interface FLSaisonTeamBestaetigungAnsicht {
  abgelaufen: boolean;
  abgelehnt_am: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  verschickt_am: string;
  zustellung?: FLBewerbungZustellung | null;
}

export interface FLSaisonTeamBestaetigungenAnsicht {
  ansprechperson: FLSaisonTeamBestaetigungAnsicht | null;
  stellvertretung: FLSaisonTeamBestaetigungAnsicht | null;
  trainer: FLSaisonTeamBestaetigungAnsicht | null;
}

export type FLSaisonTeamEinwilligungAntwortResponseErgebnis =
  (typeof FLSaisonTeamEinwilligungAntwortResponseErgebnis)[keyof typeof FLSaisonTeamEinwilligungAntwortResponseErgebnis];

export const FLSaisonTeamEinwilligungAntwortResponseErgebnis = {
  bestaetigt: "bestaetigt",
  abgelehnt: "abgelehnt",
} as const;

/**
 * What an answer on a season row's link did, and nothing to compose a message from.
 *
 * No application stands behind the seat, so nobody is told.
 */
export interface FLSaisonTeamEinwilligungAntwortResponse {
  ergebnis: FLSaisonTeamEinwilligungAntwortResponseErgebnis;
  geburtsdatum: string | null;
  medien: boolean;
  quelle: "saison";
  whatsapp: boolean;
}

export interface FLSaisonTeamPersonEinwilligungPayload {
  medien: boolean;
  nachweis_stand: FLEinwilligungStandPayload;
  /**
   * @minLength 1
   * @maxLength 64
   */
  text_version: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * Which of the row's seats the press reached, and the two answers they now all hold.
 */
export interface FLSaisonTeamPersonEinwilligungResponse {
  medien: boolean;
  nachweis_stand: FLEinwilligungStand;
  rollen: FLKontaktRolle[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * A junction row, which has no read model of its own -- so it is echoed as it was written.
 */
export interface FLSaisonTeamResponse {
  austritt: FLAustritt | null;
  gruppe: FLGruppenNames;
  kontakte: FLSaisonTeamKontakte | null;
  /** @minLength 1 */
  name: string;
  saison_id: string;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  trikot_farbe: FLTrikotFarbe | null;
}

export interface FLSaisonsListResponse {
  format: "list";
  saisons: FLSaison[];
}

export interface FLSaisonsSingleResponse {
  format: "single";
  saison: FLSaison;
}

/**
 * What one confirmation link opens, and nothing a leaked one should not learn (`READ-REFEREE-002`).
 *
 * Never a name, the school, the contact details, the fee, the birthdate or the id.
 */
export interface FLSchiedsrichterBestaetigungAnsichtResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @exclusiveMinimum 0 */
  medien_mindestalter: number;
  mindestalter: number;
  zustand: FLBestaetigungZustand;
}

export interface FLSchiedsrichterBestaetigungPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  medien: boolean;
  /**
   * @minLength 1
   * @maxLength 64
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  text_version: string;
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
  umfang: FLEinwilligungUmfang;
}

/**
 * What the person just recorded, read back off the updated document.
 *
 * Bounded by `READ-REFEREE-002` as the view above is: the page confirms the answer, and a
 * caller holding a leaked token learns nothing it did not already post.
 */
export interface FLSchiedsrichterBestaetigungResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bestaetigt_am: string;
  medien: boolean;
  umfang: FLEinwilligungUmfang;
}

export interface FLSchiedsrichterListResponse {
  schiedsrichter: FLSchiedsrichter[];
}

/**
 * The re-send's answer. Never null: where no link may be minted a refusal answers instead.
 */
export interface FLSchiedsrichterMintResponse {
  bestaetigung: FLSchiedsrichterMint;
}

/**
 * The reactivation's answer: its own rather than the retire's, being the one of the pair that can mint.
 */
export interface FLSchiedsrichterReactivateResponse {
  bestaetigung: FLSchiedsrichterMint | null;
  updated_document: FLSchiedsrichter;
}

/**
 * One referee record's stored data as its own person reads it: contact details and fee, never the link's bookkeeping.
 *
 * For `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason, the account page's entry extends it.
 */
export interface FLSchiedsrichterSelbst {
  geburtsdatum?: string | null;
  honorar: number;
  kontakt: FLKontakt;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
  schule: string | null;
}

/**
 * The record as it stands after the write, everything the person did not move unchanged.
 */
export interface FLSchiedsrichterSelbstEinwilligungResponse {
  einwilligung: FLEinwilligung;
  nachweis_stand: FLEinwilligungStand;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * Every confirmed referee record the signed-in address holds, the ghost never among them.
 */
export interface FLSchiedsrichterSelbstResponse {
  schiedsrichter: FLSchiedsrichterSelbst[];
}

export interface FLSchiedsrichterSingleResponse {
  adresswechsel_einsehbar_verwehrt: FLAdresswechselEinsehbarVerwehrt | null;
  adresswechsel_id: string | null;
  bestaetigung_abgelaufen: boolean;
  schiedsrichter: FLSchiedsrichter;
}

/**
 * The referee as a retirement leaves them.
 */
export interface FLSchiedsrichterWriteResponse {
  updated_document: FLSchiedsrichter;
}

/**
 * A pupil's, a referee's or a registration's own two choices on their record.
 *
 * Both choices on every press, and no member defaulted: a default would let a page that forgot one
 * reset the person's other choice.
 */
export interface FLSelbstEinwilligungPayload {
  medien: boolean;
  nachweis_stand: FLEinwilligungStandPayload;
  /**
   * @minLength 1
   * @maxLength 64
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  text_version: string;
  umfang: FLEinwilligungUmfang;
}

/**
 * One seat on an application, of any status.
 */
export interface FLSelbstErasureBewerbung {
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  vorname: string;
}

/**
 * One registration, pending or declined.
 */
export interface FLSelbstErasureRegistrierung {
  nachname: string;
  saison_id: string;
  team_name: string | null;
  vorname: string;
}

export interface FLSelbstErasureSchiedsrichter {
  name: string | null;
}

/**
 * One seat on a team's season row, named as the row names it.
 */
export interface FLSelbstErasureSitz {
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  team_name: string;
  vorname: string;
}

export interface FLSelbstErasureSpieler {
  nachname: string | null;
  vorname: string;
}

export interface FLSelbstErasureAnsichtResponse {
  /** @minimum 0 */
  adresswechsel: number;
  bewerbungen: FLSelbstErasureBewerbung[];
  letzter_inhaber: boolean;
  registrierungen: FLSelbstErasureRegistrierung[];
  schiedsrichter: FLSelbstErasureSchiedsrichter[];
  sitze: FLSelbstErasureSitz[];
  spieler: FLSelbstErasureSpieler[];
  verwaltung: FLVerwaltung | null;
}

/**
 * One ban as the list serves it: the stored row, its author withheld where the ban list holds that address too.
 */
export interface FLSperrlisteZeile {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  erstellt_am: string;
  erstellt_von: string | null;
  erstellt_von_gesperrt: boolean;
  /**
   * @minLength 4
   * @maxLength 4
   */
  gesperrt_bis_saison_id: string;
  /** @minLength 1 */
  grund: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * The bans, newest first, and how many there are.
 *
 * `anzahl_gesamt` is what makes a ban past the cap liftable: one enforced and not rendered is a
 * person barred by a row nobody can reach.
 */
export interface FLSperrlisteListResponse {
  /** @minimum 0 */
  anzahl_gesamt: number;
  sperrliste: FLSperrlisteZeile[];
}

/**
 * The removal is hard, so the id is all there is to answer with: no document survives to echo.
 */
export interface FLSperrlisteWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  sperrliste_id: string;
}

/**
 * The venue as a BASE-TIER read serves it: which ground, and where to find it.
 *
 * No `mietpreis`: what one fixture agreed to pay is admin-tier (`READ-MONEY-001`).
 */
export interface FLSpielOrtFieldPublic {
  /** @minLength 1 */
  maps_link: string;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielort_id: string;
}

/**
 * The referee as a BASE-TIER read serves it: on their consent, a forename and a surname initial (`READ-REFEREE-001`, `-004`).
 *
 * `payment` is withheld for `mietpreis`' reason, and the record's id under `READ-REFEREE-006`.
 */
export interface FLSpielSchiedsrichterFieldPublic {
  name: string | null;
  name_is_public?: boolean;
}

/**
 * One side as a BASE-TIER read serves it, produced only by `build_spiele_pipeline`.
 *
 * Narrower than the junction row: every public surface listing a fixture carries this side, and
 * only a club's own page renders the free text a withdrawal names.
 */
export interface FLSpielTeamFieldJoined {
  austritt_type: FLAustrittType | null;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  tore: number | null;
}

/**
 * One fixture as a BASE-TIER endpoint serves it: stored fields plus each side's joined season state.
 *
 * A model rather than a default on the stored side, which would make every internal read of a raw
 * document quietly assert that nobody is disqualified.
 */
export interface FLSpielJoined {
  ansetzung_bestaetigt: boolean | null;
  datum: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  notiz?: string | null;
  ort: FLSpielOrtFieldPublic | null;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  saison_phase: FLSaisonPhase;
  schiedsrichter: FLSpielSchiedsrichterFieldPublic | null;
  sonderereignis: FLSonderereignis | null;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  team1: FLSpielTeamFieldJoined | null;
  team1_quelle: FLSpielQuelleGruppe | FLSpielQuelleSpiel | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelleGruppe | FLSpielQuelleSpiel | null;
  uhrzeit: string | null;
}

/**
 * The venue as the DOCUMENT holds it, and as the admin editor reads it back to round-trip the rent.
 */
export interface FLSpielOrtField {
  /** @minLength 1 */
  maps_link: string;
  /** @minimum 0 */
  mietpreis: number;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielort_id: string;
}

/**
 * The referee as the DOCUMENT holds it, and as the admin editor reads it back.
 */
export interface FLSpielSchiedsrichterField {
  name: string | null;
  /** @minimum 0 */
  payment: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * The same fixture, carrying the two figures the base tier withholds (`READ-MONEY-001`).
 *
 * A second model rather than a projection per caller: a response whose shape follows the
 * credential is one no Zod mirror can express.
 */
export interface FLSpielJoinedAdmin {
  ansetzung_bestaetigt: boolean | null;
  datum: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  notiz?: string | null;
  ort: FLSpielOrtField | null;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  saison_phase: FLSaisonPhase;
  schiedsrichter: FLSpielSchiedsrichterField | null;
  sonderereignis: FLSonderereignis | null;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  team1: FLSpielTeamFieldJoined | null;
  team1_quelle: FLSpielQuelleGruppe | FLSpielQuelleSpiel | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelleGruppe | FLSpielQuelleSpiel | null;
  uhrzeit: string | null;
}

export type FLSpielSeite = (typeof FLSpielSeite)[keyof typeof FLSpielSeite];

export const FLSpielSeite = {
  team1: "team1",
  team2: "team2",
} as const;

export type FLSpielberichtAdminResponseSeitenGeaendertItem =
  (typeof FLSpielberichtAdminResponseSeitenGeaendertItem)[keyof typeof FLSpielberichtAdminResponseSeitenGeaendertItem];

export const FLSpielberichtAdminResponseSeitenGeaendertItem = {
  team1: "team1",
  team2: "team2",
} as const;

export type FLSpielberichtAdminResponseZustand =
  (typeof FLSpielberichtAdminResponseZustand)[keyof typeof FLSpielberichtAdminResponseZustand] | null;

export const FLSpielberichtAdminResponseZustand = {
  vorgeschlagen: "vorgeschlagen",
  uebernommen: "uebernommen",
  abweichend: "abweichend",
  abgesagt: "abgesagt",
  teams_geaendert: "teams_geaendert",
} as const;

export interface FLSpielberichtVonSchiedsrichter {
  art: "schiedsrichter";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * An administrator who wrote the block first, naming nobody, as an administrator's settle does.
 */
export const FLSpielberichtVonAdminValue = {
  art: "admin",
} as const;
export type FLSpielberichtVonAdmin = typeof FLSpielberichtVonAdminValue;

export type FLSpielberichtVorschlagSonderereignis =
  (typeof FLSpielberichtVorschlagSonderereignis)[keyof typeof FLSpielberichtVorschlagSonderereignis] | null;

export const FLSpielberichtVorschlagSonderereignis = {
  abgebrochen: "abgebrochen",
  nichtantreten_team1: "nichtantreten_team1",
  nichtantreten_team2: "nichtantreten_team2",
} as const;

/**
 * The referee's proposed result, which only the administrator's own save applies.
 *
 * Both counts null on a no-show alone: the save composes its goals from the season's forfeit, which typed goals
 * could never equal.
 */
export interface FLSpielberichtVorschlag {
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  sonderereignis: FLSpielberichtVorschlagSonderereignis;
  team1_tore: number | null;
  team2_tore: number | null;
}

export type FLSpielberichtKarteFarbe = (typeof FLSpielberichtKarteFarbe)[keyof typeof FLSpielberichtKarteFarbe];

export const FLSpielberichtKarteFarbe = {
  gelb: "gelb",
  gelb_rot: "gelb_rot",
  rot: "rot",
} as const;

export type FLSpielberichtKarteGrund = (typeof FLSpielberichtKarteGrund)[keyof typeof FLSpielberichtKarteGrund] | null;

export const FLSpielberichtKarteGrund = {
  foulspiel: "foulspiel",
  unsportlichkeit: "unsportlichkeit",
  handspiel: "handspiel",
  meckern: "meckern",
  spielverzoegerung: "spielverzoegerung",
  wiederholtes_foulspiel: "wiederholtes_foulspiel",
  grobes_foulspiel: "grobes_foulspiel",
  taetlichkeit: "taetlichkeit",
  beleidigung: "beleidigung",
  notbremse: "notbremse",
} as const;

export type FLSpielberichtKarteSeite = (typeof FLSpielberichtKarteSeite)[keyof typeof FLSpielberichtKarteSeite];

export const FLSpielberichtKarteSeite = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * One card as stored, its reason null on a red card and on every card once the end of the season after the match strips the reasons.
 */
export interface FLSpielberichtKarte {
  farbe: FLSpielberichtKarteFarbe;
  grund: FLSpielberichtKarteGrund;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  seite: FLSpielberichtKarteSeite;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

/**
 * The clubs the fixture fielded at the block's last write, null on a slot then open.
 *
 * Stamped by every write and on no payload: entries go by side, and a knockout correction can re-field one.
 */
export interface FLSpielberichtSeiten {
  team1: string | null;
  team2: string | null;
}

export type FLSpielberichtTorschuetzeSeite = (typeof FLSpielberichtTorschuetzeSeite)[keyof typeof FLSpielberichtTorschuetzeSeite];

export const FLSpielberichtTorschuetzeSeite = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one.
 */
export interface FLSpielberichtTorschuetze {
  eigentor: boolean;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  seite: FLSpielberichtTorschuetzeSeite;
  spieler_id: string | null;
}

export const FLSpielberichtUebernommenVonValue = {
  art: "admin",
} as const;
export type FLSpielberichtUebernommenVon = typeof FLSpielberichtUebernommenVonValue;

/**
 * The referee's account of one match, one proposal, a correction after its adoption reading `abweichend`.
 *
 * `version` rises with each write of the content and the adoption records the one it took: adopted means equal, never
 * a clock.
 */
export interface FLSpielberichtBericht {
  bemerkungen: string | null;
  eingereicht_am: string;
  eingereicht_von: FLSpielberichtVonSchiedsrichter | FLSpielberichtVonAdmin;
  ergebnis_vorschlag: FLSpielberichtVorschlag;
  geaendert_am: string;
  karten: FLSpielberichtKarte[];
  seiten: FLSpielberichtSeiten;
  torschuetzen: FLSpielberichtTorschuetze[];
  uebernommen_am: string | null;
  uebernommen_von: FLSpielberichtUebernommenVon | null;
  uebernommene_version: number | null;
  version: number;
}

/**
 * A pupil a report may name or names, with the names their record holds, both null where an erasure took the record.
 */
export interface FLSpielberichtSpieler {
  nachname: string | null;
  nummer: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  vorname: string | null;
}

/**
 * Each side's live squad of the season, the pupils a new entry may name.
 */
export interface FLSpielberichtKader {
  team1: FLSpielberichtSpieler[];
  team2: FLSpielberichtSpieler[];
}

export interface FLSpielberichtTeam {
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * The fixture a report is about, as its form states it: no money, no booking, no result.
 */
export interface FLSpielberichtSpiel {
  datum: string | null;
  saison_id: string;
  saison_phase: FLSaisonPhase;
  sonderereignis: FLSonderereignis | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  team1: FLSpielberichtTeam | null;
  team2: FLSpielberichtTeam | null;
  uhrzeit: string | null;
}

/**
 * The administrator's panel, with the state the report reads in, null exactly where no block stands.
 *
 * Both squads empty unless the read asks `kader`, the correction's form; a write answers them always.
 */
export interface FLSpielberichtAdminResponse {
  bericht: FLSpielberichtBericht | null;
  genannt: FLSpielberichtSpieler[];
  kader: FLSpielberichtKader;
  seiten_geaendert: FLSpielberichtAdminResponseSeitenGeaendertItem[];
  spiel: FLSpielberichtSpiel;
  zustand: FLSpielberichtAdminResponseZustand;
}

export type FLSpielberichtKartePayloadFarbe = (typeof FLSpielberichtKartePayloadFarbe)[keyof typeof FLSpielberichtKartePayloadFarbe];

export const FLSpielberichtKartePayloadFarbe = {
  gelb: "gelb",
  gelb_rot: "gelb_rot",
  rot: "rot",
} as const;

export type FLSpielberichtKartePayloadGrund = (typeof FLSpielberichtKartePayloadGrund)[keyof typeof FLSpielberichtKartePayloadGrund] | null;

export const FLSpielberichtKartePayloadGrund = {
  foulspiel: "foulspiel",
  unsportlichkeit: "unsportlichkeit",
  handspiel: "handspiel",
  meckern: "meckern",
  spielverzoegerung: "spielverzoegerung",
  wiederholtes_foulspiel: "wiederholtes_foulspiel",
  grobes_foulspiel: "grobes_foulspiel",
  taetlichkeit: "taetlichkeit",
  beleidigung: "beleidigung",
  notbremse: "notbremse",
} as const;

export type FLSpielberichtKartePayloadSeite = (typeof FLSpielberichtKartePayloadSeite)[keyof typeof FLSpielberichtKartePayloadSeite];

export const FLSpielberichtKartePayloadSeite = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * One card as a write sends it.
 *
 * A caution's reason is judged against the stored block, never here: a correction after the strip resends the
 * cautions whose reasons it stripped (`app/api/spielberichte/services.py :: find_grund_fehlt_refusal`).
 */
export interface FLSpielberichtKartePayload {
  farbe: FLSpielberichtKartePayloadFarbe;
  grund: FLSpielberichtKartePayloadGrund;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  seite: FLSpielberichtKartePayloadSeite;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

export interface FLSpielberichtBerichtPayload {
  bemerkungen: string | null;
  ergebnis_vorschlag: FLSpielberichtVorschlag;
  /** @maxItems 60 */
  karten: FLSpielberichtKartePayload[];
  /** @maxItems 60 */
  torschuetzen: FLSpielberichtTorschuetze[];
}

/**
 * The whole `bericht` block, written wholesale by the referee's PUT and the administrator's PATCH alike.
 */
export interface FLSpielberichtPayload {
  bericht: FLSpielberichtBerichtPayload;
  bericht_stand: number | null;
}

/**
 * One played fixture booked to the signed-in referee, and when its report, whoever wrote it, was first sent.
 */
export interface FLSpielberichtPersonEintrag {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  eingereicht_am: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  team1_name: string | null;
  team2_name: string | null;
  uhrzeit: string | null;
}

/**
 * One reported fixture of an ended season, its date null where it was cleared after the report: the report still stands.
 */
export interface FLSpielberichtPersonFruehererEintrag {
  datum: string | null;
  eingereicht_am: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  team1_name: string | null;
  team2_name: string | null;
  uhrzeit: string | null;
}

export type FLSpielberichtSchiedsrichterResponseSeitenGeaendertItem =
  (typeof FLSpielberichtSchiedsrichterResponseSeitenGeaendertItem)[keyof typeof FLSpielberichtSchiedsrichterResponseSeitenGeaendertItem];

export const FLSpielberichtSchiedsrichterResponseSeitenGeaendertItem = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * The booked referee's form: the remarks and the card reasons included, and no `zustand`.
 */
export interface FLSpielberichtSchiedsrichterResponse {
  abgeschlossen: boolean;
  bericht: FLSpielberichtBericht | null;
  genannt: FLSpielberichtSpieler[];
  kader: FLSpielberichtKader;
  seiten_geaendert: FLSpielberichtSchiedsrichterResponseSeitenGeaendertItem[];
  spiel: FLSpielberichtSpiel;
}

export type FLSpielberichtZustandEintragZustand =
  (typeof FLSpielberichtZustandEintragZustand)[keyof typeof FLSpielberichtZustandEintragZustand];

export const FLSpielberichtZustandEintragZustand = {
  vorgeschlagen: "vorgeschlagen",
  uebernommen: "uebernommen",
  abweichend: "abweichend",
  abgesagt: "abgesagt",
  teams_geaendert: "teams_geaendert",
} as const;

/**
 * One fixture's report as the triage reads it: its state and what it proposes.
 */
export interface FLSpielberichtZustandEintrag {
  ergebnis_vorschlag: FLSpielberichtVorschlag;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  zustand: FLSpielberichtZustandEintragZustand;
}

/**
 * `spiele` of the running season, which the referee reports on; `fruehere` of ended ones, each holding a report they only read.
 */
export interface FLSpielberichtePersonResponse {
  fruehere: FLSpielberichtPersonFruehererEintrag[];
  spiele: FLSpielberichtPersonEintrag[];
}

/**
 * Every report of one season that holds a block, each with its state.
 */
export interface FLSpielberichteSaisonResponse {
  spielberichte: FLSpielberichtZustandEintrag[];
}

/**
 * The Ansetzung a row answers about: every input of `stand`, stored beside it.
 *
 * A digest is opaque to an aggregation, so the public fixture's verdict compares these five values
 * rather than `stand` (`app/api/spielbestaetigungen/services.py :: ANSETZUNG_QUELLEN`).
 */
export interface FLSpielbestaetigungAnsetzung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  spielort_id: string | null;
  stand: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team1_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team2_id: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  uhrzeit: string;
}

export type FLSpielbestaetigungAntwortArt = (typeof FLSpielbestaetigungAntwortArt)[keyof typeof FLSpielbestaetigungAntwortArt];

export const FLSpielbestaetigungAntwortArt = {
  zugesagt: "zugesagt",
  abgelehnt: "abgelehnt",
} as const;

/**
 * The seat whose link was pressed, never the person: two seats one person holds share a link, and the first seat in order is recorded.
 */
export interface FLSpielbestaetigungVonKontakt {
  art: "kontakt";
  rolle: FLKontaktRolle;
}

/**
 * An administrator's act, naming nobody: the record keeps how a thing was settled, not who typed it.
 */
export const FLVonAdminValue = {
  art: "admin",
} as const;
export type FLVonAdmin = typeof FLVonAdminValue;

export const FLSpielbestaetigungVonSchiedsrichterValue = {
  art: "schiedsrichter",
} as const;
export type FLSpielbestaetigungVonSchiedsrichter = typeof FLSpielbestaetigungVonSchiedsrichterValue;

/**
 * A date and time without a ground: a team's proposal, and the slot a moved fixture left.
 */
export interface FLSpielbestaetigungTermin {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  uhrzeit: string;
}

/**
 * Written once, while the row is open: a second press finds the row answered and changes nothing.
 */
export interface FLSpielbestaetigungAntwort {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  am: string;
  art: FLSpielbestaetigungAntwortArt;
  begruendung: string | null;
  von: FLSpielbestaetigungVonKontakt | FLVonAdmin | FLSpielbestaetigungVonSchiedsrichter;
  vorschlag: FLSpielbestaetigungTermin | null;
}

export type FLSpielbestaetigungGeschlossenGrund =
  (typeof FLSpielbestaetigungGeschlossenGrund)[keyof typeof FLSpielbestaetigungGeschlossenGrund];

export const FLSpielbestaetigungGeschlossenGrund = {
  ansetzung_geaendert: "ansetzung_geaendert",
  austritt: "austritt",
  spiel_entschieden: "spiel_entschieden",
  abgesagt: "abgesagt",
  schiedsrichter_gewechselt: "schiedsrichter_gewechselt",
  schiedsrichter_abgelehnt: "schiedsrichter_abgelehnt",
  verworfen: "verworfen",
  spiel_vergangen: "spiel_vergangen",
} as const;

export interface FLSpielbestaetigungGeschlossen {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  am: string;
  grund: FLSpielbestaetigungGeschlossenGrund;
}

/**
 * One seat's link bookkeeping as an administrator reads it -- and NO `token_hashes`.
 *
 * The hashes are raw document keys the token filter alone reads; a model declaring them would serve
 * every live link's hash through the admin read.
 */
export interface FLSpielbestaetigungSitz {
  zustellung?: FLBewerbungZustellung | null;
}

/**
 * The three seats, mirroring `kontakte`'s slots. Null per SEAT: an empty, barred or voided seat holds no link.
 */
export interface FLSpielbestaetigungKontakte {
  ansprechperson: FLSpielbestaetigungSitz | null;
  stellvertretung: FLSpielbestaetigungSitz | null;
  trainer: FLSpielbestaetigungSitz | null;
}

export interface FLSpielbestaetigungParteiTeam {
  art: "team";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLSpielbestaetigungParteiSchiedsrichter {
  art: "schiedsrichter";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * One party's confirmation of one Ansetzung, as stored and as an administrator reads it.
 *
 * The close reaches an answered row too, so an agreement a move overtook records why it stopped
 * applying (`app/api/spielbestaetigungen/services.py :: build_closable_filter`).
 */
export interface FLSpielbestaetigung {
  angefragt_am: string | null;
  ansetzung: FLSpielbestaetigungAnsetzung;
  antwort: FLSpielbestaetigungAntwort | null;
  /** @items.pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  erinnert_am: string[];
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  geschlossen: FLSpielbestaetigungGeschlossen | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  kontakte: FLSpielbestaetigungKontakte | null;
  partei: FLSpielbestaetigungParteiTeam | FLSpielbestaetigungParteiSchiedsrichter;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
}

/**
 * The clubs, the day, the hour and the ground a page or a message states.
 *
 * The fixture as it stands, or on a link whose fixture moved since, the Ansetzung the row asked about.
 */
export interface FLSpielbestaetigungAnsichtAnsetzung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  spielort: FLSpielOrtFieldPublic | null;
  team1_name: string;
  team2_name: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  uhrzeit: string;
}

export type FLSpielbestaetigungAnsichtResponseZustand =
  (typeof FLSpielbestaetigungAnsichtResponseZustand)[keyof typeof FLSpielbestaetigungAnsichtResponseZustand];

export const FLSpielbestaetigungAnsichtResponseZustand = {
  gueltig: "gueltig",
  vorschlag: "vorschlag",
  zugesagt: "zugesagt",
  abgelehnt: "abgelehnt",
  verworfen: "verworfen",
  abgelaufen: "abgelaufen",
  ungueltig: "ungueltig",
  abgesagt: "abgesagt",
  gesperrt: "gesperrt",
} as const;

/**
 * What one link's page renders, filled in every state; the frontend narrows a spent one to its `zustand`.
 */
export interface FLSpielbestaetigungAnsichtResponse {
  ansetzung: FLSpielbestaetigungAnsichtAnsetzung;
  beantwortet_von: FLSpielbestaetigungVonKontakt | FLVonAdmin | FLSpielbestaetigungVonSchiedsrichter | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  seite: FLSpielSeite;
  vorschlag: FLSpielbestaetigungTermin | null;
  zustand: FLSpielbestaetigungAnsichtResponseZustand;
}

export interface FLSpielbestaetigungVorschlagPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  uhrzeit: string;
}

/**
 * One club's answer about one Ansetzung, from whichever of its seats pressed first.
 */
export interface FLSpielbestaetigungAntwortPayload {
  antwort: FLSpielbestaetigungAntwortArt;
  begruendung: string | null;
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
  vorschlag: FLSpielbestaetigungVorschlagPayload | null;
}

/**
 * What the answer recorded: its way, its role, and the answering club's own proposal, which no view of the link serves.
 *
 * So a page shows that proposal from this response, never from a re-read. No receipt is mailed off it.
 */
export interface FLSpielbestaetigungAntwortResponse {
  beantwortet_von: FLSpielbestaetigungVonKontakt | FLVonAdmin | FLSpielbestaetigungVonSchiedsrichter;
  vorschlag: FLSpielbestaetigungTermin | null;
  zustand: FLSpielbestaetigungAntwortArt;
}

/**
 * The administrator's Zusage for a party that answered elsewhere, and how it was given.
 *
 * No way to choose: the one press records a Zusage, and a decline without a proposal would sit in no queue.
 */
export interface FLSpielbestaetigungEintragenPayload {
  /**
   * @minLength 1
   * @maxLength 500
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  begruendung: string;
}

/**
 * A referee's answer about one row naming them: a decline gives a reason, which the administrator reads.
 */
export interface FLSpielbestaetigungSchiedsrichterAntwortPayload {
  antwort: FLSpielbestaetigungAntwortArt;
  begruendung: string | null;
}

export interface FLSpielbestaetigungSchiedsrichterAntwortResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  zustand: FLSpielbestaetigungAntwortArt;
}

export type FLSpielbestaetigungSelbstZustand = (typeof FLSpielbestaetigungSelbstZustand)[keyof typeof FLSpielbestaetigungSelbstZustand];

export const FLSpielbestaetigungSelbstZustand = {
  gueltig: "gueltig",
  zugesagt: "zugesagt",
  abgelehnt: "abgelehnt",
  abgelaufen: "abgelaufen",
  ungueltig: "ungueltig",
  abgesagt: "abgesagt",
} as const;

/**
 * One of the signed-in referee's rows, as their panel lists it.
 */
export interface FLSpielbestaetigungSelbst {
  ansetzung: FLSpielbestaetigungAnsichtAnsetzung;
  begruendung: string | null;
  eingetragen: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  vergangen: boolean;
  zustand: FLSpielbestaetigungSelbstZustand;
}

/**
 * One LINK and its mailbox; the RAW token exists here and in the mail alone.
 *
 * Per link: one person on two seats gets one button naming both roles, two people on one inbox two.
 */
export interface FLSpielbestaetigungSweepLink {
  address: string;
  rollen: FLKontaktRolle[];
  token: string;
}

/**
 * One team row's request or reminder: the fixture, the stored deadline, and every link due a message.
 */
export interface FLSpielbestaetigungSweepAnfrage {
  ansetzung: FLSpielbestaetigungAnsichtAnsetzung;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  links: FLSpielbestaetigungSweepLink[];
  seite: FLSpielSeite;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
}

/**
 * Which rows' first messages went. Stamped whether or not answered or closed since: the stamp records the send.
 */
export interface FLSpielbestaetigungSweepAngefragtPayload {
  /**
   * @maxItems 83
   * @items.pattern ^[0-9a-fA-F]{24}$
   */
  spielbestaetigung_ids: string[];
}

export interface FLSpielbestaetigungSweepAngefragtResponse {
  angefragt: number;
  fehlgeschlagen: number;
  saison_id: string;
}

export type FLSpielbestaetigungSweepAufgegebenPartei =
  (typeof FLSpielbestaetigungSweepAufgegebenPartei)[keyof typeof FLSpielbestaetigungSweepAufgegebenPartei];

export const FLSpielbestaetigungSweepAufgegebenPartei = {
  team: "team",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A notice given up unsent, for the administrator to tell by hand: the fixture and the party's kind, never a person.
 */
export interface FLSpielbestaetigungSweepAufgegeben {
  partei: FLSpielbestaetigungSweepAufgegebenPartei;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
}

/**
 * A referee row just minted, or one no stamp records as told: the referee is told to the panel, with no token.
 */
export interface FLSpielbestaetigungSweepEinteilung {
  address: string;
  ansetzung: FLSpielbestaetigungAnsichtAnsetzung;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
}

/**
 * A mailbox told something without a link.
 */
export interface FLSpielbestaetigungSweepEmpfaenger {
  address: string;
  rollen: FLKontaktRolle[];
}

/**
 * Which rows' notices went, or were given up: each stops being owed, so no later pass answers it again.
 */
export interface FLSpielbestaetigungSweepMitgeteiltPayload {
  /**
   * @maxItems 25
   * @items.pattern ^[0-9a-fA-F]{24}$
   */
  spielbestaetigung_ids: string[];
}

export interface FLSpielbestaetigungSweepMitgeteiltResponse {
  mitgeteilt: number;
  saison_id: string;
}

/**
 * A team row a move closed, so a link in its mailboxes is known void before the fresh request arrives.
 */
export interface FLSpielbestaetigungSweepNeueAnsetzung {
  alt: FLSpielbestaetigungTermin;
  empfaenger: FLSpielbestaetigungSweepEmpfaenger[];
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  team1_name: string;
  team2_name: string;
}

/**
 * A referee row closed because its referee was taken off the fixture after their Einteilung went out: the slot they were told of.
 */
export interface FLSpielbestaetigungSweepSchiedsrichterGewechselt {
  address: string;
  alt: FLSpielbestaetigungTermin;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  team1_name: string;
  team2_name: string;
}

/**
 * The same for a referee row: one address, no seat, the delivery lane recording no seat.
 */
export interface FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung {
  address: string;
  alt: FLSpielbestaetigungTermin;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  team1_name: string;
  team2_name: string;
}

/**
 * The same for a referee row whose Einteilung went out: one address, no seat.
 */
export interface FLSpielbestaetigungSweepSchiedsrichterSpielAbgesagt {
  address: string;
  alt: FLSpielbestaetigungTermin;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  team1_name: string;
  team2_name: string;
}

/**
 * A team row closed because its fixture was called off after its request went out: the slot it was asked about.
 */
export interface FLSpielbestaetigungSweepSpielAbgesagt {
  alt: FLSpielbestaetigungTermin;
  empfaenger: FLSpielbestaetigungSweepEmpfaenger[];
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  team1_name: string;
  team2_name: string;
}

/**
 * A club's decline whose proposed date the administrator discarded: the slot it was asked about, which stands.
 */
export interface FLSpielbestaetigungSweepVorschlagVerworfen {
  alt: FLSpielbestaetigungTermin;
  empfaenger: FLSpielbestaetigungSweepEmpfaenger[];
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  team1_name: string;
  team2_name: string;
}

/**
 * One season's pass: the requests still to stamp, the reminders already stamped, and the notices still to stamp.
 */
export interface FLSpielbestaetigungSweepResponse {
  anfragen: FLSpielbestaetigungSweepAnfrage[];
  einteilungen: FLSpielbestaetigungSweepEinteilung[];
  erinnerungen: FLSpielbestaetigungSweepAnfrage[];
  fehlgeschlagen: number;
  geschlossen: number;
  mitteilungen_aufgegeben: FLSpielbestaetigungSweepAufgegeben[];
  neue_ansetzungen: FLSpielbestaetigungSweepNeueAnsetzung[];
  saison_id: string;
  schiedsrichter_gewechselt: FLSpielbestaetigungSweepSchiedsrichterGewechselt[];
  schiedsrichter_neue_ansetzungen: FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung[];
  schiedsrichter_spiel_abgesagt: FLSpielbestaetigungSweepSchiedsrichterSpielAbgesagt[];
  spiel_abgesagt: FLSpielbestaetigungSweepSpielAbgesagt[];
  vorschlag_verworfen: FLSpielbestaetigungSweepVorschlagVerworfen[];
}

/**
 * The `active` seasons a pass visits, oldest first.
 */
export interface FLSpielbestaetigungSweepSaisonsResponse {
  saison_ids: string[];
}

/**
 * Shared by the administrator's two presses, both answering the row as it now stands.
 */
export interface FLSpielbestaetigungWriteResponse {
  updated_document: FLSpielbestaetigung;
}

/**
 * The rows newest first, closed ones included.
 */
export interface FLSpielbestaetigungenListResponse {
  spielbestaetigungen: FLSpielbestaetigung[];
  vollstaendig: boolean;
}

export interface FLSpielbestaetigungenSelbstResponse {
  spielbestaetigungen: FLSpielbestaetigungSelbst[];
}

/**
 * The matches needing attention, why the bracket ones do, and every report's state.
 *
 * A fault joins its match by `spiel_id`, never `spiel_nr`, unique within one season only; `spiele` carries every
 * match a fault or an open report names.
 */
export interface FLSpieleActionRequiredResponse {
  bracket_faults: (
    | FLBracketFaultGruppe
    | FLBracketFaultQuelle
    | FLBracketFaultSpiel
    | FLBracketFaultSlot
    | FLBracketFaultOccupant
    | FLBracketFaultSpieltag
    | FLBracketFaultBooking
    | FLBracketFaultClash
  )[];
  spielberichte: FLSpielberichtZustandEintrag[];
  spiele: FLSpielJoinedAdmin[];
}

/**
 * The admin surfaces' fixture list.
 *
 * The base tier reduces a referee's surname to an initial (`READ-REFEREE-001`) and the admin
 * fixture search matches on that name, so a surname typed there would find nothing.
 */
export interface FLSpieleAdminListResponse {
  spiele: FLSpielJoinedAdmin[];
}

/**
 * What `GET /spiele/{spiel_id}/admin` answers: the fixture the editor round-trips, money included.
 */
export interface FLSpieleAdminSingleResponse {
  spiel: FLSpielJoinedAdmin;
}

export interface FLSpieleListResponse {
  spiele: FLSpielJoined[];
}

export interface FLSpieleSingleResponse {
  spiel: FLSpielJoined;
}

/**
 * The same player echoed back to the admin who just wrote them, with their whole name.
 *
 * `inactive_since` rides here alone: it IS the answer `DELETE` and `reactivate` give, and no public
 * surface renders a pupil's leaving date.
 */
export interface FLSpielerAdminSingleResponse {
  inactive_since: string | null;
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * One squad row as the BASE TIER serves it -- all an anonymous visitor may read.
 *
 * `build_spieler_pipeline` withholds the rest: the surname is an initial (`READ-PUPIL-001`), the
 * `stufe` is gone (`READ-PUPIL-002`), and the consent record with it.
 */
export interface FLSpielerPublic {
  nachname: string | null;
  nummer?: string | null;
  position?: FLSpielerPosition | null;
  vorname?: string | null;
}

export interface FLSpielerListResponse {
  spieler: FLSpielerPublic[];
}

/**
 * One squad row as seen from its player.
 *
 * Carries `inactive_since`, which the team junction does not: a player leaves a squad mid-season,
 * where a team never leaves a season at all.
 */
export interface FLSpielerMembership {
  inactive_since: string | null;
  ist_nachnominiert: boolean;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  saison_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * The person as stored, plus every squad row they hold.
 *
 * A DIFFERENT question from `FLSpieler`, not a projection: that one is FLATTENED against one
 * season, so a player in two comes back as two indistinguishable rows.
 */
export interface FLSpielerWithMemberships {
  adresswechsel_einsehbar_verwehrt: FLAdresswechselEinsehbarVerwehrt | null;
  adresswechsel_id: string | null;
  einwilligung: FLEinwilligung;
  email: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  memberships: FLSpielerMembership[];
  nachname: string | null;
  /** @minLength 1 */
  vorname: string;
}

/**
 * Every player, retired ones included, each with their squad rows. Sorted by name.
 */
export interface FLSpielerMembershipsResponse {
  spieler: FLSpielerWithMemberships[];
}

/**
 * Whether an entry into this season's squads today would be marked a Nachnominierung.
 */
export interface FLSpielerNachnominierungResponse {
  nachnominierung: boolean;
  saison_id: string;
}

/**
 * One pupil record's stored data as its own person reads it: the whole surname and the birthdate, never masked.
 *
 * Its consent is the account page's, whose entry extends this (`app/api/konto/schemas.py :: FLKontoSpielerEinwilligung`).
 */
export interface FLSpielerSelbst {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  kader: FLSpielerSelbstKaderZeile[];
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * The record as it stands after the write, everything the person did not move unchanged.
 */
export interface FLSpielerSelbstEinwilligungResponse {
  einwilligung: FLEinwilligung;
  nachweis_stand: FLEinwilligungStand;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

/**
 * The signed-in address's own pupil record: one at most, `spieler.email` being unique.
 */
export interface FLSpielerSelbstResponse {
  spieler: FLSpielerSelbst;
}

/**
 * One player as the BASE TIER serves them -- an allow-list of what this surface needs.
 *
 * Squad fields are season-scoped, and inventing a season would make the answer depend on a default
 * nobody stated. `nachname` is an INITIAL here (`READ-PUPIL-001`).
 */
export interface FLSpielerSingleResponse {
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  vorname: string | null;
}

/**
 * Shared by delete and reactivate — both answer with the venue as it now stands.
 */
export interface FLSpielortWriteResponse {
  updated_document: FLSpielort;
}

export interface FLSpielorteListResponse {
  spielorte: FLSpielort[];
}

export interface FLSpielorteSingleResponse {
  spielort: FLSpielort;
}

export interface FLSpieltag {
  /** @minimum 0 */
  anzahl_spiele: number;
  beginn: string | null;
  ende: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minimum 1 */
  position: number;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  saison_phase: FLSaisonPhase;
}

export interface FLSpieltagWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  updated_document: FLSpieltag;
}

export interface FLSpieltageListResponse {
  spieltage: FLSpieltag[];
}

export interface FLSpieltageSingleResponse {
  spieltag: FLSpieltag;
}

/**
 * Which mailbox is asking, folded to the one spelling the join, the header and the log agree on.
 */
export interface FLSubjektPayload {
  /** @maxLength 254 */
  email: string;
}

/**
 * One referee record the mailbox names, carrying the id alone for `FLSubjektSpieler`'s reason.
 */
export interface FLSubjektSchiedsrichter {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * One contact seat the mailbox holds on a season's junction row.
 *
 * Per seat and never per person, as the erasure's `FLSelbstErasureSitz` is: one row seats one
 * person twice where `trainer_ist_zugleich` says so.
 */
export interface FLSubjektSitz {
  rolle: FLKontaktRolle;
  saison_id: string;
  saison_status: FLSaisonStatus;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
}

/**
 * One pupil record the mailbox names.
 *
 * The id alone: the caller composed the address it asked about, and anything else here hands a
 * machine read a fresh copy of somebody's own data for nothing.
 */
export interface FLSubjektSpieler {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

/**
 * Which confirmed, live records one mailbox matches, and whether the address is on the ban list.
 *
 * The ban narrows none of the records: whether a barred person signs in is the sign-in gate's to decide.
 */
export interface FLSubjektResponse {
  berechtigt_seit: string | null;
  gesperrt: boolean;
  inhaber_seit: string | null;
  schiedsrichter: FLSubjektSchiedsrichter[];
  sitze: FLSubjektSitz[];
  spieler: FLSubjektSpieler[];
  unbestaetigt: boolean;
  verwaltung: FLVerwaltung | null;
}

/**
 * The two clubs a group swap exchanges. Symmetric.
 *
 * Neither side carries a `gruppe`: reading one from the payload would let a stale form write a
 * group nobody stands in.
 */
export interface FLSwapGruppenPayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team1_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team2_id: string;
}

/**
 * Both junction rows as the swap left them, plus `rewritten_spiele` -- the second half of the write, reported not assumed.
 */
export interface FLSwapGruppenResponse {
  rewritten_spiele: number;
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  team1_gruppe: FLGruppenNames;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team1_id: string;
  team2_gruppe: FLGruppenNames;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team2_id: string;
}

export interface FLTeam {
  address: FLAddress;
  austritt: FLAustritt | null;
  /** @maxLength 4096 */
  description: string;
  /** @minLength 1 */
  full_name: string;
  gruppe: FLGruppenNames;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  /** @minLength 1 */
  name: string;
  schulform: FLSchulform | null;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  statistik: FLTeamStatistik;
  website_url: string | null;
}

/**
 * One junction row as seen from its club: which season, which group, and the record if any.
 */
export interface FLTeamMembership {
  adresswechsel: FLSaisonTeamAdresswechsel | null;
  austritt: FLAustritt | null;
  bestaetigungen?: FLSaisonTeamBestaetigungenAnsicht | null;
  gruppe: FLGruppenNames;
  kontakte: FLSaisonTeamKontakte | null;
  /** The token a save against this contact block has to echo back. */
  readonly kontakte_stand: string;
  saison_id: string;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * One seat as the people beside it see it: who holds it and whether they answered their link.
 *
 * No address, telephone number or birthdate: the contact page promises that only administrators
 * see those (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`).
 */
export interface FLTeamSitz {
  bestaetigt: boolean;
  name: string | null;
  rolle: FLKontaktRolle;
}

/**
 * A team's three seats in one season, in the order `KONTAKT_ROLLEN` names them.
 */
export interface FLTeamSitzeResponse {
  saison_id: string;
  sitze: FLTeamSitz[];
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * The stored club document plus every season membership it holds.
 *
 * A DIFFERENT question from `FLTeam`, not a projection: that one joins strictly against one season,
 * so a club outside it is absent by design.
 */
export interface FLTeamWithMemberships {
  address: FLAddress;
  /** @maxLength 4096 */
  description: string;
  /** @minLength 1 */
  full_name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  memberships: FLTeamMembership[];
  /** @minLength 1 */
  name: string;
  schulform: FLSchulform | null;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  website_url: string | null;
}

/**
 * What the retire and reactivate endpoints echo. `FLTeamRecord`, for the reason stated on it.
 */
export interface FLTeamWriteResponse {
  updated_document: FLTeamRecord;
}

/**
 * The season's groups in standing order, and how many of each advance.
 *
 * `qualifiers_per_group` rides along rather than being fetched separately, so a page cannot mark a
 * cutoff drawn from a different season than the table it marks.
 */
export interface FLTeamsGroupedResponse {
  format: "grouped";
  gruppen: FLGruppen;
  /** @exclusiveMinimum 0 */
  qualifiers_per_group: number;
}

export interface FLTeamsListResponse {
  format: "list";
  teams: FLTeam[];
}

/**
 * Every club, retired ones included, each with its memberships. Sorted by name.
 */
export interface FLTeamsMembershipsResponse {
  teams: FLTeamWithMemberships[];
}

/**
 * One team, from `GET /teams/{team_id}`.
 *
 * Not part of `FLTeamsResponse`: that union discriminates the shapes ONE endpoint can return.
 */
export interface FLTeamsSingleResponse {
  format: "single";
  team: FLTeam;
}

/**
 * The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.
 */
export interface FLTokenPayload {
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
}

/**
 * What removing the season's Spielplan took away, on the shape the draw reports.
 *
 * Both counts are zero on a season already undrawn, which is why the watermark is reported apart:
 * it is the one thing a season can hold with neither collection behind it.
 */
export interface FLUndrawSpielplanResponse {
  /**
   * @minLength 4
   * @maxLength 4
   */
  saison_id: string;
  /** @minimum 0 */
  spiele: number;
  /** @minimum 0 */
  spieltage: number;
  watermark_cleared: boolean;
}

export type FLZustellungAbgewiesenPayloadZiel = (typeof FLZustellungAbgewiesenPayloadZiel)[keyof typeof FLZustellungAbgewiesenPayloadZiel];

export const FLZustellungAbgewiesenPayloadZiel = {
  schiedsrichter: "schiedsrichter",
  einladung: "einladung",
  registrierung: "registrierung",
  kontakt: "kontakt",
  adresswechsel: "adresswechsel",
  spielbestaetigung: "spielbestaetigung",
} as const;

/**
 * A send the provider refused outright. No `nachricht_id`: nothing was minted, so there is no message for a later event to join.
 */
export interface FLZustellungAbgewiesenPayload {
  /**
   * @minLength 1
   * @maxLength 64
   */
  am: string;
  grund: string | null;
  rollen: FLKontaktRolle[];
  ziel: FLZustellungAbgewiesenPayloadZiel;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  ziel_id: string;
}

export type FLZustellungAngenommenPayloadZiel = (typeof FLZustellungAngenommenPayloadZiel)[keyof typeof FLZustellungAngenommenPayloadZiel];

export const FLZustellungAngenommenPayloadZiel = {
  schiedsrichter: "schiedsrichter",
  einladung: "einladung",
  registrierung: "registrierung",
  kontakt: "kontakt",
  adresswechsel: "adresswechsel",
  spielbestaetigung: "spielbestaetigung",
} as const;

/**
 * One message the provider accepted for this record. `stand` is not a key: this endpoint records `angenommen` and no other state.
 */
export interface FLZustellungAngenommenPayload {
  /**
   * @minLength 1
   * @maxLength 64
   */
  am: string;
  /**
   * @minLength 1
   * @maxLength 128
   */
  nachricht_id: string;
  rollen: FLKontaktRolle[];
  ziel: FLZustellungAngenommenPayloadZiel;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  ziel_id: string;
}

export type FLZustellungEreignisPayloadZiel = (typeof FLZustellungEreignisPayloadZiel)[keyof typeof FLZustellungEreignisPayloadZiel];

export const FLZustellungEreignisPayloadZiel = {
  schiedsrichter: "schiedsrichter",
  einladung: "einladung",
  registrierung: "registrierung",
  kontakt: "kontakt",
  adresswechsel: "adresswechsel",
  spielbestaetigung: "spielbestaetigung",
} as const;

/**
 * One delivery event about a message this record was sent.
 */
export interface FLZustellungEreignisPayload {
  /**
   * @minLength 1
   * @maxLength 64
   */
  am: string;
  grund: string | null;
  /**
   * @minLength 1
   * @maxLength 128
   */
  nachricht_id: string;
  rollen: FLKontaktRolle[];
  stand: FLBewerbungZustellEreignis;
  ziel: FLZustellungEreignisPayloadZiel;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  ziel_id: string;
}

/**
 * Whether the write reached the record; false where the report is about a message the record does not hold.
 *
 * False rather than a refusal: the provider repeats a settled event for hours if anything but a
 * success answers it.
 */
export interface FLZustellungResponse {
  angewendet: boolean;
}

/**
 * Bad Request
 */
export type N400Response = FLFailureBody;

/**
 * Unauthorized
 */
export type N401Response = FLFailureBody;

/**
 * Forbidden
 */
export type N403Response = FLFailureBody;

/**
 * Not Found
 */
export type N404Response = FLFailureBody;

/**
 * Conflict
 */
export type N409Response = FLFailureBody;

/**
 * Gone
 */
export type N410Response = FLFailureBody;

/**
 * Unprocessable Content
 */
export type N422Response = FLRefusedPayloadBody;

/**
 * Too Many Requests
 */
export type N429Response = FLFailureBody;

/**
 * Internal Server Error
 */
export type N500Response = FLFailureBody;

/**
 * Service Unavailable
 */
export type N503Response = FLFailureBody;

export type AdresswechselSweepAdresswechselParams = {
  nach?: string | null;
};

export type AktionenGetAktionenParams = {
  collection?: string;
  operation?: string;
  herkunft?: string;
  trace_id?: string | null;
  document_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  order?: AktionenGetAktionenOrder;
};

export type AktionenGetAktionenOrder = (typeof AktionenGetAktionenOrder)[keyof typeof AktionenGetAktionenOrder];

export const AktionenGetAktionenOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type BewerbungenGetBewerbungenParams = {
  saison_id?: string | null;
  saisonbezug?: string;
  status?: string;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: "eingereicht_am";
  order?: BewerbungenGetBewerbungenOrder;
};

export type BewerbungenGetBewerbungenOrder = (typeof BewerbungenGetBewerbungenOrder)[keyof typeof BewerbungenGetBewerbungenOrder];

export const BewerbungenGetBewerbungenOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type IdentitaetPostLoeschungLaufParams = {
  nach?: string | null;
};

export type RegistrierungenGetRegistrierungenParams = {
  saison_id?: string | null;
  team_id?: string | null;
  status?: FLRegistrierungStatus | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: "eingereicht_am";
  order?: RegistrierungenGetRegistrierungenOrder;
};

export type RegistrierungenGetRegistrierungenOrder =
  (typeof RegistrierungenGetRegistrierungenOrder)[keyof typeof RegistrierungenGetRegistrierungenOrder];

export const RegistrierungenGetRegistrierungenOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type RegistrierungenGetOffeneRegistrierungenParams = {
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  order?: RegistrierungenGetOffeneRegistrierungenOrder;
};

export type RegistrierungenGetOffeneRegistrierungenOrder =
  (typeof RegistrierungenGetOffeneRegistrierungenOrder)[keyof typeof RegistrierungenGetOffeneRegistrierungenOrder];

export const RegistrierungenGetOffeneRegistrierungenOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SaisonsGetSaisonsParams = {
  status?: FLSaisonStatus | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SaisonsGetSaisonsSortBy;
  order?: SaisonsGetSaisonsOrder;
};

export type SaisonsGetSaisonsSortBy = (typeof SaisonsGetSaisonsSortBy)[keyof typeof SaisonsGetSaisonsSortBy];

export const SaisonsGetSaisonsSortBy = {
  _id: "_id",
  start_date: "start_date",
  end_date: "end_date",
} as const;

export type SaisonsGetSaisonsOrder = (typeof SaisonsGetSaisonsOrder)[keyof typeof SaisonsGetSaisonsOrder];

export const SaisonsGetSaisonsOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SaisonsGetSaisonsForAdminParams = {
  status?: FLSaisonStatus | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SaisonsGetSaisonsForAdminSortBy;
  order?: SaisonsGetSaisonsForAdminOrder;
};

export type SaisonsGetSaisonsForAdminSortBy = (typeof SaisonsGetSaisonsForAdminSortBy)[keyof typeof SaisonsGetSaisonsForAdminSortBy];

export const SaisonsGetSaisonsForAdminSortBy = {
  _id: "_id",
  start_date: "start_date",
  end_date: "end_date",
} as const;

export type SaisonsGetSaisonsForAdminOrder = (typeof SaisonsGetSaisonsForAdminOrder)[keyof typeof SaisonsGetSaisonsForAdminOrder];

export const SaisonsGetSaisonsForAdminOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SaisonsPreviewEinladungenVersandParams = {
  erneut?: boolean;
};

export type SchiedsrichterGetSchiedsrichterParams = {
  default_payment?: number | null;
  include_inactive?: boolean;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SchiedsrichterGetSchiedsrichterSortBy;
  order?: SchiedsrichterGetSchiedsrichterOrder;
};

export type SchiedsrichterGetSchiedsrichterSortBy =
  (typeof SchiedsrichterGetSchiedsrichterSortBy)[keyof typeof SchiedsrichterGetSchiedsrichterSortBy];

export const SchiedsrichterGetSchiedsrichterSortBy = {
  name: "name",
  default_payment: "default_payment",
} as const;

export type SchiedsrichterGetSchiedsrichterOrder =
  (typeof SchiedsrichterGetSchiedsrichterOrder)[keyof typeof SchiedsrichterGetSchiedsrichterOrder];

export const SchiedsrichterGetSchiedsrichterOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SpielberichteGetSpielberichteParams = {
  saison_id?: string | null;
};

export type SpielberichteGetSpielberichtAdminParams = {
  /**
   * Serve both clubs' live squads of the season, for a form picking from them
   */
  kader?: boolean;
};

export type SpielbestaetigungenGetSpielbestaetigungenParams = {
  saison_id: string;
  spiel_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
};

export type SpieleGetSpieleParams = {
  saison_id?: string | null;
  saison_phase?: "playoffs" | FLSaisonPhase | null;
  spiel_status?: SpieleGetSpieleSpielStatus;
  team_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieleGetSpieleSortBy;
  order?: SpieleGetSpieleOrder;
};

export type SpieleGetSpieleSpielStatus = (typeof SpieleGetSpieleSpielStatus)[keyof typeof SpieleGetSpieleSpielStatus] | null;

export const SpieleGetSpieleSpielStatus = {
  ausstehend: "ausstehend",
  vergangen: "vergangen",
  heute: "heute",
  abgesagt: "abgesagt",
  unbekannt: "unbekannt",
} as const;

export type SpieleGetSpieleSortBy = (typeof SpieleGetSpieleSortBy)[keyof typeof SpieleGetSpieleSortBy];

export const SpieleGetSpieleSortBy = {
  datum: "datum",
  uhrzeit: "uhrzeit",
  spiel_nr: "spiel_nr",
  saison_phase: "saison_phase",
} as const;

export type SpieleGetSpieleOrder = (typeof SpieleGetSpieleOrder)[keyof typeof SpieleGetSpieleOrder];

export const SpieleGetSpieleOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SpieleGetSpieleActionRequiredParams = {
  saison_id?: string | null;
};

export type SpieleGetSpieleForAdminParams = {
  saison_id?: string | null;
  saison_phase?: "playoffs" | FLSaisonPhase | null;
  spiel_status?: SpieleGetSpieleForAdminSpielStatus;
  team_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieleGetSpieleForAdminSortBy;
  order?: SpieleGetSpieleForAdminOrder;
};

export type SpieleGetSpieleForAdminSpielStatus =
  (typeof SpieleGetSpieleForAdminSpielStatus)[keyof typeof SpieleGetSpieleForAdminSpielStatus] | null;

export const SpieleGetSpieleForAdminSpielStatus = {
  ausstehend: "ausstehend",
  vergangen: "vergangen",
  heute: "heute",
  abgesagt: "abgesagt",
  unbekannt: "unbekannt",
} as const;

export type SpieleGetSpieleForAdminSortBy = (typeof SpieleGetSpieleForAdminSortBy)[keyof typeof SpieleGetSpieleForAdminSortBy];

export const SpieleGetSpieleForAdminSortBy = {
  datum: "datum",
  uhrzeit: "uhrzeit",
  spiel_nr: "spiel_nr",
  saison_phase: "saison_phase",
} as const;

export type SpieleGetSpieleForAdminOrder = (typeof SpieleGetSpieleForAdminOrder)[keyof typeof SpieleGetSpieleForAdminOrder];

export const SpieleGetSpieleForAdminOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SpielePatchSpielDataParams = {
  /**
   * The `version` of the fixture's Spielbericht the editor was seeded from, to stamp it adopted
   */
  uebernimmt_bericht?: number | null;
  /**
   * Report what this payload would move and destroy, and write nothing
   */
  dry_run?: boolean;
};

export type SpielerGetSpielerParams = {
  team_id?: string | null;
  saison_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpielerGetSpielerSortBy;
  order?: SpielerGetSpielerOrder;
};

export type SpielerGetSpielerSortBy = (typeof SpielerGetSpielerSortBy)[keyof typeof SpielerGetSpielerSortBy];

export const SpielerGetSpielerSortBy = {
  vorname: "vorname",
  nummer: "nummer",
  position: "position",
} as const;

export type SpielerGetSpielerOrder = (typeof SpielerGetSpielerOrder)[keyof typeof SpielerGetSpielerOrder];

export const SpielerGetSpielerOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SpielorteGetSpielorteParams = {
  include_inactive?: boolean;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: "name";
  order?: SpielorteGetSpielorteOrder;
};

export type SpielorteGetSpielorteOrder = (typeof SpielorteGetSpielorteOrder)[keyof typeof SpielorteGetSpielorteOrder];

export const SpielorteGetSpielorteOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SpieltageGetSpieltageParams = {
  saison_id?: string | null;
  saison_phase?: "playoffs" | FLSaisonPhase | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieltageGetSpieltageSortBy;
  order?: SpieltageGetSpieltageOrder;
};

export type SpieltageGetSpieltageSortBy = (typeof SpieltageGetSpieltageSortBy)[keyof typeof SpieltageGetSpieltageSortBy];

export const SpieltageGetSpieltageSortBy = {
  natural: "natural",
  beginn: "beginn",
  ende: "ende",
} as const;

export type SpieltageGetSpieltageOrder = (typeof SpieltageGetSpieltageOrder)[keyof typeof SpieltageGetSpieltageOrder];

export const SpieltageGetSpieltageOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SpieltageGetSpieltageForAdminParams = {
  saison_id?: string | null;
  saison_phase?: "playoffs" | FLSaisonPhase | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieltageGetSpieltageForAdminSortBy;
  order?: SpieltageGetSpieltageForAdminOrder;
};

export type SpieltageGetSpieltageForAdminSortBy =
  (typeof SpieltageGetSpieltageForAdminSortBy)[keyof typeof SpieltageGetSpieltageForAdminSortBy];

export const SpieltageGetSpieltageForAdminSortBy = {
  natural: "natural",
  beginn: "beginn",
  ende: "ende",
} as const;

export type SpieltageGetSpieltageForAdminOrder = (typeof SpieltageGetSpieltageForAdminOrder)[keyof typeof SpieltageGetSpieltageForAdminOrder];

export const SpieltageGetSpieltageForAdminOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type TeamsGetTeamsParams = {
  saison_id?: string | null;
  gruppe?: FLGruppenNames | null;
  has_austritt?: boolean | null;
  austritt_type?: FLAustrittType | null;
  in_gruppen?: boolean | null;
  statistik_scope?: TeamsGetTeamsStatistikScope;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: "name";
  order?: TeamsGetTeamsOrder;
};

export type TeamsGetTeamsStatistikScope = (typeof TeamsGetTeamsStatistikScope)[keyof typeof TeamsGetTeamsStatistikScope];

export const TeamsGetTeamsStatistikScope = {
  gruppenphase: "gruppenphase",
  gesamt: "gesamt",
} as const;

export type TeamsGetTeamsOrder = (typeof TeamsGetTeamsOrder)[keyof typeof TeamsGetTeamsOrder];

export const TeamsGetTeamsOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type TeamsGetTeamsForAdminParams = {
  saison_id?: string | null;
  gruppe?: FLGruppenNames | null;
  has_austritt?: boolean | null;
  austritt_type?: FLAustrittType | null;
  in_gruppen?: boolean | null;
  statistik_scope?: TeamsGetTeamsForAdminStatistikScope;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: "name";
  order?: TeamsGetTeamsForAdminOrder;
  include_inactive?: boolean;
};

export type TeamsGetTeamsForAdminStatistikScope =
  (typeof TeamsGetTeamsForAdminStatistikScope)[keyof typeof TeamsGetTeamsForAdminStatistikScope];

export const TeamsGetTeamsForAdminStatistikScope = {
  gruppenphase: "gruppenphase",
  gesamt: "gesamt",
} as const;

export type TeamsGetTeamsForAdminOrder = (typeof TeamsGetTeamsForAdminOrder)[keyof typeof TeamsGetTeamsForAdminOrder];

export const TeamsGetTeamsForAdminOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type TeamsGetTeamParams = {
  saison_id?: string | null;
  statistik_scope?: TeamsGetTeamStatistikScope;
};

export type TeamsGetTeamStatistikScope = (typeof TeamsGetTeamStatistikScope)[keyof typeof TeamsGetTeamStatistikScope];

export const TeamsGetTeamStatistikScope = {
  gruppenphase: "gruppenphase",
  gesamt: "gesamt",
} as const;
