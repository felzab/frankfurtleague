export const CheckIsLiveResponseValue = {
  status: "ok",
} as const;
export type CheckIsLiveResponse = typeof CheckIsLiveResponseValue;

export type Code = (typeof Code)[keyof typeof Code];

export const Code = {
  document_not_found: "document_not_found",
  duplicate_key: "duplicate_key",
  version_stale: "version_stale",
  no_database_client: "no_database_client",
  database_failed: "database_failed",
  unknown_outcome: "unknown_outcome",
  activate_saison_unfinished: "activate_saison_unfinished",
  saison_past: "saison_past",
  activate_target_undrawn: "activate_target_undrawn",
  activate_spieltage_undated: "activate_spieltage_undated",
  link_invalid: "link_invalid",
  address_change_ended: "address_change_ended",
  link_expired: "link_expired",
  link_barred: "link_barred",
  address_change_replaced_barred: "address_change_replaced_barred",
  address_change_taken: "address_change_taken",
  address_change_unchanged: "address_change_unchanged",
  address_change_barred: "address_change_barred",
  address_change_nothing: "address_change_nothing",
  address_change_no_approver: "address_change_no_approver",
  address_change_no_approval_open: "address_change_no_approval_open",
  address_change_approval_denied: "address_change_approval_denied",
  address_change_approval_owner: "address_change_approval_owner",
  address_change_not_covered: "address_change_not_covered",
  address_change_new_granted: "address_change_new_granted",
  address_change_approval_younger: "address_change_approval_younger",
  address_change_occupied: "address_change_occupied",
  ansetzung_answered: "ansetzung_answered",
  ansetzung_frist_past: "ansetzung_frist_past",
  ansetzung_changed: "ansetzung_changed",
  ansetzung_decided: "ansetzung_decided",
  ansetzung_vorschlag_past: "ansetzung_vorschlag_past",
  ansetzung_closed: "ansetzung_closed",
  ansetzung_not_enterable: "ansetzung_not_enterable",
  ansetzung_not_discardable: "ansetzung_not_discardable",
  ansetzung_foreign_row: "ansetzung_foreign_row",
  access_key_refused: "access_key_refused",
  missing_actor: "missing_actor",
  actor_not_admin: "actor_not_admin",
  session_refused: "session_refused",
  person_barred: "person_barred",
  confirmation_required: "confirmation_required",
  grant_exists: "grant_exists",
  grant_owner: "grant_owner",
  grant_barred: "grant_barred",
  grant_minimum_count: "grant_minimum_count",
  grant_only_owner: "grant_only_owner",
  grant_last_owner: "grant_last_owner",
  grant_approval_request_open: "grant_approval_request_open",
  grant_approval_denied: "grant_approval_denied",
  grant_approval_owner: "grant_approval_owner",
  grant_approval_younger: "grant_approval_younger",
  grant_approval_request_lapsed: "grant_approval_request_lapsed",
  bericht_not_played: "bericht_not_played",
  bericht_not_officiated: "bericht_not_officiated",
  bericht_not_in_kader: "bericht_not_in_kader",
  bericht_abgesagt: "bericht_abgesagt",
  bericht_meanwhile_changed: "bericht_meanwhile_changed",
  bericht_grund_missing: "bericht_grund_missing",
  bericht_elfmeter_in_the_gruppe: "bericht_elfmeter_in_the_gruppe",
  bewerbung_already_decided: "bewerbung_already_decided",
  bewerbung_subject_unresolved: "bewerbung_subject_unresolved",
  bewerbung_schule_unusable: "bewerbung_schule_unusable",
  bewerbung_window_closed: "bewerbung_window_closed",
  bewerbung_submission_subject_unresolved: "bewerbung_submission_subject_unresolved",
  bewerbung_picked_team_unusable: "bewerbung_picked_team_unusable",
  bewerbung_picked_team_already_entered: "bewerbung_picked_team_already_entered",
  bewerbung_shorthand_taken: "bewerbung_shorthand_taken",
  bewerbung_seat_already_answered: "bewerbung_seat_already_answered",
  confirmation_age: "confirmation_age",
  bewerbung_kontakte_unconfirmed: "bewerbung_kontakte_unconfirmed",
  bewerbung_kontakt_email_taken: "bewerbung_kontakt_email_taken",
  bewerbung_key_differing: "bewerbung_key_differing",
  bewerbung_token_past_deadline: "bewerbung_token_past_deadline",
  bewerbung_adresse_barred: "bewerbung_adresse_barred",
  bewerbung_kontakt_barred: "bewerbung_kontakt_barred",
  bewerbung_seat_differently_seated: "bewerbung_seat_differently_seated",
  booking_unknown_resource: "booking_unknown_resource",
  booking_unconfirmed_schiedsrichter: "booking_unconfirmed_schiedsrichter",
  booking_schiedsrichter_moved: "booking_schiedsrichter_moved",
  spiel_double_booked: "spiel_double_booked",
  spiel_outside_spieltag: "spiel_outside_spieltag",
  spieltag_outside_saison: "spieltag_outside_saison",
  spieltag_span_below_spiele: "spieltag_span_below_spiele",
  saison_span_below_spieltage: "saison_span_below_spieltage",
  saison_span_below_spielplan: "saison_span_below_spielplan",
  spieltag_beginn_out_of_order: "spieltag_beginn_out_of_order",
  saison_span_below_spielplan_as_stored: "saison_span_below_spielplan_as_stored",
  invitation_team_not_entered: "invitation_team_not_entered",
  wording_not_allowed: "wording_not_allowed",
  medien_age: "medien_age",
  giving_not_allowed: "giving_not_allowed",
  eligibility_disqualified: "eligibility_disqualified",
  eligibility_team_not_in_saison: "eligibility_team_not_in_saison",
  entry_saison_not_future: "entry_saison_not_future",
  entry_gruppe_not_offered: "entry_gruppe_not_offered",
  entry_gruppe_full: "entry_gruppe_full",
  entry_gruppe_locked: "entry_gruppe_locked",
  team_retired: "team_retired",
  role_not_held: "role_not_held",
  kontakte_moved_under_the_save: "kontakte_moved_under_the_save",
  kontakt_seat_without_confirmation: "kontakt_seat_without_confirmation",
  kontakt_seat_barred: "kontakt_seat_barred",
  kontakt_row_without_saison: "kontakt_row_without_saison",
  kontakt_saison_past: "kontakt_saison_past",
  own_adresse: "own_adresse",
  last_owner_erasure: "last_owner_erasure",
  verwaltung_adresse: "verwaltung_adresse",
  foreign_address_change: "foreign_address_change",
  no_owner: "no_owner",
  registrierung_closed: "registrierung_closed",
  registrierung_stufe_not_allowed: "registrierung_stufe_not_allowed",
  confirmation_exists: "confirmation_exists",
  registrierung_kader_full: "registrierung_kader_full",
  registrierung_adresse_barred: "registrierung_adresse_barred",
  registrierung_key_differing: "registrierung_key_differing",
  registrierung_unconfirmed: "registrierung_unconfirmed",
  registrierung_person_not_named: "registrierung_person_not_named",
  registrierung_already_in_kader: "registrierung_already_in_kader",
  registrierung_already_admitted: "registrierung_already_admitted",
  registrierung_choices_unsuitable: "registrierung_choices_unsuitable",
  registrierung_person_missing: "registrierung_person_missing",
  replace_saison_started: "replace_saison_started",
  replace_incoming_already_entered: "replace_incoming_already_entered",
  replace_one_team_on_both_ends: "replace_one_team_on_both_ends",
  ergebnis_side_emptied: "ergebnis_side_emptied",
  retire_blocked: "retire_blocked",
  spielort_still_booked: "spielort_still_booked",
  schiedsrichter_still_assigned: "schiedsrichter_still_assigned",
  no_route: "no_route",
  method_not_served: "method_not_served",
  rules_bracket_impossible: "rules_bracket_impossible",
  rules_gruppen_in_use: "rules_gruppen_in_use",
  rules_capacity_below_use: "rules_capacity_below_use",
  rules_qualifiers_below_wiring: "rules_qualifiers_below_wiring",
  rules_saison_started: "rules_saison_started",
  rules_spieltag_over_its_phase: "rules_spieltag_over_its_phase",
  rules_qualifiers_above_gruppe: "rules_qualifiers_above_gruppe",
  rules_unentschieden_outvalues_win: "rules_unentschieden_outvalues_win",
  rules_kader_below_use: "rules_kader_below_use",
  rules_forfeit_unentschieden_in_a_knockout: "rules_forfeit_unentschieden_in_a_knockout",
  rules_shape_after_spielplan: "rules_shape_after_spielplan",
  rules_spiele_over_one_read: "rules_spiele_over_one_read",
  rules_forfeit_unentschieden_in_a_knockout_as_stored: "rules_forfeit_unentschieden_in_a_knockout_as_stored",
  schiedsrichter_retired: "schiedsrichter_retired",
  schiedsrichter_no_adresse: "schiedsrichter_no_adresse",
  schiedsrichter_adresse_barred: "schiedsrichter_adresse_barred",
  schiedsrichter_adresse_only_per_change: "schiedsrichter_adresse_only_per_change",
  sperrliste_no_saison: "sperrliste_no_saison",
  sperrliste_verwaltung: "sperrliste_verwaltung",
  spielplan_already_drawn: "spielplan_already_drawn",
  spielplan_spieltage_held: "spielplan_spieltage_held",
  spielplan_gruppen_off_rules: "spielplan_gruppen_off_rules",
  spielplan_replace_outside_its_window: "spielplan_replace_outside_its_window",
  spielplan_undraw_outside_its_window: "spielplan_undraw_outside_its_window",
  spielplan_berichte_submitted: "spielplan_berichte_submitted",
  spieltag_occupied: "spieltag_occupied",
  spieltag_occupied_by_the_resolution: "spieltag_occupied_by_the_resolution",
  kader_team_not_in_saison: "kader_team_not_in_saison",
  kader_full: "kader_full",
  kader_rolle_taken: "kader_rolle_taken",
  kader_stufe_not_allowed: "kader_stufe_not_allowed",
  state_ergebnis_on_a_non_event: "state_ergebnis_on_a_non_event",
  state_nichtantreten_without_two_sides: "state_nichtantreten_without_two_sides",
  swap_not_a_swap: "swap_not_a_swap",
  swap_saison_started: "swap_saison_started",
  swap_spieltag_clash: "swap_spieltag_clash",
  swap_fields_disqualified: "swap_fields_disqualified",
  payload_refused: "payload_refused",
  body_unreadable: "body_unreadable",
  wiring_unsupported: "wiring_unsupported",
  wiring_seed_past_the_opening_round: "wiring_seed_past_the_opening_round",
  wiring_gruppe_not_run: "wiring_gruppe_not_run",
  unhandled_crash: "unhandled_crash",
  stored_data_invalid: "stored_data_invalid",
} as const;

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
 * Which group the school enters, and the kit colour the league assigns it; the season is the application's own.
 */
export interface FLAcceptBewerbungPayload {
  gruppe: FLGruppenNames;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * What the acceptance wrote beyond the application: the club in the season, and where; its mails are owed in the same write.
 */
export interface FLAcceptBewerbungResponse {
  created_team: boolean;
  gruppe: FLGruppenNames;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * The change a start or an approval wrote, and the mailbox its link is owed in the Postausgang: no link is answered.
 */
export interface FLAccountAddressChangeMintResponse {
  email: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  valid_until: string;
}

export type FLVerwaltung = (typeof FLVerwaltung)[keyof typeof FLVerwaltung];

export const FLVerwaltung = {
  owner: "owner",
  administration: "administration",
} as const;

/**
 * The approval a change of the person's own grant waits on, as their account page reads it: never who gave it.
 */
export interface FLAddressChangeApprovalStand {
  approved: boolean;
  bis: string;
  verwaltung: FLVerwaltung;
}

export type FLAddressChangeWaitsOn = (typeof FLAddressChangeWaitsOn)[keyof typeof FLAddressChangeWaitsOn];

export const FLAddressChangeWaitsOn = {
  release: "release",
  new_adresse: "new_adresse",
  approval: "approval",
  waiting_period: "waiting_period",
} as const;

export type FLAddressChangeWay = (typeof FLAddressChangeWay)[keyof typeof FLAddressChangeWay];

export const FLAddressChangeWay = {
  account: "account",
  release: "release",
  waiting_period: "waiting_period",
} as const;

/**
 * The address's live change as its own account page reads it.
 */
export interface FLAccountAddressChangeOpen {
  approval: FLAddressChangeApprovalStand | null;
  effective_from: string | null;
  email: string;
  expired: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  valid_until: string | null;
  waits_on: FLAddressChangeWaitsOn;
  way: FLAddressChangeWay;
}

export interface FLAccountAddressChangePayload {
  /** @maxLength 254 */
  email: string;
}

/**
 * The change the page showed: an administrator's later start replaces it, and the approval then reaches nothing.
 */
export interface FLAccountAddressChangeReleasePayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * Whether the signed-in address may change, and the change pending on it.
 */
export interface FLAccountAddressChangeResponse {
  open: FLAccountAddressChangeOpen | null;
  possible: boolean;
}

/**
 * What the contact confirmation page's slots name for this seat today.
 */
export interface FLSeatContext {
  saison: string;
  schule: string | null;
  team: string;
  vorname: string | null;
}

export type FLKontaktRolle = (typeof FLKontaktRolle)[keyof typeof FLKontaktRolle];

export const FLKontaktRolle = {
  trainer: "trainer",
  ansprechperson: "ansprechperson",
  stellvertretung: "stellvertretung",
} as const;

/**
 * One confirmation a person gave on a row: the seats it answered, its words and the floor its page named.
 */
export interface FLSeatConfirmed {
  confirmed_at: string | null;
  context: FLSeatContext;
  minimum_age: number;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  text_version: string;
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

export type FLKontaktKenntnisnahmeUmfang = (typeof FLKontaktKenntnisnahmeUmfang)[keyof typeof FLKontaktKenntnisnahmeUmfang];

export const FLKontaktKenntnisnahmeUmfang = {
  kontaktdaten: "kontaktdaten",
  kontaktdaten_whatsapp: "kontaktdaten_whatsapp",
} as const;

/**
 * One pending application on which the address holds a confirmed contact seat, with its two choices to withdraw.
 *
 * Pending alone: an accepted application's seats are its season row's, listed under `seats`.
 */
export interface FLAccountBewerbungSeatEinwilligung {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  /** @minItems 1 */
  confirmed: FLSeatConfirmed[];
  medien: boolean;
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  nachweis_stand: FLEinwilligungStand;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  schule: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

export interface FLEinwilligungStandPayload {
  medien: string | null;
  umfang: string | null;
}

export type FLEinwilligungUmfang = (typeof FLEinwilligungUmfang)[keyof typeof FLEinwilligungUmfang];

export const FLEinwilligungUmfang = {
  kader_oeffentlich: "kader_oeffentlich",
  intern: "intern",
} as const;

/**
 * A pupil's, a referee's or a registration's own two choices on their record.
 *
 * Both choices on every press, and no member defaulted: a default would let a page that forgot one
 * reset the person's other choice.
 */
export interface FLAccountEinwilligungPayload {
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
 * What the pupil confirmation page's slots name for this record today, so its agreed words render whole.
 *
 * Null where no squad row names a team and season; the words then render without them.
 */
export interface FLSpielerContext {
  saison: string | null;
  schule: string | null;
  team: string | null;
}

export type FLSpielerPosition = (typeof FLSpielerPosition)[keyof typeof FLSpielerPosition];

export const FLSpielerPosition = {
  Tor: "Tor",
  Abwehr: "Abwehr",
  Mittelfeld: "Mittelfeld",
  Angriff: "Angriff",
} as const;

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
 * One pending registration its pupil confirmed: its choices to withdraw, and what it stores.
 */
export interface FLAccountRegistrierungEinwilligung {
  confirmed_text_version: string;
  context: FLSpielerContext;
  geburtsdatum: string | null;
  medien: boolean | null;
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  minimum_age: number;
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
  given_before: FLEinwilligungBeleg | null;
  text_version: string;
}

/**
 * Each choice's evidence, null until its person sets it: a record no person has answered carries none.
 */
export interface FLEinwilligungNachweise {
  medien: FLEinwilligungNachweis | null;
  umfang: FLEinwilligungNachweis | null;
}

/**
 * What this person agreed may be published about them.
 *
 * Its keys stand TOGETHER, as `FLAustritt`'s do: a scope with no confirmation date claims somebody
 * consented, and no surface can tell that from one somebody gave.
 */
export interface FLEinwilligung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  confirmed_at: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  medien: boolean;
  nachweis: FLEinwilligungNachweise;
  text_version: string;
  umfang: FLEinwilligungUmfang;
}

export interface FLKontakt {
  email: string | null;
  telefon: string | null;
}

/**
 * One referee record on the account page: its stored data and the consent the page moves.
 */
export interface FLAccountSchiedsrichterEinwilligung {
  confirmed_text_version: string;
  einwilligung: FLEinwilligung;
  geburtsdatum: string | null;
  givable: boolean;
  honorar: number;
  inactive_since: string | null;
  kontakt: FLKontakt;
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  medien_offered: boolean;
  minimum_age: number;
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
export interface FLAccountSeatEinwilligung {
  /** @minItems 1 */
  confirmed: FLSeatConfirmed[];
  givable: boolean;
  medien: boolean;
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  medien_offered: boolean;
  nachweis_stand: FLEinwilligungStand;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

export type FLSpielerRolle = (typeof FLSpielerRolle)[keyof typeof FLSpielerRolle];

export const FLSpielerRolle = {
  kapitaen: "kapitaen",
  co_kapitaen: "co_kapitaen",
} as const;

/**
 * One squad row as its own pupil reads it, with the name the club played that season under.
 */
export interface FLSpielerSelfKaderRow {
  inactive_since: string | null;
  is_nachnominiert: boolean;
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
export interface FLAccountSpielerEinwilligung {
  confirmed_text_version: string;
  context: FLSpielerContext;
  einwilligung: FLEinwilligung;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  givable: boolean;
  inactive_since: string | null;
  kader: FLSpielerSelfKaderRow[];
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  medien_offered: boolean;
  minimum_age: number;
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
export interface FLAccountEinwilligungenResponse {
  bewerbungen: FLAccountBewerbungSeatEinwilligung[];
  registrierungen: FLAccountRegistrierungEinwilligung[];
  schiedsrichter: FLAccountSchiedsrichterEinwilligung[];
  seats: FLAccountSeatEinwilligung[];
  spieler: FLAccountSpielerEinwilligung | null;
}

/**
 * One seat on an application, of any status.
 */
export interface FLAccountErasureBewerbung {
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  vorname: string;
}

export const FLAccountErasureDataValue = {
  art: "account_erasure",
} as const;
export type FLAccountErasureData = typeof FLAccountErasureDataValue;

/**
 * One registration, pending or declined.
 */
export interface FLAccountErasureRegistrierung {
  nachname: string;
  saison_id: string;
  team_name: string | null;
  vorname: string;
}

export interface FLAccountErasureSchiedsrichter {
  name: string | null;
}

/**
 * One seat on a team's season row, named as the row names it.
 */
export interface FLAccountErasureSeat {
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  team_name: string;
  vorname: string;
}

export interface FLAccountErasureSpieler {
  nachname: string | null;
  vorname: string;
}

export interface FLAccountErasureViewResponse {
  /** @minimum 0 */
  address_change: number;
  bewerbungen: FLAccountErasureBewerbung[];
  last_owner: boolean;
  registrierungen: FLAccountErasureRegistrierung[];
  schiedsrichter: FLAccountErasureSchiedsrichter[];
  seats: FLAccountErasureSeat[];
  spieler: FLAccountErasureSpieler[];
  verwaltung: FLVerwaltung | null;
}

export type FLActionLogEntryDbFilter = { [key: string]: string } | null;

export type FLActorWithAdresseRowKind = (typeof FLActorWithAdresseRowKind)[keyof typeof FLActorWithAdresseRowKind];

export const FLActorWithAdresseRowKind = {
  admin_session: "admin_session",
  system: "system",
  public: "public",
} as const;

/**
 * An actor named by `email` as both reads serve one: the stored actor, its address withheld where the ban list holds it.
 */
export interface FLActorWithAdresseRow {
  email: string | null;
  email_barred: boolean;
  kind: FLActorWithAdresseRowKind;
}

export type FLActorPersonFunktion = (typeof FLActorPersonFunktion)[keyof typeof FLActorPersonFunktion];

export const FLActorPersonFunktion = {
  kontakt: "kontakt",
  spieler: "spieler",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A signed-in person, named by a pseudonym prefix and the kind of person the write was made as, and never by an address.
 */
export interface FLActorPerson {
  funktion: FLActorPersonFunktion;
  kind: "person_session";
  pseudonym: string;
}

export type FLActionLogEntryOperation = (typeof FLActionLogEntryOperation)[keyof typeof FLActionLogEntryOperation];

export const FLActionLogEntryOperation = {
  insert: "insert",
  insert_many: "insert_many",
  patch_one: "patch_one",
  patch_many: "patch_many",
  delete_many: "delete_many",
  erase_many: "erase_many",
} as const;

export interface FLActionLogEntryRequest {
  method: string;
  path: string;
}

/**
 * One recorded write.
 */
export interface FLActionLogEntry {
  actor: FLActorWithAdresseRow | FLActorPerson;
  anlass: string | null;
  at: string;
  collection: string;
  db_filter: FLActionLogEntryDbFilter;
  document_id: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  modified_count: number | null;
  operation: FLActionLogEntryOperation;
  redacted_at: string | null;
  request: FLActionLogEntryRequest | null;
  stand_secured: boolean;
  trace_id: string;
}

export type FLActionLogEntryHerkunft = (typeof FLActionLogEntryHerkunft)[keyof typeof FLActionLogEntryHerkunft];

export const FLActionLogEntryHerkunft = {
  person: "person",
  system: "system",
  public: "public",
} as const;

export type FLActionLogEntryWithStandBefore = { [key: string]: unknown } | { [key: string]: unknown }[] | null;

export type FLActionLogEntryWithStandDbFilter = { [key: string]: string } | null;

/**
 * One recorded write with the document it replaced, which only the single-row read serves.
 */
export interface FLActionLogEntryWithStand {
  actor: FLActorWithAdresseRow | FLActorPerson;
  anlass: string | null;
  at: string;
  before: FLActionLogEntryWithStandBefore;
  collection: string;
  db_filter: FLActionLogEntryWithStandDbFilter;
  document_id: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  modified_count: number | null;
  operation: FLActionLogEntryOperation;
  redacted_at: string | null;
  request: FLActionLogEntryRequest | null;
  stand_secured: boolean;
  trace_id: string;
}

export interface FLActionLogEntrySingleResponse {
  action_log_entry: FLActionLogEntryWithStand;
}

export type FLActionLogListResponseCountPerCollection = { [key: string]: number };

export type FLActionLogListResponseCountPerHerkunft = { [key: string]: number };

export type FLActionLogListResponseCountPerOperation = { [key: string]: number };

export interface FLActionLogListResponse {
  action_log: FLActionLogEntry[];
  complete: boolean;
  count_per_collection: FLActionLogListResponseCountPerCollection;
  count_per_herkunft: FLActionLogListResponseCountPerHerkunft;
  count_per_operation: FLActionLogListResponseCountPerOperation;
}

/**
 * How many seasons the activation moved off `active` -- normally exactly one.
 */
export interface FLActivateSaisonResponse {
  deactivated: number;
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

/**
 * Exactly one key: the new mailbox's link token, or the change an approval names.
 */
export interface FLAddressChangeAdressePayload {
  address_change_id?: string | null;
  token?: string | null;
}

/**
 * A live change's new address and nothing else, server to server alone.
 */
export interface FLAddressChangeAdresseResponse {
  email: string | null;
}

export type FLAddressChangeAntwort = (typeof FLAddressChangeAntwort)[keyof typeof FLAddressChangeAntwort];

export const FLAddressChangeAntwort = {
  confirmed: "confirmed",
  declined: "declined",
} as const;

export interface FLAddressChangeAntwortPayload {
  antwort: FLAddressChangeAntwort;
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
}

/**
 * The answer recorded, and no address of the change: the notices an effect owes are queued, never answered.
 */
export interface FLAddressChangeAntwortResponse {
  antwort: FLAddressChangeAntwort;
  approval_open: boolean;
  effective: boolean;
  effective_from: string | null;
}

export interface FLAddressChangeApprovalResponse {
  effective: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * The new mailbox's notice that a confirmed change did not take effect: never why, nor the address on file.
 */
export const FLAddressChangeDiscardedDataValue = {
  art: "address_change_discarded",
} as const;
export type FLAddressChangeDiscardedData = typeof FLAddressChangeDiscardedDataValue;

/**
 * The replaced address's notice that the change took effect.
 */
export interface FLAddressChangeEffectiveData {
  art: "address_change_effective";
  instant: string;
  vorname: string | null;
}

export type FLAddressChangeEndArt = (typeof FLAddressChangeEndArt)[keyof typeof FLAddressChangeEndArt];

export const FLAddressChangeEndArt = {
  effective: "effective",
  declined: "declined",
  stopped: "stopped",
  expired: "expired",
  replaced: "replaced",
  discarded: "discarded",
} as const;

/**
 * The address on file's notice of an address change, its stop link minted at the hand-out into `stop.token_hashes`.
 */
export interface FLAddressChangeHinweisData {
  art: "address_change_hinweis";
  valid_until: string;
  vorname: string | null;
  way: FLAddressChangeWay;
}

export interface FLAddressChangeIdResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * The new mailbox's link to confirm an address change, minted at the hand-out into the change's `token_hashes`.
 */
export interface FLAddressChangeLinkData {
  art: "address_change_link";
  valid_until: string;
  way: FLAddressChangeWay;
}

export interface FLAddressChangeMovesDonePayload {
  /**
   * @minItems 1
   * @maxItems 1024
   * @items.pattern ^[0-9a-fA-F]{24}$
   */
  ids: string[];
}

export interface FLAddressChangeMovesDoneResponse {
  /** @minimum 0 */
  done: number;
}

export interface FLAddressChangeOpenMove {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  nach: string;
  von: string;
}

/**
 * The sign-in accounts the effects still owe to carry, server to server alone: each names two addresses.
 *
 * A page at a time; a full page means more wait.
 */
export interface FLAddressChangeMovesResponse {
  moves: FLAddressChangeOpenMove[];
}

export const FLAddressChangeStopResponseValue = {
  stopped: true,
} as const;
export type FLAddressChangeStopResponse = typeof FLAddressChangeStopResponseValue;

/**
 * One call's share of the live changes whose step lapsed or whose waiting time ended.
 */
export interface FLAddressChangeSweepResponse {
  /** @minimum 0 */
  discarded: number;
  /** @minimum 0 */
  effective: number;
  nach: string | null;
  remaining: number;
  removed: number;
}

/**
 * The approval a change moving a grant waits on, read-only here: the administrators page approves it.
 *
 * Never who approved: a barred administrator's address is answered on no read.
 */
export interface FLAddressChangeVerwaltungApproval {
  approved_at: string | null;
  bis: string;
  verwaltung: FLVerwaltung;
}

/**
 * What the address holds that a change moves, counted: the tool names the kinds, the editors the records.
 */
export interface FLAddressChangeVerwaltungHoldings {
  /** @minimum 0 */
  bewerbung_seats: number;
  grant: FLVerwaltung | null;
  /** @minimum 0 */
  registrierungen: number;
  /** @minimum 0 */
  schiedsrichter: number;
  /** @minimum 0 */
  seats: number;
  /** @minimum 0 */
  spieler: number;
}

/**
 * A started or re-sent change, whose mails are owed in the Postausgang: no link is answered.
 */
export interface FLAddressChangeVerwaltungMintResponse {
  /** @minLength 1 */
  email: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  valid_until: string;
  way: FLAddressChangeWay;
}

export type FLOutboxDeliveryStand = (typeof FLOutboxDeliveryStand)[keyof typeof FLOutboxDeliveryStand];

export const FLOutboxDeliveryStand = {
  delivered: "delivered",
  delayed: "delayed",
  undeliverable: "undeliverable",
  suppressed: "suppressed",
  complaint: "complaint",
} as const;

export interface FLOutboxDelivery {
  am: string;
  grund: string | null;
  stand: FLOutboxDeliveryStand;
}

export type FLOutboxStateStand = (typeof FLOutboxStateStand)[keyof typeof FLOutboxStateStand];

export const FLOutboxStateStand = {
  open: "open",
  sent: "sent",
  withheld: "withheld",
  barred: "barred",
  dropped: "dropped",
  abandoned: "abandoned",
} as const;

/**
 * What became of the last mail owed about one record and seat, as an editor reads it beside the link.
 */
export interface FLOutboxState {
  delivery: FLOutboxDelivery | null;
  stand: FLOutboxStateStand;
  /**
   * Whether the mail did not arrive: given up, or refused, suppressed or marked as spam by its recipient.
   *
   * The one judgement of it, which the backend's refusals and every page showing the seat read.
   */
  readonly undeliverable: boolean;
}

/**
 * The address's live change whole, admin tier: the new address and the reason included, never a hash.
 */
export interface FLAddressChangeVerwaltungOpen {
  approval: FLAddressChangeVerwaltungApproval | null;
  confirmed_at: string | null;
  delivery: FLOutboxState | null;
  effective_from: string | null;
  email: string;
  expired: boolean;
  grund: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  released_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  sent_at: string;
  valid_until: string | null;
  waits_on: FLAddressChangeWaitsOn;
  way: FLAddressChangeWay;
}

/**
 * The address a change starts on, the address it goes to, and the reason where the address on file is gone.
 */
export interface FLAddressChangeVerwaltungPayload {
  /** @maxLength 254 */
  adresse: string;
  /** @maxLength 254 */
  email: string;
  grund: string | null;
}

/**
 * Exactly one key: the address typed, or the change a page links to.
 */
export interface FLAddressChangeVerwaltungViewPayload {
  address_change_id?: string | null;
  adresse?: string | null;
}

export interface FLAddressChangeVerwaltungViewResponse {
  adresse: string;
  holdings: FLAddressChangeVerwaltungHoldings;
  open: FLAddressChangeVerwaltungOpen | null;
  possible: boolean;
}

export type FLAddressChangeViewEndedSeite = (typeof FLAddressChangeViewEndedSeite)[keyof typeof FLAddressChangeViewEndedSeite];

export const FLAddressChangeViewEndedSeite = {
  new: "new",
  previous: "previous",
} as const;

/**
 * What either link opens once its change ended, for as long as its record is kept.
 */
export interface FLAddressChangeViewEnded {
  art: FLAddressChangeEndArt;
  seite: FLAddressChangeViewEndedSeite;
  state: "ended";
}

export type FLAddressChangeViewNewState = (typeof FLAddressChangeViewNewState)[keyof typeof FLAddressChangeViewNewState];

export const FLAddressChangeViewNewState = {
  valid: "valid",
  expired: "expired",
  barred: "barred",
  not_confirmable: "not_confirmable",
  confirmed: "confirmed",
  approval_expired: "approval_expired",
} as const;

/**
 * What the new mailbox's link opens while the change stands.
 */
export interface FLAddressChangeViewNew {
  approval_open: boolean | null;
  effective_from: string | null;
  seite: "new";
  state: FLAddressChangeViewNewState;
  valid_until: string | null;
  way: FLAddressChangeWay;
}

export type FLAddressChangeViewPreviousState = (typeof FLAddressChangeViewPreviousState)[keyof typeof FLAddressChangeViewPreviousState];

export const FLAddressChangeViewPreviousState = {
  release_open: "release_open",
  open: "open",
  approval: "approval",
  waiting_period: "waiting_period",
} as const;

/**
 * What the address on file's stop link opens: the step the change waits on, never whether it could be confirmed.
 */
export interface FLAddressChangeViewPrevious {
  effective_from: string | null;
  seite: "previous";
  state: FLAddressChangeViewPreviousState;
  valid_until: string | null;
  way: FLAddressChangeWay;
}

/**
 * What one address link opens: never a name, either address or the id.
 */
export interface FLAddressChangeViewResponse {
  view: FLAddressChangeViewNew | FLAddressChangeViewPrevious | FLAddressChangeViewEnded;
}

export type FLAddressChangeViewableDenied = (typeof FLAddressChangeViewableDenied)[keyof typeof FLAddressChangeViewableDenied];

export const FLAddressChangeViewableDenied = {
  own: "own",
  verwaltung: "verwaltung",
} as const;

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

export type FLApprovalDenied = (typeof FLApprovalDenied)[keyof typeof FLApprovalDenied];

export const FLApprovalDenied = {
  own: "own",
  started: "started",
  owner: "owner",
  younger: "younger",
} as const;

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

/**
 * The exit as an administrator writes it: the reason ceilinged as it arrives and stripped before its floor.
 *
 * On the WRITE side alone, so a read model takes a stored blank or a longer reason as it stands.
 */
export interface FLAustrittPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  /**
   * @minLength 1
   * @maxLength 500
   */
  grund: string;
  type: FLAustrittType;
}

/**
 * One seat's confirmation bookkeeping as the triage reads it, without its link's hashes.
 */
export interface FLBewerbungConfirmation {
  declined_at: string | null;
  delivery: FLOutboxState | null;
  reminded_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  sent_at: string;
}

/**
 * The three seats' bookkeeping, each null where an erasure emptied the seat.
 */
export interface FLBewerbungConfirmations {
  ansprechperson: FLBewerbungConfirmation | null;
  stellvertretung: FLBewerbungConfirmation | null;
  trainer: FLBewerbungConfirmation | null;
}

/**
 * A decision as every read serves it: the stored one, its administrator withheld where the ban list holds that address.
 */
export interface FLBewerbungDecisionRow {
  by_barred: boolean;
  grund: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  made_at: string;
  von: string | null;
}

/**
 * The school's own estimate of its squad, which nothing checks afterwards.
 */
export interface FLBewerbungKader {
  expected_size: number;
  good_spieler: number;
}

export type FLKontaktEnteredBy = (typeof FLKontaktEnteredBy)[keyof typeof FLKontaktEnteredBy];

export const FLKontaktEnteredBy = {
  bewerbung: "bewerbung",
  liga: "liga",
} as const;

/**
 * Which wording this person was shown, and how the record came to be held.
 *
 * Kenntnisnahme and not Einwilligung: the published basis is Art. 6(1)(b)/(f), and the pupil's
 * `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` holds other values entirely
 * (`docs/glossary.md :: Einwilligung`).
 */
export interface FLKontaktKenntnisnahme {
  confirmed_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  entered_by: FLKontaktEnteredBy;
  medien: boolean;
  nachweis: FLEinwilligungNachweise;
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

export type FLTrainerAlso = (typeof FLTrainerAlso)[keyof typeof FLTrainerAlso];

export const FLTrainerAlso = {
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
  trainer_is_also: FLTrainerAlso | null;
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
 * While the application is `submitted`, exactly one of this and `team_id` carries a value.
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
  submitted: "submitted",
  accepted: "accepted",
  declined: "declined",
} as const;

/**
 * What kit the school already owns, and the colour it would like; never copied onto the team.
 */
export interface FLBewerbungTrikot {
  existing_satz: string;
  wunschfarbe: FLTrikotFarbe;
}

/**
 * One school's application to play one season, as stored, its decision as served.
 */
export interface FLBewerbung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  confirmation_deadline: string;
  confirmations: FLBewerbungConfirmations;
  decision: FLBewerbungDecisionRow | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  kader: FLBewerbungKader;
  kontakte: FLSaisonTeamKontakte;
  saison_id: string;
  schule: FLBewerbungSchule | null;
  status: FLBewerbungStatus;
  stufengroesse: number;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  submitted_at: string;
  team_id: string | null;
  trikot: FLBewerbungTrikot;
  wunschgegner: string | null;
}

/**
 * A decline, to one person of the application, with the administrator's reason verbatim.
 */
export interface FLBewerbungAbsageData {
  art: "bewerbung_absage";
  grund: string;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  team: string;
}

/**
 * Which of the application's seats the withdrawal reached, and the two answers they now all hold.
 */
export interface FLBewerbungAccountEinwilligungResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  medien: boolean;
  nachweis_stand: FLEinwilligungStand;
  rollen: FLKontaktRolle[];
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * The school's address, with the Stadtteil required.
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

export type FLEinwilligungErgebnis = (typeof FLEinwilligungErgebnis)[keyof typeof FLEinwilligungErgebnis];

export const FLEinwilligungErgebnis = {
  confirmed: "confirmed",
  declined: "declined",
} as const;

/**
 * What the answer did; a Widerspruch's notice to the submitter is owed in the same write.
 */
export interface FLBewerbungEinwilligungAntwortResponse {
  ergebnis: FLEinwilligungErgebnis;
  geburtsdatum: string | null;
  medien: boolean;
  quelle: "bewerbung";
  whatsapp: boolean;
}

/**
 * One person's Widerspruch for one seat, which empties their slot: it carries nothing of them.
 */
export interface FLBewerbungEinwilligungDeclined {
  antwort: "declined";
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
}

/**
 * One person's consent for one seat: their own birthdate, their two choices and the wording they saw.
 */
export interface FLBewerbungEinwilligungGiven {
  antwort: "given";
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
  whatsapp: boolean;
}

/**
 * What the applicant agreed to; the scope and the date are the server's.
 */
export interface FLBewerbungEinwilligungPayload {
  given: true;
  /**
   * @minLength 1
   * @maxLength 64
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  text_version: string;
}

/**
 * The seat whose link was replaced and where its fresh one is owed; the old one opens nothing.
 */
export interface FLBewerbungEinwilligungResendResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  confirmation_deadline: string;
  email: string;
  rolle: FLKontaktRolle;
  rollen: FLKontaktRolle[];
}

export type FLBewerbungEinwilligungViewResponseQuelle =
  (typeof FLBewerbungEinwilligungViewResponseQuelle)[keyof typeof FLBewerbungEinwilligungViewResponseQuelle];

export const FLBewerbungEinwilligungViewResponseQuelle = {
  bewerbung: "bewerbung",
  saison: "saison",
} as const;

export type FLBewerbungEinwilligungViewResponseState =
  (typeof FLBewerbungEinwilligungViewResponseState)[keyof typeof FLBewerbungEinwilligungViewResponseState];

export const FLBewerbungEinwilligungViewResponseState = {
  valid: "valid",
  confirmed: "confirmed",
  declined: "declined",
  expired: "expired",
  saison_past: "saison_past",
  barred: "barred",
} as const;

export type FLKontaktRow = (typeof FLKontaktRow)[keyof typeof FLKontaktRow];

export const FLKontaktRow = {
  open: "open",
  saison_past: "saison_past",
  ausgetreten: "ausgetreten",
} as const;

/**
 * What the page renders for one seat, and nothing of the person.
 */
export interface FLBewerbungEinwilligungViewResponse {
  also_rolle: FLKontaktRolle | null;
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  minimum_age: number;
  quelle: FLBewerbungEinwilligungViewResponseQuelle;
  rolle: FLKontaktRolle;
  row: FLKontaktRow | null;
  running_wording: string;
  saison_id: string;
  schule: string;
  state: FLBewerbungEinwilligungViewResponseState;
}

/**
 * Another person's seats, as a mail names them to the submitter: a first name where one stands, and the seats.
 */
export interface FLBewerbungPerson {
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  vorname: string | null;
}

/**
 * The fourteen-day deletion notice, to the submitter, naming who never confirmed; owed in the erasure's own write.
 */
export interface FLBewerbungErasureData {
  art: "bewerbung_erasure";
  pending: FLBewerbungPerson[];
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
}

export interface FLBewerbungKaderPayload {
  /**
   * @minimum 1
   * @maximum 200
   */
  expected_size: number;
  /**
   * @minimum 0
   * @maximum 200
   */
  good_spieler: number;
}

/**
 * The corrected address and the one the page showed on the seat, and nothing else of the person.
 */
export interface FLBewerbungKontaktEmailPayload {
  /** @maxLength 254 */
  email: string;
  /** @maxLength 254 */
  previous_email: string;
}

/**
 * A seat's address as a correction or a new person left it, and every seat it reached; the link is owed there in the same write.
 */
export interface FLBewerbungKontaktEmailResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  confirmation_deadline: string;
  email: string;
  rollen: FLKontaktRolle[];
}

/**
 * The person seated where a contact person stepped out, who has agreed to nothing yet.
 */
export interface FLBewerbungKontaktSeatPayload {
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
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
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
 * One of the three people, as a member of the public submits them, without a birthdate.
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
 * The three people an application is reached through, all three required.
 */
export interface FLBewerbungKontaktePayload {
  ansprechperson: FLBewerbungKontaktpersonPayload;
  stellvertretung: FLBewerbungKontaktpersonPayload;
  trainer: FLBewerbungKontaktpersonPayload;
  trainer_is_also: FLTrainerAlso | null;
}

/**
 * Whether a proposed Kürzel is already a club's, active or retired, naming no club.
 */
export interface FLBewerbungKuerzelResponse {
  shorthand: string;
  taken: boolean;
}

export type FLBewerbungLinkDataArt = (typeof FLBewerbungLinkDataArt)[keyof typeof FLBewerbungLinkDataArt];

export const FLBewerbungLinkDataArt = {
  bewerbung_confirmation: "bewerbung_confirmation",
  bewerbung_reminder: "bewerbung_reminder",
} as const;

/**
 * One person's confirmation link on an application: at its submission, a re-send, a correction or a reseat, or the one reminder.
 *
 * `rollen` are every seat the link answers, two where the Trainer holds a second; the reminder's link joins the first.
 */
export interface FLBewerbungLinkData {
  art: FLBewerbungLinkDataArt;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  schule: string;
}

/**
 * A season that records no application window: its id, and `window` always null.
 */
export interface FLBewerbungNoWindowResponse {
  saison_id: string;
  /** @nullable */
  window: null;
}

/**
 * The submitter's receipt, which carries their own link: the Ansprechperson's seats and every other person still to answer.
 */
export interface FLBewerbungReceivedData {
  art: "bewerbung_received";
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  pending: FLBewerbungPerson[];
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
}

export type FLBewerbungSaisonReference = (typeof FLBewerbungSaisonReference)[keyof typeof FLBewerbungSaisonReference];

export const FLBewerbungSaisonReference = {
  diese_saison: "diese_saison",
  other_saison: "other_saison",
} as const;

/**
 * One club as the public form offers it: its id and its name.
 */
export interface FLBewerbungSchuleOption {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
}

/**
 * The club a new school proposes, bounded and stripped for the write.
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
  bewerbung: FLBewerbung;
  confirmation_deadline_expired: boolean;
}

/**
 * One season's pass: each clock's count, every reminder and deletion notice owed in the write it belongs to.
 */
export interface FLBewerbungSweepResponse {
  accepted_erased: number;
  declined_erased: number;
  erased: number;
  failed: number;
  kontakt_blocks_emptied: number;
  redacted_action_log: number;
  reminded: number;
  saison_id: string;
  without_decision_erased: number;
}

/**
 * Which kit colours one season has already assigned, naming no club.
 */
export interface FLBewerbungTrikotFarbenResponse {
  saison_id: string;
  taken: FLTrikotFarbe[];
}

export interface FLBewerbungTrikotPayload {
  /** @maxLength 500 */
  existing_satz: string;
  wunschfarbe: FLTrikotFarbe;
}

/**
 * A contact's Widerspruch, to the submitter, naming the person who refused: it stands as the deletion notice too.
 */
export interface FLBewerbungWiderspruchData {
  art: "bewerbung_widerspruch";
  declined: FLBewerbungPerson;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
}

/**
 * One season's application window and whether that season has ended, and nothing else about it.
 */
export interface FLBewerbungWindowResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  bis: string;
  offen: boolean;
  running: boolean;
  saison_ended: boolean;
  saison_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  von: string;
}

/**
 * An acceptance, to one person of the application, naming the seats they were entered for.
 */
export interface FLBewerbungZusageData {
  art: "bewerbung_zusage";
  gruppe: FLGruppenNames;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  team: string;
  trikot_farbe: FLTrikotFarbe | null;
  wunschgegner: string | null;
}

/**
 * The queue, newest first, and whether that is the whole of it.
 *
 * `duplicates_key` is taken over every open application, so a pair the cap parted is named at both ends.
 */
export interface FLBewerbungenListResponse {
  bewerbungen: FLBewerbung[];
  complete: boolean;
  count_per_saison_reference: Partial<Record<FLBewerbungSaisonReference, number>>;
  count_per_status: Partial<Record<FLBewerbungStatus, number>>;
  duplicates_key: string[];
}

export type FLBookingResource = (typeof FLBookingResource)[keyof typeof FLBookingResource];

export const FLBookingResource = {
  ort: "ort",
  schiedsrichter: "schiedsrichter",
} as const;

export type FLBracketFaultGruppeReason = (typeof FLBracketFaultGruppeReason)[keyof typeof FLBracketFaultGruppeReason];

export const FLBracketFaultGruppeReason = {
  gruppe_not_run: "gruppe_not_run",
  gruppe_too_small: "gruppe_too_small",
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

export type FLBracketFaultQuelleReason = (typeof FLBracketFaultQuelleReason)[keyof typeof FLBracketFaultQuelleReason];

export const FLBracketFaultQuelleReason = {
  feeder_not_played_first: "feeder_not_played_first",
  gruppenphase_feeder: "gruppenphase_feeder",
  reference_cycle: "reference_cycle",
  spiel_missing: "spiel_missing",
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

export type FLBracketFaultSpielReason = (typeof FLBracketFaultSpielReason)[keyof typeof FLBracketFaultSpielReason];

export const FLBracketFaultSpielReason = {
  same_team: "same_team",
} as const;

/**
 * One fixture whose two references resolve to the same club; the fixture keeps its stored sides.
 */
export interface FLBracketFaultSpiel {
  reason: FLBracketFaultSpielReason;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLSpielQuelleGruppeType = (typeof FLSpielQuelleGruppeType)[keyof typeof FLSpielQuelleGruppeType];

export const FLSpielQuelleGruppeType = {
  gruppe: "gruppe",
} as const;

/**
 * A slot fed by the group phase: the team finishing `platz` in `gruppe`.
 */
export interface FLSpielQuelleGruppe {
  gruppe: FLGruppenNames;
  /** @exclusiveMinimum 0 */
  platz: number;
  type: FLSpielQuelleGruppeType;
}

export type FLSpielQuelleSpielAusgang = (typeof FLSpielQuelleSpielAusgang)[keyof typeof FLSpielQuelleSpielAusgang];

export const FLSpielQuelleSpielAusgang = {
  sieger: "sieger",
  verlierer: "verlierer",
} as const;

export type FLSpielQuelleSpielType = (typeof FLSpielQuelleSpielType)[keyof typeof FLSpielQuelleSpielType];

export const FLSpielQuelleSpielType = {
  spiel: "spiel",
} as const;

/**
 * A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`.
 */
export interface FLSpielQuelleSpiel {
  ausgang: FLSpielQuelleSpielAusgang;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  type: FLSpielQuelleSpielType;
}

export type FLSpielQuelle = FLSpielQuelleGruppe | FLSpielQuelleSpiel;

export type FLBracketFaultSlotReason = (typeof FLBracketFaultSlotReason)[keyof typeof FLBracketFaultSlotReason];

export const FLBracketFaultSlotReason = {
  gruppenphase_fixture_wired: "gruppenphase_fixture_wired",
  source_feeds_another_fixture: "source_feeds_another_fixture",
} as const;

export type FLSpielSeite = (typeof FLSpielSeite)[keyof typeof FLSpielSeite];

export const FLSpielSeite = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * One slot carrying a reference it must not carry, whatever that reference names.
 */
export interface FLBracketFaultSlot {
  quelle: FLSpielQuelle;
  reason: FLBracketFaultSlotReason;
  side: FLSpielSeite;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFaultOccupantReason = (typeof FLBracketFaultOccupantReason)[keyof typeof FLBracketFaultOccupantReason];

export const FLBracketFaultOccupantReason = {
  departed_occupant: "departed_occupant",
} as const;

/**
 * One fixture fielding a team on or after the day it left the season, or undated, with no recorded absence excusing it.
 *
 * Nothing is emptied.
 */
export interface FLBracketFaultOccupant {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  ausgeschieden_seit: string;
  austritt_type: FLAustrittType;
  reason: FLBracketFaultOccupantReason;
  side: FLSpielSeite;
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

export type FLBracketFaultSpieltagReason = (typeof FLBracketFaultSpieltagReason)[keyof typeof FLBracketFaultSpieltagReason];

export const FLBracketFaultSpieltagReason = {
  fielded_twice: "fielded_twice",
} as const;

/**
 * A club standing more than once on one Spieltag, one entry per appearance.
 */
export interface FLBracketFaultSpieltag {
  reason: FLBracketFaultSpieltagReason;
  side: FLSpielSeite;
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

export type FLBracketFaultBookingReason = (typeof FLBracketFaultBookingReason)[keyof typeof FLBracketFaultBookingReason];

export const FLBracketFaultBookingReason = {
  retired_booking: "retired_booking",
} as const;

/**
 * A fixture still to be played booked onto a retired venue or referee.
 *
 * Nothing is taken off: only a person chooses between reactivating the row and booking another.
 */
export interface FLBracketFaultBooking {
  booking: FLBookingResource;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  booking_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  inactive_since: string;
  name: string | null;
  reason: FLBracketFaultBookingReason;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFaultClashReason = (typeof FLBracketFaultClashReason)[keyof typeof FLBracketFaultClashReason];

export const FLBracketFaultClashReason = {
  double_booked: "double_booked",
} as const;

/**
 * A venue or referee claimed less than four hours from another fixture's claim, one entry per claim.
 *
 * It names the fixture a save's clash refusal names.
 */
export interface FLBracketFaultClash {
  booking: FLBookingResource;
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
  reason: FLBracketFaultClashReason;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
}

export type FLBracketFault =
  | FLBracketFaultGruppe
  | FLBracketFaultQuelle
  | FLBracketFaultSpiel
  | FLBracketFaultSlot
  | FLBracketFaultOccupant
  | FLBracketFaultSpieltag
  | FLBracketFaultBooking
  | FLBracketFaultClash;

/**
 * One person's confirmation bookkeeping as an administrator reads it, and no token hash.
 *
 * The hash is a raw document key the confirmation query alone reads, so no read serves one.
 */
export interface FLConfirmation {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  reminded_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  sent_at: string;
}

export type FLConfirmationState = (typeof FLConfirmationState)[keyof typeof FLConfirmationState];

export const FLConfirmationState = {
  valid: "valid",
  confirmed: "confirmed",
  expired: "expired",
  barred: "barred",
} as const;

/**
 * The id a create minted, which the caller reads the new record by.
 */
export interface FLCreatedResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
}

/**
 * Why the application was declined.
 */
export interface FLDeclineBewerbungPayload {
  /**
   * @minLength 1
   * @maxLength 1000
   */
  grund: string;
}

/**
 * The declined application; its mails are owed in the same write.
 */
export interface FLDeclineBewerbungResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

export type FLEinwilligungSeitenResponseRunningWordings = { [key: string]: string };

/**
 * The label each page stamps on a new acceptance today, which a deploy moves: never cached by a reader.
 */
export interface FLEinwilligungSeitenResponse {
  running_wordings: FLEinwilligungSeitenResponseRunningWordings;
}

export type FLEinwilligungWordingAbsaetzeNachSchluessel = { [key: string]: string } | null;

export type FLEinwilligungWordingControls = { [key: string]: string };

/**
 * The words one consent label names, as the person stamping it was shown them.
 *
 * Never changed once served: different words are a new label.
 */
export interface FLEinwilligungWording {
  absaetze: string[];
  absaetze_nach_schluessel: FLEinwilligungWordingAbsaetzeNachSchluessel;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  applies_from: string;
  controls: FLEinwilligungWordingControls;
  placeholder: string[];
  seite: string;
  switch: string;
  text_version: string;
}

export interface FLEinwilligungWordingResponse {
  wording: FLEinwilligungWording;
}

/**
 * The mailbox an erasure, its preview or a sign-out of every session is looked up by.
 */
export interface FLErasureAdressePayload {
  /**
   * @maxLength 254
   * @pattern @
   */
  email: string;
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

/**
 * How many pupils the run erases once this season is activated, counted and never named.
 */
export interface FLErasurePreviewResponse {
  completed_saison_id: string | null;
  spieler: number;
}

export interface FLErasureResponse {
  /** @minimum 0 */
  address_change: number;
  /** @minimum 0 */
  grants: number;
  /** @minimum 0 */
  grants_approval_requests: number;
  /** @minimum 0 */
  kontakt_seats: number;
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

/**
 * One call's share of the season-after rule: what it erased, whom it passed over, and how many are still due.
 */
export interface FLErasureSweepResponse {
  completed_saison_id: string | null;
  failed: number;
  nach: string | null;
  registrierungen: number;
  remaining: number;
  saison_spieler: number;
  skipped: number;
  spieler: number;
}

/**
 * Another address's live change naming this one as its new address: the change ends, its address's records standing.
 */
export interface FLErasureViewAddressChange {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  address_change_id: string;
  viewable_denied: FLAddressChangeViewableDenied | null;
}

export type FLErasureViewApprovalRequestRolle = (typeof FLErasureViewApprovalRequestRolle)[keyof typeof FLErasureViewApprovalRequestRolle];

export const FLErasureViewApprovalRequestRolle = {
  betroffen: "betroffen",
  gestellt: "gestellt",
} as const;

/**
 * An open request for a grant, about the address (`betroffen`) or made by it (`gestellt`), which the erasure removes.
 */
export interface FLErasureViewApprovalRequest {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  approval_request_id: string;
  rolle: FLErasureViewApprovalRequestRolle;
  verwaltung: FLVerwaltung;
}

export interface FLErasureViewBewerbung {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  vorname: string;
}

/**
 * One squad row of a pupil the erasure reaches.
 */
export interface FLErasureViewKader {
  inactive_since: string | null;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string | null;
}

/**
 * The address's own live change, which the erasure ends with the records it would move.
 */
export interface FLErasureViewOwnAddressChange {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  address_change_id: string;
}

export type FLRegistrierungStatus = (typeof FLRegistrierungStatus)[keyof typeof FLRegistrierungStatus];

export const FLRegistrierungStatus = {
  submitted: "submitted",
  declined: "declined",
} as const;

export interface FLErasureViewRegistrierung {
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

export interface FLErasureViewSchiedsrichter {
  inactive_since: string | null;
  name: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
  spiele_without_ergebnis_saison_ids: string[];
}

export interface FLErasureViewSeat {
  nachname: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
  vorname: string;
}

export interface FLErasureViewSpieler {
  kader: FLErasureViewKader[];
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  vorname: string;
}

export interface FLErasureViewResponse {
  address_change: FLErasureViewAddressChange[];
  approval_requests: FLErasureViewApprovalRequest[];
  barred: boolean;
  bewerbungen: FLErasureViewBewerbung[];
  own_address_change: FLErasureViewOwnAddressChange | null;
  registrierungen: FLErasureViewRegistrierung[];
  schiedsrichter: FLErasureViewSchiedsrichter[];
  seats: FLErasureViewSeat[];
  spieler: FLErasureViewSpieler[];
  verwaltung: FLVerwaltung | null;
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
  number_of_gruppen: number;
  /** @exclusiveMinimum 0 */
  qualifiers_per_gruppe: number;
  /**
   * @minimum 2
   * @maximum 16
   */
  teams_per_gruppe: number;
}

/**
 * Whether this draw may REPLACE what the season already holds, and the shape it runs from.
 *
 * An absent body is a first draw off the season's own rules: nothing is destroyed and no
 * number moves by omission. `spielplan_replace_outside_its_window` bounds a confirmed one.
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
  generated_at: string;
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
 * The change of this grant's address that waits on an administrator's approval.
 */
export interface FLGrantAddressChange {
  bis: string;
  confirmed: boolean;
  denied: FLApprovalDenied | null;
  email: string | null;
  email_barred: boolean;
  grund: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  started_by: string | null;
  started_by_barred: boolean;
  viewable_denied: FLAddressChangeViewableDenied | null;
  way: FLAddressChangeWay;
}

/**
 * The request a refusal or a withdrawal removed: a removal is hard, so the id is all there is to answer with.
 */
export interface FLGrantApprovalRequestDeclinedResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  approval_request_id: string;
}

/**
 * One request as the list serves it, while it may still be decided.
 */
export interface FLGrantApprovalRequestRow {
  adresse: string | null;
  asked_at: string;
  barred: boolean;
  bis: string;
  denied: FLApprovalDenied | null;
  grant_id: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  stands: boolean;
  started_by: string | null;
  started_by_barred: boolean;
  verwaltung: FLVerwaltung;
}

export type FLGrantDataAuthor = (typeof FLGrantDataAuthor)[keyof typeof FLGrantDataAuthor];

export const FLGrantDataAuthor = {
  anwendung: "anwendung",
  datenbank: "datenbank",
} as const;

export type FLGrantDataChange = (typeof FLGrantDataChange)[keyof typeof FLGrantDataChange];

export const FLGrantDataChange = {
  granted: "granted",
  revoked: "revoked",
  changed: "changed",
  requested: "requested",
} as const;

export type FLGrantDataWithheld = (typeof FLGrantDataWithheld)[keyof typeof FLGrantDataWithheld] | null;

export const FLGrantDataWithheld = {
  barred: "barred",
  erased: "erased",
} as const;

/**
 * One grant's address and tier at one moment.
 */
export interface FLGrantStand {
  adresse: string | null;
  verwaltung: FLVerwaltung;
}

/**
 * A change to a grant, or a grant or promotion asked for, as the notice to each administrator states it.
 */
export interface FLGrantData {
  art: "grant";
  author: FLGrantDataAuthor;
  before: FLGrantStand | null;
  change: FLGrantDataChange;
  changed_at: string | null;
  changed_by: string | null;
  now: FLGrantStand | null;
  withheld: FLGrantDataWithheld;
}

export interface FLGrantReconciliationResponse {
  /** @minimum 0 */
  changes: number;
}

/**
 * One grant as the list serves it.
 */
export interface FLGrantRow {
  address_change: FLGrantAddressChange | null;
  adresse: string | null;
  barred: boolean;
  granted_at: string;
  granted_by: string | null;
  granted_by_barred: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  version: number;
  verwaltung: FLVerwaltung;
}

/**
 * The grant a tier change named, and whether its promotion waits on another owner's approval rather than taking effect.
 */
export interface FLGrantStufeResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  grant_id: string;
  requested: boolean;
}

/**
 * The grant a revoke removed or an approval wrote or promoted.
 */
export interface FLGrantWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  grant_id: string;
}

/**
 * Every grant, never in part, and every request still waiting.
 */
export interface FLGrantsListResponse {
  approval_requests: FLGrantApprovalRequestRow[];
  grants: FLGrantRow[];
}

export interface FLTeamStatistik {
  /** @minimum 0 */
  count_abgesagte_spiele: number;
  /** @minimum 0 */
  count_gespielte_spiele: number;
  /** @minimum 0 */
  niederlagen: number;
  /** @minimum 0 */
  punkte: number;
  /** @minimum 0 */
  siege: number;
  /** @minimum 0 */
  tore_geschossen: number;
  /** @minimum 0 */
  tore_kassiert: number;
  /** @minimum 0 */
  unentschieden: number;
}

/**
 * One row of a league table: what a standing shows and nothing more.
 *
 * Narrower than `FLTeam` on purpose: a public CLIENT component renders this, so every field is
 * serialised into the page, and a club's address is a school's street.
 */
export interface FLGruppenTeam {
  austritt_type: FLAustrittType | null;
  /** @minimum 0 */
  count_pending_spiele: number;
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

/**
 * A team's registration link, to one confirmed contact seat, for the pupils to register through.
 */
export interface FLInvitationData {
  art: "invitation";
  saison_id: string;
  team: string;
}

export type FLInvitationDispatchGrund = (typeof FLInvitationDispatchGrund)[keyof typeof FLInvitationDispatchGrund];

export const FLInvitationDispatchGrund = {
  austritt_entered: "austritt_entered",
  erzeugung_failed: "erzeugung_failed",
  erzeugung_uncertain: "erzeugung_uncertain",
  no_kontaktblock: "no_kontaktblock",
  no_confirmed_kontaktperson: "no_confirmed_kontaktperson",
  kontakte_barred: "kontakte_barred",
  already_sent: "already_sent",
} as const;

export interface FLInvitationDispatchPayload {
  resend?: boolean;
}

/**
 * One mailbox a link goes to, and the seat it is addressed as.
 */
export interface FLInvitationRecipient {
  /** @minLength 1 */
  email: string;
  rolle: FLKontaktRolle;
  /** @minLength 1 */
  vorname: string;
}

/**
 * One team as the preview reports it. It mints nothing, so it answers no link.
 */
export interface FLInvitationDispatchPreviewRow {
  recipient: FLInvitationRecipient[];
  replaced_link: boolean;
  skipped: FLInvitationDispatchGrund | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  team_name: string;
}

/**
 * Who the press would mail, over the same rule the press then performs.
 */
export interface FLInvitationDispatchPreviewResponse {
  rows: FLInvitationDispatchPreviewRow[];
  /** @minLength 1 */
  saison_id: string;
}

/**
 * One team as the press left it: `recipient` are owed the team's link, which each mail's hand-out mints.
 */
export interface FLInvitationDispatchRow {
  had_link: boolean | null;
  recipient: FLInvitationRecipient[];
  replaced_link: boolean;
  skipped: FLInvitationDispatchGrund | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  team_name: string;
}

/**
 * What the press did, per admitted team of the season.
 */
export interface FLInvitationDispatchResponse {
  rows: FLInvitationDispatchRow[];
  /** @minLength 1 */
  saison_id: string;
}

/**
 * The one live link a team's panel shows, to be mailed to the team's confirmed seats.
 */
export interface FLInvitationMailPayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  invitation_id: string;
}

/**
 * Who the team's live link is owed to: its confirmed seats, one entry per stored address, none where nobody confirmed.
 */
export interface FLInvitationMailResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  invitation_id: string;
  recipient: FLInvitationRecipient[];
}

/**
 * A freshly minted registration link, and the only answer that ever carries its raw value.
 *
 * Shown once for copying and mailed on a separate press; no later read recovers it from the hash.
 */
export interface FLInvitationMintResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  created_at: string;
  /** @minLength 1 */
  created_by: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  invitation_id: string;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  token: string;
}

/**
 * One live link as the team's read serves it: the stored row, its minter withheld where the ban list holds that address.
 */
export interface FLInvitationRow {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  created_at: string;
  created_by: string | null;
  created_by_barred: boolean;
  delivery: FLOutboxState | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  widerrufen_am: string | null;
}

/**
 * The team's live link for one season, or nothing, beside the window deciding what it opens.
 */
export interface FLInvitationResponse {
  invitation: FLInvitationRow | null;
  running: boolean;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export type FLSaisonStatus = (typeof FLSaisonStatus)[keyof typeof FLSaisonStatus];

export const FLSaisonStatus = {
  past: "past",
  active: "active",
  future: "future",
} as const;

/**
 * What an invite's holder is told before they type anything, and the bounds the form is held to.
 */
export interface FLInvitationViewResponse {
  allowed_stufen: FLSpielerStufe[];
  kader_free: boolean;
  nachnominierung: boolean;
  running: boolean;
  saison_id: string;
  saison_status: FLSaisonStatus;
  /** @minLength 1 */
  schule: string;
  /** @minLength 1 */
  team: string;
  team_entered: boolean;
}

/**
 * The revoked row. Revoking keeps it, so a delivery event about its link still lands somewhere.
 */
export interface FLInvitationWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  invitation_id: string;
  /** @minLength 1 */
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * One squad row as its team's seat holder reads it (`READ-KADER-001`).
 *
 * Declared from nothing rather than a public model unmasked, so the whole surname reaches no
 * base-tier model, and no address or telephone number reaches this one.
 */
export interface FLKaderRow {
  inactive_since: string | null;
  is_nachnominiert: boolean;
  nachname: string | null;
  nummer: string | null;
  nummer_double: boolean;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  version: number;
  /** @minLength 1 */
  vorname: string;
}

/**
 * A team's squad for one season, live and ausgetragen rows alike, with the Stufen the season's rules offer.
 */
export interface FLKaderResponse {
  /** @minItems 1 */
  allowed_stufen: FLSpielerStufe[];
  kader: FLKaderRow[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export type FLKartenFarbe = (typeof FLKartenFarbe)[keyof typeof FLKartenFarbe];

export const FLKartenFarbe = {
  gelb: "gelb",
  gelb_rot: "gelb_rot",
  rot: "rot",
} as const;

export type FLKartenGrund = (typeof FLKartenGrund)[keyof typeof FLKartenGrund];

export const FLKartenGrund = {
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

/**
 * One person a write owed a fresh confirmation link, which the Postausgang mails: never the link itself.
 */
export interface FLKontaktMint {
  email: string;
  rollen: FLKontaktRolle[];
}

/**
 * A fresh link owed one seat, and its pair where the Trainer holds both; the old link opens nothing from this write on.
 */
export interface FLKontaktInviteResponse {
  confirmation: FLKontaktMint;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLKontaktKenntnisnahmePayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  /**
   * @minLength 1
   * @maxLength 64
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  text_version: string;
  umfang: "kontaktdaten";
}

/**
 * One person an administrator seated on a team's season row, asked to confirm: no name, the address being unconfirmed.
 */
export interface FLKontaktLinkData {
  art: "kontakt_confirmation";
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  row: FLKontaktRow;
  saison_id: string;
  schule: string;
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
 * The stored person a confirmed registration's address resolves to, named so the team can be asked whether it is the same one.
 */
export interface FLRegistrierungPerson {
  deviates_from: boolean;
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * One pending registration as the team deciding it reads it.
 */
export interface FLOpenRegistrierung {
  admissible: boolean;
  /** @minLength 1 */
  nachname: string;
  nummer: string | null;
  nummer_double: boolean;
  person: FLRegistrierungPerson | null;
  position: FLSpielerPosition | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  submitted_at: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * One team's pending registrations for one season, and whether that is the whole of them.
 */
export interface FLOpenRegistrierungenResponse {
  complete: boolean;
  registrierungen: FLOpenRegistrierung[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * One delivery event about a message the provider accepted, named by the row the message was sent from.
 */
export interface FLOutboxEventPayload {
  am: string;
  grund: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  stand: FLOutboxDeliveryStand;
}

/**
 * Whether the event reached a row; false where no row has the id, or the row's state may not follow into it.
 *
 * False rather than a refusal: the provider repeats a settled event for hours if anything but a success answers it.
 */
export interface FLOutboxEventResponse {
  applied: boolean;
}

export const FLSignInCodeDataValue = {
  art: "sign_in_code",
} as const;
export type FLSignInCodeData = typeof FLSignInCodeDataValue;

export type FLPasskeyDataArt = (typeof FLPasskeyDataArt)[keyof typeof FLPasskeyDataArt];

export const FLPasskeyDataArt = {
  passkey_hinzugefuegt: "passkey_hinzugefuegt",
  passkey_erased: "passkey_erased",
} as const;

export interface FLPasskeyData {
  /**
   * @maxLength 256
   * @pattern ^/[a-z0-9/_-]*$
   */
  account: string;
  art: FLPasskeyDataArt;
  instant: string;
}

/**
 * The ban's own notice, the one mail a ban does not stop (`app/api/outbox/services.py :: UNGESPERRT`).
 */
export interface FLSperreData {
  art: "sperre";
  barred_until_saison_id: string;
  grund: string;
}

/**
 * A referee's confirmation link, owed by their entry, a corrected address, a re-send or their return.
 */
export interface FLSchiedsrichterConfirmationData {
  art: "schiedsrichter_confirmation";
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
}

/**
 * A fixture as a mail asking about it states it, its ground among the rest.
 */
export interface FLSpielMailAnsetzung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  ort: string | null;
  team1: string;
  team2: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  uhrzeit: string;
}

export type FLSpielRequestDataArt = (typeof FLSpielRequestDataArt)[keyof typeof FLSpielRequestDataArt];

export const FLSpielRequestDataArt = {
  spiel_request: "spiel_request",
  spiel_reminder: "spiel_reminder",
} as const;

/**
 * A club's request to confirm a fixture, or the reminder of it, each carrying a link of its own.
 */
export interface FLSpielRequestData {
  ansetzung: FLSpielMailAnsetzung;
  art: FLSpielRequestDataArt;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  team: string;
}

/**
 * A referee's word that they are booked onto a fixture, which they answer on their own panel.
 */
export interface FLSpielEinteilungData {
  ansetzung: FLSpielMailAnsetzung;
  art: "spiel_einteilung";
}

/**
 * A fixture's slot as a mail names it: its two sides in the fixture's order, its day and its hour.
 */
export interface FLSpielMailAppointment {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  team1: string;
  team2: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  uhrzeit: string;
}

export type FLSpielHinweisDataArt = (typeof FLSpielHinweisDataArt)[keyof typeof FLSpielHinweisDataArt];

export const FLSpielHinweisDataArt = {
  spiel_new_angesetzt: "spiel_new_angesetzt",
  spiel_abgesagt: "spiel_abgesagt",
} as const;

export type FLSpielHinweisDataRecipient = (typeof FLSpielHinweisDataRecipient)[keyof typeof FLSpielHinweisDataRecipient];

export const FLSpielHinweisDataRecipient = {
  team: "team",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A party's word that a fixture it was asked about moved or was called off: the slot it was asked about.
 */
export interface FLSpielHinweisData {
  appointment: FLSpielMailAppointment;
  art: FLSpielHinweisDataArt;
  recipient: FLSpielHinweisDataRecipient;
}

/**
 * A referee's word that they were taken off a fixture after being told of it: the slot they were told of.
 */
export interface FLSpielEinteilungLiftedData {
  appointment: FLSpielMailAppointment;
  art: "spiel_einteilung_lifted";
}

/**
 * A club's word that the league kept the date it declined and proposed another for: the slot that stands.
 */
export interface FLSpielVorschlagDiscardedData {
  appointment: FLSpielMailAppointment;
  art: "spiel_vorschlag_discarded";
}

export type FLRegistrierungLinkDataArt = (typeof FLRegistrierungLinkDataArt)[keyof typeof FLRegistrierungLinkDataArt];

export const FLRegistrierungLinkDataArt = {
  registrierung_confirmation: "registrierung_confirmation",
  registrierung_reminder: "registrierung_reminder",
} as const;

/**
 * A pupil's confirmation link, first or as the one reminder, which joins the first link rather than replacing it.
 */
export interface FLRegistrierungLinkData {
  art: FLRegistrierungLinkDataArt;
  /** @minimum 1 */
  frist_days: number;
  saison_id: string;
  team: string;
}

/**
 * A team's decline, to a pupil whose address was confirmed.
 */
export interface FLRegistrierungAbsageData {
  art: "registrierung_absage";
  grund: "other_person" | null;
  saison_id: string;
  team: string;
  vorname: string;
}

/**
 * One owed mail a claim hands out, server to server alone: it names its recipient and may carry a live link or secret.
 */
export interface FLOutboxHandout {
  an: string;
  /** @minimum 1 */
  attempt: number;
  data:
    | FLSignInCodeData
    | FLPasskeyData
    | FLAccountErasureData
    | FLSperreData
    | FLGrantData
    | FLAddressChangeLinkData
    | FLAddressChangeHinweisData
    | FLAddressChangeEffectiveData
    | FLAddressChangeDiscardedData
    | FLSchiedsrichterConfirmationData
    | FLSpielRequestData
    | FLSpielEinteilungData
    | FLSpielHinweisData
    | FLSpielEinteilungLiftedData
    | FLSpielVorschlagDiscardedData
    | FLRegistrierungLinkData
    | FLRegistrierungAbsageData
    | FLInvitationData
    | FLBewerbungLinkData
    | FLBewerbungReceivedData
    | FLBewerbungZusageData
    | FLBewerbungAbsageData
    | FLBewerbungErasureData
    | FLBewerbungWiderspruchData
    | FLKontaktLinkData;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  secret: string | null;
  token: string | null;
}

/**
 * The owed mails one claim holds, oldest first; `lease` is null exactly where it holds none.
 */
export interface FLOutboxHandoutResponse {
  /** @minimum 0 */
  abandoned: number;
  lease: string | null;
  mails: FLOutboxHandout[];
}

export type FLOutboxResultPayloadResult = (typeof FLOutboxResultPayloadResult)[keyof typeof FLOutboxResultPayloadResult];

export const FLOutboxResultPayloadResult = {
  sent: "sent",
  retry: "retry",
  abandon: "abandon",
  withheld: "withheld",
} as const;

/**
 * The outcome of one handed-out mail's send, reported as the send returns.
 */
export interface FLOutboxResultPayload {
  grund: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  lease: string;
  message_id: string | null;
  result: FLOutboxResultPayloadResult;
}

export interface FLOutboxResultResponse {
  /** @minimum 0 */
  abandoned: number;
  /** @minimum 0 */
  ignored: number;
  /** @minimum 0 */
  repeated: number;
  /** @minimum 0 */
  sent: number;
  /** @minimum 0 */
  withheld: number;
}

/**
 * One mail of the sign-in library, owed to the address it names.
 */
export interface FLOutboxSignInPayload {
  /** @maxLength 254 */
  an: string;
  data: FLSignInCodeData | FLPasskeyData | FLAccountErasureData;
  secret: string | null;
  valid_until: string | null;
}

export interface FLPatchGrantPayload {
  version?: number | null;
  verwaltung: FLVerwaltung;
}

/**
 * What a team's seat holder may change on a live squad row, WHOLESALE for `FLPatchSpielerPayload`'s reason.
 *
 * Never `_SaisonSpielerPayload`'s child, which carries `team_id`: a representative moves no pupil
 * to another team, and `extra="forbid"` refuses that key.
 */
export interface FLPatchKaderRowPayload {
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  stufe: FLSpielerStufe | null;
  version?: number | null;
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

/**
 * What a fixture is awarded when one side does not appear.
 *
 * Both sides' goals rather than a margin, composed at `app/api/spiele/services.py :: apply_payload_to_spiel`.
 * A LEVEL award needs a season with no knockout round (`rules_forfeit_unentschieden_in_a_knockout`).
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
  /** @minItems 1 */
  allowed_stufen: FLSpielerStufe[];
  /** @minimum 0 */
  draw_points: number;
  forfeit_ergebnis: FLSaisonForfeitErgebnis;
  /** @exclusiveMinimum 0 */
  max_kadergroesse: number;
  /**
   * @maximum 16
   * @exclusiveMinimum 0
   */
  number_of_gruppen: number;
  /** @exclusiveMinimum 0 */
  qualifiers_per_gruppe: number;
  /**
   * @minimum 2
   * @maximum 16
   */
  teams_per_gruppe: number;
  tiebreak_order: FLSaisonRulesTiebreakOrder;
  /** @exclusiveMinimum 0 */
  win_points: number;
}

export interface FLPatchSaisonPayload {
  bewerbung: FLSaisonBewerbung | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  version?: number | null;
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
  version?: number | null;
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
  trainer_is_also: FLTrainerAlso | null;
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
  version?: number | null;
}

/**
 * The block as STORED after the write, and each person it owed a link.
 *
 * No other field off that row: the caller sent none, and echoing one would invite a client to
 * believe this endpoint owns it.
 */
export interface FLPatchSaisonTeamKontakteResponse {
  confirmations: FLKontaktMint[];
  kontakte: FLSaisonTeamKontakte | null;
  saison_id: string;
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
  austritt: FLAustrittPayload | null;
  gruppe: FLGruppenNames;
  trikot_farbe: FLTrikotFarbe | null;
  version?: number | null;
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
  version?: number | null;
}

/**
 * The confirmation link a write owed the referee, which the Postausgang mints and mails: never the link itself.
 */
export interface FLSchiedsrichterMint {
  /** @minLength 1 */
  email: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
}

export interface FLPatchSchiedsrichterResponse {
  confirmation: FLSchiedsrichterMint | null;
  fanned_out_to_spiele: number;
}

/**
 * The penalty shoot-out that settled a level knockout fixture: the side with more goals in it won.
 */
export interface FLSpielElfmeterschiessen {
  /** @minimum 0 */
  team1: number;
  /** @minimum 0 */
  team2: number;
}

/**
 * The venue as the save sends it: which ground, and what this fixture pays for it.
 */
export interface FLSpielOrtFieldPayload {
  /** @minimum 0 */
  mietpreis: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielort_id: string;
}

/**
 * The referee as the save sends it: who, and what this fixture pays them.
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
 * One side of a fixture as the save sends it: the team and its goals.
 *
 * The server composes the name and shorthand from the season's team row and ignores a copy sent.
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
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldPayload | null;
  team2_quelle: FLSpielQuelle | null;
  uhrzeit: string | null;
  version?: number | null;
}

/**
 * One fixture the bracket resolution rewrote, and the result that rewrite destroyed.
 *
 * Every voided field is null where a slot merely filled from empty.
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

/**
 * One side another fixture gave up so a team can play this Spieltag, and the result that destroyed.
 */
export interface FLSpielReleasedSide {
  side: FLSpielSeite;
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
 * Every fixture the save moved beyond its own edit, each with the result it destroyed, and the bracket's faults after it.
 *
 * `version` is the fixture's own after the save, the one its next save sends; `bericht_adopted` says whether the
 * adoption `adopts_bericht` asked for was stamped, null where none was asked or on a `dry_run`.
 */
export interface FLPatchSpielDataResponse {
  advanced_to: FLSpielAdvancement[];
  bericht_adopted: boolean | null;
  bracket_faults: FLBracketFault[];
  released_sides: FLSpielReleasedSide[];
  version: number;
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
  version?: number | null;
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
  /**
   * @minLength 1
   * @maxLength 120
   */
  name: string;
  version?: number | null;
}

export interface FLPatchSpielortResponse {
  fanned_out_to_spiele: number;
}

export interface FLPatchSpieltagPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  beginn: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  ende: string;
  version?: number | null;
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
  version?: number | null;
  website_url: string | null;
}

export interface FLPatchTeamResponse {
  fanned_out_to_saison_teams: number;
  fanned_out_to_spiele: number;
}

/**
 * One school's application, as the public form submits it.
 *
 * `status`, `submitted_at` and `decision` are the server's.
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

export interface FLPostGrantPayload {
  /** @maxLength 254 */
  email: string;
}

export interface FLPostGrantResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
  requested: boolean;
}

/**
 * One pupil registering through a team's link.
 *
 * The team, the season, the state, the deadline and the confirmation link come from the invite and the clock, never from this body.
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
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
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
 * The stored registration, the one a replayed key wrote first; its confirmation mail is owed in the same write.
 */
export interface FLPostRegistrierungResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
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
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
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
  confirmation: FLSchiedsrichterMint;
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
  notify: boolean;
}

/**
 * Answers the bound as well as the id: the mail telling the person names the season, and a second read would race the lapse.
 */
export interface FLPostSperrlisteResponse {
  /**
   * @minLength 4
   * @maxLength 4
   */
  barred_until_saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
}

export interface FLPostSpielortPayload {
  address: FLAddressPayload;
  /** @minimum 0 */
  default_mietpreis: number;
  /**
   * @minLength 1
   * @maxLength 120
   */
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

/**
 * The sign-in addresses a pass of the account sweep asks about.
 */
export interface FLReferencesPayload {
  /**
   * @minItems 1
   * @maxItems 250
   */
  identifiers: string[];
}

/**
 * Which of them nothing references, and nothing of the records that reference the others.
 */
export interface FLReferencesResponse {
  unreferenced: string[];
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
 * A decision as the list serves it: the stored one, its decider withheld where the ban list holds that address.
 */
export interface FLRegistrierungDecisionRow {
  by_barred: boolean;
  grund: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  made_at: string;
  von: string | null;
}

/**
 * A pending registration's consent record, each choice and `datum` optional here alone.
 *
 * A returning pupil's page asks no choice.
 */
export interface FLRegistrierungEinwilligung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  confirmed_at: string;
  datum: string | null;
  medien: boolean | null;
  nachweis: FLEinwilligungNachweise;
  text_version: string;
  umfang: FLEinwilligungUmfang | null;
}

/**
 * One pupil's registration for one team's season, as stored, its decision as served.
 *
 * Its pupil fills and withdraws `einwilligung` and fills `geburtsdatum`; a decline writes `status` and `decision`.
 */
export interface FLRegistrierung {
  confirmation: FLConfirmation | null;
  confirmed: boolean;
  decision: FLRegistrierungDecisionRow | null;
  einwilligung: FLRegistrierungEinwilligung | null;
  /** @minLength 1 */
  email: string;
  geburtsdatum: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  invitation_id: string;
  /** @minLength 1 */
  nachname: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  saison_id: string;
  status: FLRegistrierungStatus;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  submitted_at: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * The registration's consent record as it stands after the write, everything the pupil did not move unchanged.
 */
export interface FLRegistrierungAccountEinwilligungResponse {
  einwilligung: FLRegistrierungEinwilligung;
  nachweis_stand: FLEinwilligungStand;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
}

/**
 * The squad entry the admission wrote, and the person it belongs to.
 */
export interface FLRegistrierungAdmissionResponse {
  is_nachnominiert: boolean;
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
export interface FLRegistrierungAdmitPayload {
  spieler_id: string | null;
}

/**
 * One pupil's own answer: their date of birth where the page asks it, and on the new pupil's page the two consents.
 */
export interface FLRegistrierungConfirmationPayload {
  geburtsdatum: string | null;
  medien: boolean | null;
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
  umfang: FLEinwilligungUmfang | null;
}

/**
 * What the pupil just recorded, echoed so the answer panel states it rather than opening the link a second time.
 */
export interface FLRegistrierungConfirmationResponse {
  ergebnis: "confirmed";
  geburtsdatum: string | null;
  medien: boolean | null;
  umfang: FLEinwilligungUmfang | null;
}

export type FLRegistrierungConfirmationViewResponseSeite =
  (typeof FLRegistrierungConfirmationViewResponseSeite)[keyof typeof FLRegistrierungConfirmationViewResponseSeite];

export const FLRegistrierungConfirmationViewResponseSeite = {
  bestaetigung_spieler: "bestaetigung_spieler",
  bestaetigung_spieler_wiederkehrend: "bestaetigung_spieler_wiederkehrend",
} as const;

/**
 * What one confirmation link opens, and no field past the ones declared here.
 */
export interface FLRegistrierungConfirmationViewResponse {
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  minimum_age: number;
  saison_id: string;
  /** @minLength 1 */
  schule: string;
  seite: FLRegistrierungConfirmationViewResponseSeite;
  state: FLConfirmationState;
  /** @minLength 1 */
  team: string;
}

/**
 * Why the team declines, from a closed set or not at all.
 */
export interface FLRegistrierungDeclinePayload {
  grund: "other_person" | null;
}

/**
 * The declined registration, and the first name the seat holder is told the decision by.
 */
export interface FLRegistrierungRefusalResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * One season's pass: the reminders owed and the erasures made, each committed.
 */
export interface FLRegistrierungSweepResponse {
  erased_declined: number;
  erased_unconfirmed: number;
  erased_without_decision: number;
  failed: number;
  redacted_action_log: number;
  reminded: number;
  saison_id: string;
}

/**
 * The pending rows, newest first, and whether that is the whole of them.
 */
export interface FLRegistrierungenListResponse {
  complete: boolean;
  registrierungen: FLRegistrierung[];
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
  ausgetragene_kader_rows: number;
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
  matches_per_spieltag: number;
  phase: FLSaisonPhase;
  /** @minimum 0 */
  spieltage: number;
}

/**
 * What the generator left behind on the season it wrote.
 *
 * Counts rather than a hash: these are the two numbers an admin can compare against the page in
 * front of them, and a hash answers no question anyone standing there is asking.
 */
export interface FLSaisonSpielplan {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  generated_at: string;
  /** @minimum 0 */
  spiele: number;
  /** @minimum 0 */
  spieltage: number;
}

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
  spielplan: FLSaisonSpielplan | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  status: FLSaisonStatus;
  version: number;
}

/**
 * The same season for the admin surfaces, with whether it has started.
 */
export interface FLSaisonAdmin {
  begun: boolean;
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
  spielplan: FLSaisonSpielplan | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  status: FLSaisonStatus;
  version: number;
}

/**
 * A junction row, which has no read model of its own -- so it is echoed as it was written.
 */
export interface FLSaisonSpielerResponse {
  inactive_since: string | null;
  is_nachnominiert: boolean;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  version: number;
}

/**
 * Which of the row's seats the press reached, and the two answers they now all hold.
 */
export interface FLSaisonTeamAccountEinwilligungResponse {
  medien: boolean;
  nachweis_stand: FLEinwilligungStand;
  rollen: FLKontaktRolle[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

export interface FLSaisonTeamAddressChangeDenied {
  ansprechperson: FLAddressChangeViewableDenied | null;
  stellvertretung: FLAddressChangeViewableDenied | null;
  trainer: FLAddressChangeViewableDenied | null;
}

/**
 * The live change of each confirmed seat's address, which the address tool shows.
 *
 * Null where none stands, the seat is empty, or its person never confirmed it, the change moving nothing of theirs.
 */
export interface FLSaisonTeamAddressChange {
  ansprechperson: string | null;
  stellvertretung: string | null;
  trainer: string | null;
  viewable_denied: FLSaisonTeamAddressChangeDenied;
}

/**
 * One seat's link as the contacts editor reads it: the stored link and whether it has lapsed.
 */
export interface FLSaisonTeamConfirmationView {
  declined_at: string | null;
  delivery: FLOutboxState | null;
  expired: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  sent_at: string;
}

export interface FLSaisonTeamConfirmationsView {
  ansprechperson: FLSaisonTeamConfirmationView | null;
  stellvertretung: FLSaisonTeamConfirmationView | null;
  trainer: FLSaisonTeamConfirmationView | null;
}

/**
 * What an answer on a season row's link did; nobody is told, so nothing composes a message.
 */
export interface FLSaisonTeamEinwilligungAntwortResponse {
  ergebnis: FLEinwilligungErgebnis;
  geburtsdatum: string | null;
  medien: boolean;
  quelle: "saison";
  whatsapp: boolean;
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

export interface FLSaisonsAdminListResponse {
  format: "list";
  saisons: FLSaisonAdmin[];
}

export interface FLSaisonsListResponse {
  format: "list";
  saisons: FLSaison[];
}

export interface FLSaisonsSingleResponse {
  format: "single";
  saison: FLSaison;
}

export interface FLSchiedsrichter {
  confirmation: FLConfirmation | null;
  /** @minimum 0 */
  default_payment: number;
  einwilligung: FLEinwilligung | null;
  geburtsdatum: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  kontakt: FLKontakt;
  name: string | null;
  schule: string | null;
  version: number;
}

/**
 * The record as it stands after the write, everything the person did not move unchanged.
 */
export interface FLSchiedsrichterAccountEinwilligungResponse {
  einwilligung: FLEinwilligung;
  nachweis_stand: FLEinwilligungStand;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

export interface FLSchiedsrichterConfirmationPayload {
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
export interface FLSchiedsrichterConfirmationResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  confirmed_at: string;
  medien: boolean;
  umfang: FLEinwilligungUmfang;
}

/**
 * What one confirmation link opens, and nothing a leaked one should not learn (`READ-REFEREE-002`).
 *
 * Never a name, the school, the contact details, the fee, the birthdate or the id.
 */
export interface FLSchiedsrichterConfirmationViewResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @exclusiveMinimum 0 */
  medien_minimum_age: number;
  minimum_age: number;
  state: FLConfirmationState;
}

export interface FLSchiedsrichterListResponse {
  schiedsrichter: FLSchiedsrichter[];
}

/**
 * The re-send's answer. Never null: where no link may be minted a refusal answers instead.
 */
export interface FLSchiedsrichterMintResponse {
  confirmation: FLSchiedsrichterMint;
}

/**
 * The reactivation's answer: its own rather than the retire's, being the one of the pair that can mint.
 */
export interface FLSchiedsrichterReactivateResponse {
  confirmation: FLSchiedsrichterMint | null;
}

/**
 * One referee record's stored data as its own person reads it: contact details and fee, never the link's bookkeeping.
 *
 * For `app/api/spieler/schemas.py :: FLSpielerSelf`'s reason, the account page's entry extends it.
 */
export interface FLSchiedsrichterSelf {
  geburtsdatum: string | null;
  honorar: number;
  kontakt: FLKontakt;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
  schule: string | null;
}

/**
 * Every confirmed referee record the signed-in address holds, the ghost never among them.
 */
export interface FLSchiedsrichterSelfResponse {
  schiedsrichter: FLSchiedsrichterSelf[];
}

export interface FLSchiedsrichterSingleResponse {
  address_change_id: string | null;
  address_change_viewable_denied: FLAddressChangeViewableDenied | null;
  confirmation_expired: boolean;
  delivery: FLOutboxState | null;
  schiedsrichter: FLSchiedsrichter;
}

/**
 * A seat holder's own two choices for every seat they hold on one row.
 *
 * Both choices on every press: a page that sent one alone would leave the other judged by nothing.
 */
export interface FLSeatEinwilligungPayload {
  medien: boolean;
  nachweis_stand: FLEinwilligungStandPayload;
  /**
   * @minLength 1
   * @maxLength 64
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  text_version: string;
  umfang: FLKontaktKenntnisnahmeUmfang;
}

/**
 * The sign-in gate's whole answer: the records' two flags, the ban and the grant, and no record itself.
 *
 * The ban narrows neither flag: whether a barred person signs in is the gate's to decide.
 */
export interface FLSignInResponse {
  account: boolean;
  barred: boolean;
  unconfirmed: boolean;
  verwaltung: FLVerwaltung | null;
}

/**
 * The envelope alone: the log row it filed names no address to answer with.
 */
export interface FLSignOutResponse {
  [key: string]: unknown;
}

export type FLSortOrder = (typeof FLSortOrder)[keyof typeof FLSortOrder];

export const FLSortOrder = {
  asc: "asc",
  desc: "desc",
} as const;

/**
 * One ban as the list serves it: the stored row, its author withheld where the ban list holds that address too.
 */
export interface FLSperrlisteRow {
  /**
   * @minLength 4
   * @maxLength 4
   */
  barred_until_saison_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  created_at: string;
  created_by: string | null;
  created_by_barred: boolean;
  /** @minLength 1 */
  grund: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * The bans, newest first, and how many there are.
 *
 * `count_total` is what makes a ban past the cap liftable: one enforced and not rendered is a
 * person barred by a row nobody can reach.
 */
export interface FLSperrlisteListResponse {
  /** @minimum 0 */
  count_total: number;
  sperrliste: FLSperrlisteRow[];
}

/**
 * The removal is hard, so the id is all there is to answer with: no document survives to echo.
 */
export interface FLSperrlisteWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  sperrliste_id: string;
}

/**
 * The venue as the public reads serve it: which ground, and where to find it, without the rent.
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
 * The referee as the public reads serve it: a forename and a surname initial where they consented, else no name.
 *
 * Neither the payment nor the referee's id is served.
 */
export interface FLSpielSchiedsrichterFieldPublic {
  name: string | null;
  name_is_public: boolean;
}

/**
 * One side as a read serves it, with the way its club left the season, null while it has not.
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
 * One fixture as the public reads serve it, each side with its club's standing in the season.
 *
 * The referee is served only once they accepted the fixture as it stands.
 */
export interface FLSpielJoined {
  ansetzung_confirmed: boolean | null;
  datum: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  notiz: string | null;
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
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelle | null;
  uhrzeit: string | null;
}

/**
 * The venue as stored and as the admin reads serve it, the rent included.
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
 * The referee as stored and as the admin reads serve it: the whole name and the payment.
 */
export interface FLSpielSchiedsrichterField {
  name: string | null;
  /** @minimum 0 */
  payment: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * The same fixture for the admin reads: the referee as booked, whole name and payment, and the venue's rent.
 *
 * `version` counts the fixture's writes; a save sending it back is refused once another write has raised it.
 */
export interface FLSpielJoinedAdmin {
  ansetzung_confirmed: boolean | null;
  datum: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  notiz: string | null;
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
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelle | null;
  uhrzeit: string | null;
  version: number;
}

export type FLSpielStatus = (typeof FLSpielStatus)[keyof typeof FLSpielStatus];

export const FLSpielStatus = {
  from_today: "from_today",
  past: "past",
  today: "today",
  abgesagt: "abgesagt",
  unknown: "unknown",
} as const;

export type FLVonAdminArt = (typeof FLVonAdminArt)[keyof typeof FLVonAdminArt];

export const FLVonAdminArt = {
  admin: "admin",
} as const;

/**
 * An administrator's act, naming nobody: the record keeps how a thing was settled, not who typed it.
 */
export interface FLVonAdmin {
  art: FLVonAdminArt;
}

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

/**
 * One card as stored, its reason null on a red card and on every card once the end of the season after the match strips the reasons.
 */
export interface FLSpielberichtKarte {
  farbe: FLKartenFarbe;
  grund: FLKartenGrund | null;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  seite: FLSpielSeite;
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

export interface FLSpielberichtVonSchiedsrichter {
  art: "schiedsrichter";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one.
 */
export interface FLSpielberichtTorschuetze {
  eigentor: boolean;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  seite: FLSpielSeite;
  spieler_id: string | null;
}

/**
 * The referee's account of one match, one proposal, a correction after its adoption reading `differing`.
 *
 * `version` rises with each write of the content and the adoption records the one it took: adopted means equal, never
 * a clock.
 */
export interface FLSpielberichtBericht {
  adopted_at: string | null;
  adopted_by: FLVonAdmin | null;
  adopted_version: number | null;
  bemerkungen: string | null;
  changed_at: string;
  ergebnis_vorschlag: FLSpielberichtVorschlag;
  karten: FLSpielberichtKarte[];
  seiten: FLSpielberichtSeiten;
  submitted_at: string;
  submitted_by: FLSpielberichtVonSchiedsrichter | FLVonAdmin;
  torschuetzen: FLSpielberichtTorschuetze[];
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

export type FLSpielberichtState = (typeof FLSpielberichtState)[keyof typeof FLSpielberichtState];

export const FLSpielberichtState = {
  vorgeschlagen: "vorgeschlagen",
  adopted: "adopted",
  differing: "differing",
  abgesagt: "abgesagt",
  teams_changed: "teams_changed",
} as const;

/**
 * The administrator's panel, with the state the report reads in, null exactly where no block stands.
 *
 * Both squads empty unless the read asks `kader`, the correction's form; a write answers them always.
 */
export interface FLSpielberichtAdminResponse {
  bericht: FLSpielberichtBericht | null;
  kader: FLSpielberichtKader;
  named: FLSpielberichtSpieler[];
  seiten_changed: FLSpielSeite[];
  spiel: FLSpielberichtSpiel;
  state: FLSpielberichtState | null;
  version: number | null;
}

/**
 * One card as a write sends it: a caution names its reason unless the stored card's reason was stripped.
 */
export interface FLSpielberichtKartePayload {
  farbe: FLKartenFarbe;
  grund: FLKartenGrund | null;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  seite: FLSpielSeite;
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
  version?: number | null;
}

/**
 * One reported fixture of an ended season, its date null where it was cleared after the report: the report still stands.
 */
export interface FLSpielberichtPersonEarlierEntry {
  datum: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  submitted_at: string | null;
  team1_name: string | null;
  team2_name: string | null;
  uhrzeit: string | null;
}

/**
 * One played fixture booked to the signed-in referee, and when its report, whoever wrote it, was first sent.
 */
export interface FLSpielberichtPersonEntry {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  submitted_at: string | null;
  team1_name: string | null;
  team2_name: string | null;
  uhrzeit: string | null;
}

/**
 * The booked referee's form: the remarks and the card reasons included, and no `state`.
 */
export interface FLSpielberichtSchiedsrichterResponse {
  bericht: FLSpielberichtBericht | null;
  completed: boolean;
  kader: FLSpielberichtKader;
  named: FLSpielberichtSpieler[];
  seiten_changed: FLSpielSeite[];
  spiel: FLSpielberichtSpiel;
  version: number | null;
}

/**
 * One fixture's report as the triage reads it: its state and what it proposes.
 */
export interface FLSpielberichtStateEntry {
  ergebnis_vorschlag: FLSpielberichtVorschlag;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  state: FLSpielberichtState;
}

/**
 * Every report of one season that holds a block, each with its state.
 */
export interface FLSpielberichteSaisonResponse {
  spielberichte: FLSpielberichtStateEntry[];
}

/**
 * `spiele` of the running season, which the referee reports on; `earlier` of ended ones, each holding a report they only read.
 */
export interface FLSpielberichteSelfResponse {
  earlier: FLSpielberichtPersonEarlierEntry[];
  spiele: FLSpielberichtPersonEntry[];
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
  declined: "declined",
} as const;

export type FLSpielbestaetigungVonKontaktArt = (typeof FLSpielbestaetigungVonKontaktArt)[keyof typeof FLSpielbestaetigungVonKontaktArt];

export const FLSpielbestaetigungVonKontaktArt = {
  kontakt: "kontakt",
} as const;

/**
 * The seat whose link was pressed, never the person: two seats one person holds share a link, and the first seat in order is recorded.
 */
export interface FLSpielbestaetigungVonKontakt {
  art: FLSpielbestaetigungVonKontaktArt;
  rolle: FLKontaktRolle;
}

export type FLSpielbestaetigungVonSchiedsrichterArt =
  (typeof FLSpielbestaetigungVonSchiedsrichterArt)[keyof typeof FLSpielbestaetigungVonSchiedsrichterArt];

export const FLSpielbestaetigungVonSchiedsrichterArt = {
  schiedsrichter: "schiedsrichter",
} as const;

export interface FLSpielbestaetigungVonSchiedsrichter {
  art: FLSpielbestaetigungVonSchiedsrichterArt;
}

export type FLSpielbestaetigungVon = FLSpielbestaetigungVonKontakt | FLVonAdmin | FLSpielbestaetigungVonSchiedsrichter;

/**
 * A date and time without a ground: a team's proposal, and the slot a moved fixture left.
 */
export interface FLSpielbestaetigungAppointment {
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
  von: FLSpielbestaetigungVon;
  vorschlag: FLSpielbestaetigungAppointment | null;
}

export type FLSpielbestaetigungClosedGrund = (typeof FLSpielbestaetigungClosedGrund)[keyof typeof FLSpielbestaetigungClosedGrund];

export const FLSpielbestaetigungClosedGrund = {
  ansetzung_changed: "ansetzung_changed",
  austritt: "austritt",
  spiel_decided: "spiel_decided",
  abgesagt: "abgesagt",
  schiedsrichter_switched: "schiedsrichter_switched",
  schiedsrichter_declined: "schiedsrichter_declined",
  discarded: "discarded",
  spiel_past: "spiel_past",
} as const;

export interface FLSpielbestaetigungClosed {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  am: string;
  grund: FLSpielbestaetigungClosedGrund;
}

/**
 * One seat's link as an administrator reads it -- and NO `token_hashes`, nor the address it was owed to.
 *
 * The hashes are raw document keys the token filter alone reads; a model declaring them would serve
 * every live link's hash through the admin read.
 */
export interface FLSpielbestaetigungSeat {
  delivery: FLOutboxState | null;
}

/**
 * The three seats, mirroring `kontakte`'s slots. Null per SEAT: an empty, barred or voided seat holds no link.
 */
export interface FLSpielbestaetigungKontakte {
  ansprechperson: FLSpielbestaetigungSeat | null;
  stellvertretung: FLSpielbestaetigungSeat | null;
  trainer: FLSpielbestaetigungSeat | null;
}

export interface FLSpielbestaetigungPartyTeam {
  art: "team";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLSpielbestaetigungPartySchiedsrichter {
  art: "schiedsrichter";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * One party's confirmation of one Ansetzung, as an administrator reads it.
 *
 * The close reaches an answered row too, so an agreement a move overtook records why it stopped
 * applying (`app/api/spielbestaetigungen/services.py :: build_closable_filter`).
 */
export interface FLSpielbestaetigung {
  ansetzung: FLSpielbestaetigungAnsetzung;
  antwort: FLSpielbestaetigungAntwort | null;
  asked_at: string | null;
  closed: FLSpielbestaetigungClosed | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  kontakte: FLSpielbestaetigungKontakte | null;
  party: FLSpielbestaetigungPartyTeam | FLSpielbestaetigungPartySchiedsrichter;
  /** @items.pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  reminded_at: string[];
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
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
  answered_by: FLSpielbestaetigungVon;
  state: FLSpielbestaetigungAntwortArt;
  vorschlag: FLSpielbestaetigungAppointment | null;
}

/**
 * The administrator's Zusage for a party that answered elsewhere, and how it was given.
 *
 * No way to choose: the one press records a Zusage, and a decline without a proposal would sit in no queue.
 */
export interface FLSpielbestaetigungEnterPayload {
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
  state: FLSpielbestaetigungAntwortArt;
}

export type FLSpielbestaetigungSelfState = (typeof FLSpielbestaetigungSelfState)[keyof typeof FLSpielbestaetigungSelfState];

export const FLSpielbestaetigungSelfState = {
  valid: "valid",
  zugesagt: "zugesagt",
  declined: "declined",
  expired: "expired",
  invalid: "invalid",
  abgesagt: "abgesagt",
} as const;

/**
 * The clubs, the day, the hour and the ground a page or a message states.
 *
 * The fixture as it stands, or on a link whose fixture moved since, the Ansetzung the row asked about.
 */
export interface FLSpielbestaetigungViewAnsetzung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  datum: string;
  spielort: FLSpielOrtFieldPublic | null;
  team1_name: string;
  team2_name: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  uhrzeit: string;
}

/**
 * One of the signed-in referee's rows, as their panel lists it.
 */
export interface FLSpielbestaetigungSelf {
  ansetzung: FLSpielbestaetigungViewAnsetzung;
  begruendung: string | null;
  entered: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  past: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  state: FLSpielbestaetigungSelfState;
}

/**
 * One season's pass, counted: what it closed, the rows it asked or reminded, and the mails it owed the Postausgang.
 */
export interface FLSpielbestaetigungSweepResponse {
  asked: number;
  closed: number;
  failed: number;
  mails: number;
  reminded: number;
  saison_id: string;
}

export type FLSpielbestaetigungViewResponseState =
  (typeof FLSpielbestaetigungViewResponseState)[keyof typeof FLSpielbestaetigungViewResponseState];

export const FLSpielbestaetigungViewResponseState = {
  valid: "valid",
  vorschlag: "vorschlag",
  zugesagt: "zugesagt",
  declined: "declined",
  discarded: "discarded",
  expired: "expired",
  invalid: "invalid",
  abgesagt: "abgesagt",
  barred: "barred",
} as const;

/**
 * What one link's page renders, filled in every state; the frontend narrows a spent one to its `state`.
 */
export interface FLSpielbestaetigungViewResponse {
  ansetzung: FLSpielbestaetigungViewAnsetzung;
  answered_by: FLSpielbestaetigungVon | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  frist: string;
  seite: FLSpielSeite;
  state: FLSpielbestaetigungViewResponseState;
  vorschlag: FLSpielbestaetigungAppointment | null;
}

/**
 * The rows newest first, closed ones included.
 */
export interface FLSpielbestaetigungenListResponse {
  complete: boolean;
  spielbestaetigungen: FLSpielbestaetigung[];
}

export interface FLSpielbestaetigungenSelfResponse {
  spielbestaetigungen: FLSpielbestaetigungSelf[];
}

/**
 * The matches needing attention, why the bracket ones do, and every report's state.
 *
 * A fault joins its match by `spiel_id`, never `spiel_nr`, unique within one season only; `spiele` carries every
 * match a fault or an open report names.
 */
export interface FLSpieleActionRequiredResponse {
  bracket_faults: FLBracketFault[];
  spielberichte: FLSpielberichtStateEntry[];
  spiele: FLSpielJoinedAdmin[];
}

/**
 * The admin surfaces' fixture list, each referee's whole name and the money included.
 */
export interface FLSpieleAdminListResponse {
  spiele: FLSpielJoinedAdmin[];
}

/**
 * One fixture for the admin editor, money included.
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
 * The record as it stands after the write, everything the person did not move unchanged.
 */
export interface FLSpielerAccountEinwilligungResponse {
  einwilligung: FLEinwilligung;
  nachweis_stand: FLEinwilligungStand;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
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
  version: number;
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
  nummer: string | null;
  position: FLSpielerPosition | null;
  vorname: string | null;
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
  is_nachnominiert: boolean;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  saison_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  version: number;
}

/**
 * Whether an entry into this season's squads today would be marked a Nachnominierung.
 */
export interface FLSpielerNachnominierungResponse {
  nachnominierung: boolean;
  saison_id: string;
}

/**
 * The person as stored, plus every squad row they hold.
 *
 * A DIFFERENT question from `FLSpieler`, not a projection: that one is FLATTENED against one
 * season, so a player in two comes back as two indistinguishable rows.
 */
export interface FLSpielerWithMemberships {
  address_change_id: string | null;
  address_change_viewable_denied: FLAddressChangeViewableDenied | null;
  einwilligung: FLEinwilligung;
  email: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  memberships: FLSpielerMembership[];
  nachname: string | null;
  version: number;
  /** @minLength 1 */
  vorname: string;
}

/**
 * Every player, retired ones included, each with their squad rows. Sorted by name.
 */
export interface FLSpielerSaisonsResponse {
  spieler: FLSpielerWithMemberships[];
}

/**
 * One pupil record's stored data as its own person reads it: the whole surname and the birthdate, never masked.
 *
 * Its consent is the account page's, whose entry extends this (`app/api/konto/schemas.py :: FLAccountSpielerEinwilligung`).
 */
export interface FLSpielerSelf {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  geburtsdatum: string;
  kader: FLSpielerSelfKaderRow[];
  nachname: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  /** @minLength 1 */
  vorname: string;
}

/**
 * The signed-in address's own pupil record: one at most, `spieler.email` being unique.
 */
export interface FLSpielerSelfResponse {
  spieler: FLSpielerSelf;
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
  version: number;
}

export interface FLSpielorteListResponse {
  spielorte: FLSpielort[];
}

export interface FLSpielorteSingleResponse {
  spielort: FLSpielort;
}

export interface FLSpieltag {
  beginn: string | null;
  /** @minimum 0 */
  count_spiele: number;
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
  version: number;
}

export interface FLSpieltagWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
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
export interface FLSubjectPayload {
  /** @maxLength 254 */
  email: string;
}

/**
 * One referee record the mailbox names, carrying the id alone for `FLSubjectSpieler`'s reason.
 */
export interface FLSubjectSchiedsrichter {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * One contact seat the mailbox holds on a season's junction row.
 *
 * Per seat and never per person, as the erasure's `FLAccountErasureSeat` is: one row seats one
 * person twice where `trainer_is_also` says so.
 */
export interface FLSubjectSeat {
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
export interface FLSubjectSpieler {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

/**
 * Which confirmed, live records one mailbox matches, and whether the address is on the ban list.
 *
 * The ban narrows none of the records: whether a barred person signs in is the sign-in gate's to decide.
 */
export interface FLSubjectResponse {
  barred: boolean;
  granted_since: string | null;
  inhaber_seit: string | null;
  schiedsrichter: FLSubjectSchiedsrichter[];
  seats: FLSubjectSeat[];
  spieler: FLSubjectSpieler[];
  unconfirmed: boolean;
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

/**
 * The seasons a system pass visits, for its caller to sweep one by one in the order given.
 */
export interface FLSweepSaisonsResponse {
  saison_ids: string[];
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
  address_change: FLSaisonTeamAddressChange | null;
  austritt: FLAustritt | null;
  confirmations: FLSaisonTeamConfirmationsView | null;
  gruppe: FLGruppenNames;
  kontakte: FLSaisonTeamKontakte | null;
  /** The token a save against this contact block has to echo back. */
  readonly kontakte_stand: string;
  saison_id: string;
  trikot_farbe: FLTrikotFarbe | null;
  version: number;
}

/**
 * One seat as the people beside it see it: who holds it and whether they answered their link.
 *
 * No address, telephone number or birthdate: the contact page promises that only administrators
 * see those (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`).
 */
export interface FLTeamSeat {
  confirmed: boolean;
  name: string | null;
  rolle: FLKontaktRolle;
}

/**
 * A team's three seats in one season, in the order `KONTAKT_ROLLEN` names them.
 */
export interface FLTeamSeatsResponse {
  saison_id: string;
  seats: FLTeamSeat[];
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
  version: number;
  website_url: string | null;
}

/**
 * The season's groups in standing order, and how many of each advance.
 *
 * `qualifiers_per_gruppe` rides along rather than being fetched separately, so a page cannot mark a
 * cutoff drawn from a different season than the table it marks.
 */
export interface FLTeamsGroupedResponse {
  format: "grouped";
  gruppen: FLGruppen;
  /** @exclusiveMinimum 0 */
  qualifiers_per_gruppe: number;
}

export interface FLTeamsListResponse {
  format: "list";
  teams: FLTeam[];
}

/**
 * Every club, retired ones included, each with its memberships. Sorted by name.
 */
export interface FLTeamsSaisonsResponse {
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
 * Internal Server Error
 */
export type N500Response = FLFailureBody;

/**
 * Service Unavailable
 */
export type N503Response = FLFailureBody;

export type ActionLogGetActionLogParams = {
  collection?: string[] | null;
  operation?: FLActionLogEntryOperation[] | null;
  herkunft?: FLActionLogEntryHerkunft[] | null;
  trace_id?: string | null;
  document_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  order?: FLSortOrder;
};

export type AddressChangeSweepAddressChangeParams = {
  nach?: string | null;
};

export type BewerbungenGetBewerbungenParams = {
  saison_id?: string | null;
  saison_reference?: FLBewerbungSaisonReference[] | null;
  status?: FLBewerbungStatus[] | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: "submitted_at";
  order?: FLSortOrder;
};

export type IdentitySweepErasureParams = {
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
  sort_by?: "submitted_at";
  order?: FLSortOrder;
};

export type RegistrierungenGetOpenRegistrierungenParams = {
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  order?: FLSortOrder;
};

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

export type SaisonsGetSaisonsVerwaltungParams = {
  status?: FLSaisonStatus | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SaisonsGetSaisonsVerwaltungSortBy;
  order?: SaisonsGetSaisonsVerwaltungOrder;
};

export type SaisonsGetSaisonsVerwaltungSortBy = (typeof SaisonsGetSaisonsVerwaltungSortBy)[keyof typeof SaisonsGetSaisonsVerwaltungSortBy];

export const SaisonsGetSaisonsVerwaltungSortBy = {
  _id: "_id",
  start_date: "start_date",
  end_date: "end_date",
} as const;

export type SaisonsGetSaisonsVerwaltungOrder = (typeof SaisonsGetSaisonsVerwaltungOrder)[keyof typeof SaisonsGetSaisonsVerwaltungOrder];

export const SaisonsGetSaisonsVerwaltungOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SaisonsGetInvitationsDispatchPreviewParams = {
  resend?: boolean;
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

export type SpielberichteGetSpielberichtVerwaltungParams = {
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
  spiel_status?: FLSpielStatus | null;
  team_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieleGetSpieleSortBy;
  order?: SpieleGetSpieleOrder;
};

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

export type SpieleGetSpieleVerwaltungParams = {
  saison_id?: string | null;
  saison_phase?: "playoffs" | FLSaisonPhase | null;
  spiel_status?: FLSpielStatus | null;
  team_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieleGetSpieleVerwaltungSortBy;
  order?: SpieleGetSpieleVerwaltungOrder;
};

export type SpieleGetSpieleVerwaltungSortBy = (typeof SpieleGetSpieleVerwaltungSortBy)[keyof typeof SpieleGetSpieleVerwaltungSortBy];

export const SpieleGetSpieleVerwaltungSortBy = {
  datum: "datum",
  uhrzeit: "uhrzeit",
  spiel_nr: "spiel_nr",
  saison_phase: "saison_phase",
} as const;

export type SpieleGetSpieleVerwaltungOrder = (typeof SpieleGetSpieleVerwaltungOrder)[keyof typeof SpieleGetSpieleVerwaltungOrder];

export const SpieleGetSpieleVerwaltungOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type SpielePatchSpielParams = {
  /**
   * The `version` of the fixture's Spielbericht the editor was seeded from, to stamp it adopted
   */
  adopts_bericht?: number | null;
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

export type SpieltageGetSpieltageVerwaltungParams = {
  saison_id?: string | null;
  saison_phase?: "playoffs" | FLSaisonPhase | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieltageGetSpieltageVerwaltungSortBy;
  order?: SpieltageGetSpieltageVerwaltungOrder;
};

export type SpieltageGetSpieltageVerwaltungSortBy =
  (typeof SpieltageGetSpieltageVerwaltungSortBy)[keyof typeof SpieltageGetSpieltageVerwaltungSortBy];

export const SpieltageGetSpieltageVerwaltungSortBy = {
  natural: "natural",
  beginn: "beginn",
  ende: "ende",
} as const;

export type SpieltageGetSpieltageVerwaltungOrder =
  (typeof SpieltageGetSpieltageVerwaltungOrder)[keyof typeof SpieltageGetSpieltageVerwaltungOrder];

export const SpieltageGetSpieltageVerwaltungOrder = {
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
  total: "total",
} as const;

export type TeamsGetTeamsOrder = (typeof TeamsGetTeamsOrder)[keyof typeof TeamsGetTeamsOrder];

export const TeamsGetTeamsOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type TeamsGetTeamsVerwaltungParams = {
  saison_id?: string | null;
  gruppe?: FLGruppenNames | null;
  has_austritt?: boolean | null;
  austritt_type?: FLAustrittType | null;
  in_gruppen?: boolean | null;
  statistik_scope?: TeamsGetTeamsVerwaltungStatistikScope;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: "name";
  order?: TeamsGetTeamsVerwaltungOrder;
  include_inactive?: boolean;
};

export type TeamsGetTeamsVerwaltungStatistikScope =
  (typeof TeamsGetTeamsVerwaltungStatistikScope)[keyof typeof TeamsGetTeamsVerwaltungStatistikScope];

export const TeamsGetTeamsVerwaltungStatistikScope = {
  gruppenphase: "gruppenphase",
  total: "total",
} as const;

export type TeamsGetTeamsVerwaltungOrder = (typeof TeamsGetTeamsVerwaltungOrder)[keyof typeof TeamsGetTeamsVerwaltungOrder];

export const TeamsGetTeamsVerwaltungOrder = {
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
  total: "total",
} as const;
