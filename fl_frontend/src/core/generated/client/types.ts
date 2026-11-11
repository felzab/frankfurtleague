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
  create_saison_future_stands: "create_saison_future_stands",
  saison_past: "saison_past",
  activate_target_undrawn: "activate_target_undrawn",
  activate_spieltage_undated: "activate_spieltage_undated",
  link_invalid: "link_invalid",
  address_change_ended: "address_change_ended",
  link_expired: "link_expired",
  address_change_taken: "address_change_taken",
  address_change_new_taken: "address_change_new_taken",
  address_change_unchanged: "address_change_unchanged",
  address_change_started_recently: "address_change_started_recently",
  address_change_nothing: "address_change_nothing",
  address_change_new_granted: "address_change_new_granted",
  address_change_occupied: "address_change_occupied",
  ansetzung_answered: "ansetzung_answered",
  ansetzung_deadline_past: "ansetzung_deadline_past",
  ansetzung_changed: "ansetzung_changed",
  ansetzung_decided: "ansetzung_decided",
  ansetzung_vorschlag_past: "ansetzung_vorschlag_past",
  ansetzung_vorschlag_past_as_stored: "ansetzung_vorschlag_past_as_stored",
  ansetzung_vorschlag_unchanged: "ansetzung_vorschlag_unchanged",
  ansetzung_closed: "ansetzung_closed",
  ansetzung_not_enterable: "ansetzung_not_enterable",
  ansetzung_not_discardable: "ansetzung_not_discardable",
  ansetzung_not_adoptable: "ansetzung_not_adoptable",
  ansetzung_foreign_row: "ansetzung_foreign_row",
  access_key_refused: "access_key_refused",
  missing_actor: "missing_actor",
  actor_not_admin: "actor_not_admin",
  session_refused: "session_refused",
  grant_exists: "grant_exists",
  grant_owner: "grant_owner",
  grant_barred: "grant_barred",
  grant_only_owner: "grant_only_owner",
  grant_handover_waiting: "grant_handover_waiting",
  grant_not_in_effect: "grant_not_in_effect",
  bericht_not_played: "bericht_not_played",
  bericht_not_officiated: "bericht_not_officiated",
  bericht_cancelled: "bericht_cancelled",
  bericht_elfmeter_in_the_gruppe: "bericht_elfmeter_in_the_gruppe",
  aufstellung_locked: "aufstellung_locked",
  aufstellung_spiel_undated: "aufstellung_spiel_undated",
  aufstellung_nominee_without_shortage: "aufstellung_nominee_without_shortage",
  aufstellung_starters_exceed_eleven: "aufstellung_starters_exceed_eleven",
  bewerbung_already_decided: "bewerbung_already_decided",
  bewerbung_subject_unresolved: "bewerbung_subject_unresolved",
  bewerbung_schule_unusable: "bewerbung_schule_unusable",
  bewerbung_window_closed: "bewerbung_window_closed",
  bewerbung_submission_subject_unresolved: "bewerbung_submission_subject_unresolved",
  bewerbung_picked_team_unusable: "bewerbung_picked_team_unusable",
  bewerbung_picked_team_already_entered: "bewerbung_picked_team_already_entered",
  bewerbung_seat_already_answered: "bewerbung_seat_already_answered",
  confirmation_age: "confirmation_age",
  bewerbung_kontakte_unconfirmed: "bewerbung_kontakte_unconfirmed",
  bewerbung_kontakt_email_taken: "bewerbung_kontakt_email_taken",
  bewerbung_kontakt_phone_taken: "bewerbung_kontakt_phone_taken",
  bewerbung_kontakt_repeated: "bewerbung_kontakt_repeated",
  trikot_farbe_taken: "trikot_farbe_taken",
  booking_unknown_resource: "booking_unknown_resource",
  booking_unconfirmed_schiedsrichter: "booking_unconfirmed_schiedsrichter",
  spiel_double_booked: "spiel_double_booked",
  spiel_double_booked_spielort_as_stored: "spiel_double_booked_spielort_as_stored",
  spiel_double_booked_schiedsrichter_as_stored: "spiel_double_booked_schiedsrichter_as_stored",
  spiel_outside_spieltag: "spiel_outside_spieltag",
  spieltag_outside_saison: "spieltag_outside_saison",
  spieltag_span_below_spiele: "spieltag_span_below_spiele",
  saison_span_below_spieltage: "saison_span_below_spieltage",
  saison_span_below_spielplan: "saison_span_below_spielplan",
  spieltag_start_out_of_order: "spieltag_start_out_of_order",
  saison_span_below_spielplan_as_stored: "saison_span_below_spielplan_as_stored",
  saison_start_taken_place: "saison_start_taken_place",
  saison_start_austritt_stored: "saison_start_austritt_stored",
  invitation_team_not_entered: "invitation_team_not_entered",
  choices_stale: "choices_stale",
  grant_wording_stale: "grant_wording_stale",
  media_age: "media_age",
  giving_not_allowed: "giving_not_allowed",
  eligibility_disqualified: "eligibility_disqualified",
  eligibility_disqualified_team1_as_stored: "eligibility_disqualified_team1_as_stored",
  eligibility_disqualified_team2_as_stored: "eligibility_disqualified_team2_as_stored",
  eligibility_team_not_in_saison: "eligibility_team_not_in_saison",
  entry_saison_not_future: "entry_saison_not_future",
  entry_gruppe_not_offered: "entry_gruppe_not_offered",
  entry_gruppe_full: "entry_gruppe_full",
  entry_gruppe_locked: "entry_gruppe_locked",
  team_retired: "team_retired",
  role_not_held: "role_not_held",
  kontakt_seat_without_confirmation: "kontakt_seat_without_confirmation",
  kontakt_email_taken: "kontakt_email_taken",
  kontakt_phone_taken: "kontakt_phone_taken",
  kontakt_row_without_saison: "kontakt_row_without_saison",
  kontakt_saison_past: "kontakt_saison_past",
  own_address: "own_address",
  owner_erasure: "owner_erasure",
  admin_address: "admin_address",
  foreign_address_change: "foreign_address_change",
  no_owner: "no_owner",
  registrierung_closed: "registrierung_closed",
  registrierung_stufe_not_allowed: "registrierung_stufe_not_allowed",
  confirmation_exists: "confirmation_exists",
  registrierung_kader_full: "registrierung_kader_full",
  registrierung_unconfirmed: "registrierung_unconfirmed",
  registrierung_person_not_named: "registrierung_person_not_named",
  registrierung_already_in_kader: "registrierung_already_in_kader",
  replace_saison_started: "replace_saison_started",
  replace_incoming_already_entered: "replace_incoming_already_entered",
  replace_one_team_on_both_ends: "replace_one_team_on_both_ends",
  replace_sides_taken_place: "replace_sides_taken_place",
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
  rules_niederlage_outvalues_unentschieden: "rules_niederlage_outvalues_unentschieden",
  rules_kader_below_use: "rules_kader_below_use",
  rules_forfeit_unentschieden_in_a_knockout: "rules_forfeit_unentschieden_in_a_knockout",
  rules_shape_after_spielplan: "rules_shape_after_spielplan",
  rules_spiele_over_one_read: "rules_spiele_over_one_read",
  rules_forfeit_unentschieden_in_a_knockout_as_stored: "rules_forfeit_unentschieden_in_a_knockout_as_stored",
  schiedsrichter_retired: "schiedsrichter_retired",
  schiedsrichter_no_address: "schiedsrichter_no_address",
  schiedsrichter_address_only_per_change: "schiedsrichter_address_only_per_change",
  ban_list_no_saison: "ban_list_no_saison",
  ban_list_admin: "ban_list_admin",
  spielplan_already_drawn: "spielplan_already_drawn",
  spielplan_spieltage_held: "spielplan_spieltage_held",
  spielplan_gruppen_off_rules: "spielplan_gruppen_off_rules",
  spielplan_replace_outside_its_window: "spielplan_replace_outside_its_window",
  spielplan_undraw_outside_its_window: "spielplan_undraw_outside_its_window",
  spielplan_berichte_submitted: "spielplan_berichte_submitted",
  spieltag_occupied: "spieltag_occupied",
  spieltag_occupied_by_the_resolution: "spieltag_occupied_by_the_resolution",
  voided_results_stale: "voided_results_stale",
  kader_team_not_in_saison: "kader_team_not_in_saison",
  kader_full: "kader_full",
  kader_rolle_taken: "kader_rolle_taken",
  kader_stufe_not_allowed: "kader_stufe_not_allowed",
  spieler_not_in_kader: "spieler_not_in_kader",
  state_ergebnis_on_a_non_event: "state_ergebnis_on_a_non_event",
  state_nichtantreten_without_two_sides: "state_nichtantreten_without_two_sides",
  swap_not_a_swap: "swap_not_a_swap",
  swap_saison_started: "swap_saison_started",
  swap_sides_taken_place: "swap_sides_taken_place",
  austritt_before_saison_start: "austritt_before_saison_start",
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
  shorthand: string | null;
  trikot_farbe: FLTrikotFarbe | null;
  /** @minimum 0 */
  version: number;
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
 * The change a start wrote: no link is answered, the one owed the address on file waiting in the Postausgang.
 */
export interface FLAccountAddressChangeMintResponse {
  email: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  valid_until: string;
}

export type FLAddressChangeWaitsOn = (typeof FLAddressChangeWaitsOn)[keyof typeof FLAddressChangeWaitsOn];

export const FLAddressChangeWaitsOn = {
  previous_address: "previous_address",
  new_address: "new_address",
  waiting_period: "waiting_period",
} as const;

export type FLAddressChangeWay = (typeof FLAddressChangeWay)[keyof typeof FLAddressChangeWay];

export const FLAddressChangeWay = {
  account: "account",
  waiting_period: "waiting_period",
} as const;

/**
 * The address's live change as its own account page reads it.
 */
export interface FLAccountAddressChangeOpen {
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

export type FLAdminTier = (typeof FLAdminTier)[keyof typeof FLAdminTier];

export const FLAdminTier = {
  owner: "owner",
  administration: "administration",
} as const;

/**
 * The change pending on the signed-in address.
 */
export interface FLAccountAddressChangeResponse {
  open: FLAccountAddressChangeOpen | null;
  wait_tier: FLAdminTier | null;
}

/**
 * Each choice's state where the account page was served, null where the record carried no evidence for it.
 *
 * A consent PATCH's precondition, echoed back as served, never a secret.
 */
export interface FLEinwilligungState {
  media: string | null;
  scope: string | null;
}

export type FLKontaktRolle = (typeof FLKontaktRolle)[keyof typeof FLKontaktRolle];

export const FLKontaktRolle = {
  trainer: "trainer",
  ansprechperson: "ansprechperson",
  stellvertretung: "stellvertretung",
} as const;

export type FLKontaktKenntnisnahmeScope = (typeof FLKontaktKenntnisnahmeScope)[keyof typeof FLKontaktKenntnisnahmeScope];

export const FLKontaktKenntnisnahmeScope = {
  kontakt_data: "kontakt_data",
  kontakt_data_whatsapp: "kontakt_data_whatsapp",
} as const;

/**
 * One pending application on which the address holds a confirmed contact seat, with its two choices to withdraw.
 *
 * Pending alone: an accepted application's seats are its season row's, listed under `seats`.
 */
export interface FLAccountBewerbungSeatEinwilligung {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  evidence_state: FLEinwilligungState;
  media: boolean;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  schule: string;
  scope: FLKontaktKenntnisnahmeScope;
}

export type FLEinwilligungScope = (typeof FLEinwilligungScope)[keyof typeof FLEinwilligungScope];

export const FLEinwilligungScope = {
  kader_public: "kader_public",
  internal: "internal",
} as const;

/**
 * A person's own record's two choices as its box shows them.
 *
 * The choices alone: the box names no day and no label, and `evidence_state` stands for each choice's evidence in the
 * precondition a press echoes.
 */
export interface FLAccountEinwilligung {
  media: boolean;
  scope: FLEinwilligungScope;
}

export interface FLEinwilligungStatePayload {
  media: string | null;
  scope: string | null;
}

export type FLCitedMediaTextVersion = "2026-11-medien-1";

export type FLSpielerScopeTextVersion = "2026-11-name-kader-1";

/**
 * A pupil's two wordings: the name on the squad and the media switch.
 */
export interface FLSpielerTextVersions {
  media: FLCitedMediaTextVersion;
  scope: FLSpielerScopeTextVersion;
}

/**
 * A pupil's or a registration's own two choices on their record.
 */
export interface FLAccountEinwilligungPayload {
  evidence_state: FLEinwilligungStatePayload;
  media: boolean;
  scope: FLEinwilligungScope;
  text_versions: FLSpielerTextVersions;
}

/**
 * One pending registration its pupil confirmed: its choices to withdraw, and what it stores.
 */
export interface FLAccountRegistrierungEinwilligung {
  birth_date: string | null;
  evidence_state: FLEinwilligungState;
  first_name: string;
  last_name: string;
  media: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  saison_id: string;
  scope: FLEinwilligungScope;
  team_name: string | null;
}

export interface FLKontakt {
  email: string | null;
  phone: string | null;
}

/**
 * One referee record on the account page: the stored data its box shows, its fee and the consent the page moves.
 */
export interface FLAccountSchiedsrichterEinwilligung {
  birth_date: string | null;
  default_payment: number;
  einwilligung: FLAccountEinwilligung;
  evidence_state: FLEinwilligungState;
  givable: boolean;
  kontakt: FLKontakt;
  media_offered: boolean;
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
  evidence_state: FLEinwilligungState;
  givable: boolean;
  media: boolean;
  media_offered: boolean;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  scope: FLKontaktKenntnisnahmeScope;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
}

/**
 * The pupil's record on the account page: its stored data and the consent the page moves.
 */
export interface FLAccountSpielerEinwilligung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  birth_date: string;
  einwilligung: FLAccountEinwilligung;
  evidence_state: FLEinwilligungState;
  /** @minLength 1 */
  first_name: string;
  last_name: string | null;
  media_offered: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
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
  first_name: string;
  last_name: string;
  rolle: FLKontaktRolle;
  saison_id: string;
}

export const FLAccountErasureDataValue = {
  kind: "account_erasure",
} as const;
export type FLAccountErasureData = typeof FLAccountErasureDataValue;

/**
 * One registration, pending or declined.
 */
export interface FLAccountErasureRegistrierung {
  first_name: string;
  last_name: string;
  saison_id: string;
  team_name: string | null;
}

export interface FLAccountErasureSchiedsrichter {
  name: string | null;
}

/**
 * One seat on a team's season row, named as the row names it.
 */
export interface FLAccountErasureSeat {
  first_name: string;
  last_name: string;
  rolle: FLKontaktRolle;
  saison_id: string;
  team_name: string;
}

export interface FLAccountErasureSpieler {
  first_name: string;
  last_name: string | null;
}

export interface FLAccountErasureViewResponse {
  /** @minimum 0 */
  address_change: number;
  admin_tier: FLAdminTier | null;
  bewerbungen: FLAccountErasureBewerbung[];
  registrierungen: FLAccountErasureRegistrierung[];
  schiedsrichter: FLAccountErasureSchiedsrichter[];
  seats: FLAccountErasureSeat[];
  spieler: FLAccountErasureSpieler[];
}

export type FLAction = (typeof FLAction)[keyof typeof FLAction];

export const FLAction = {
  saisoncreated: "saison.created",
  saisonchanged: "saison.changed",
  saisonactivated: "saison.activated",
  saisongruppen_swapped: "saison.gruppen_swapped",
  saisonspielplan_created: "saison.spielplan_created",
  saisonspielplan_recreated: "saison.spielplan_recreated",
  saisonspielplan_deleted: "saison.spielplan_deleted",
  saisoninvitations_dispatched: "saison.invitations_dispatched",
  spieltagchanged: "spieltag.changed",
  spielchanged: "spiel.changed",
  spielergebnis_changed: "spiel.ergebnis_changed",
  spielbestaetigungentered: "spielbestaetigung.entered",
  spielbestaetigungvorschlag_discarded: "spielbestaetigung.vorschlag_discarded",
  spielbestaetigungvorschlag_adopted: "spielbestaetigung.vorschlag_adopted",
  spielbestaetigunganswered: "spielbestaetigung.answered",
  spielberichtsaved: "spielbericht.saved",
  aufstellungsaved: "aufstellung.saved",
  teamentered: "team.entered",
  teamchanged: "team.changed",
  teamretired: "team.retired",
  teamreactivated: "team.reactivated",
  teamaustritt_entered: "team.austritt_entered",
  teamseat_changed: "team.seat_changed",
  teamreplaced: "team.replaced",
  teaminvitation_created: "team.invitation_created",
  teaminvitation_withdrawn: "team.invitation_withdrawn",
  bewerbungaccepted: "bewerbung.accepted",
  bewerbungdeclined: "bewerbung.declined",
  bewerbungseat_changed: "bewerbung.seat_changed",
  registrierungadmitted: "registrierung.admitted",
  registrierungdeclined: "registrierung.declined",
  spielerchanged: "spieler.changed",
  spielerderegistered: "spieler.deregistered",
  spielerreactivated: "spieler.reactivated",
  schiedsrichtercreated: "schiedsrichter.created",
  schiedsrichterchanged: "schiedsrichter.changed",
  schiedsrichterretired: "schiedsrichter.retired",
  schiedsrichterreactivated: "schiedsrichter.reactivated",
  spielortcreated: "spielort.created",
  spielortchanged: "spielort.changed",
  spielortretired: "spielort.retired",
  spielortreactivated: "spielort.reactivated",
  grantadded: "grant.added",
  grantremoved: "grant.removed",
  grantaddition_withdrawn: "grant.addition_withdrawn",
  granthandover_started: "grant.handover_started",
  granthandover_withdrawn: "grant.handover_withdrawn",
  granthandover_completed: "grant.handover_completed",
  grantaddress_change_started: "grant.address_change_started",
  grantaddress_switched: "grant.address_switched",
  banadded: "ban.added",
  banremoved: "ban.removed",
  address_changestarted: "address_change.started",
  address_changediscarded: "address_change.discarded",
  erasureon_request: "erasure.on_request",
  erasureown: "erasure.own",
  retentionbewerbungen: "retention.bewerbungen",
  retentionkontakte: "retention.kontakte",
  retentionspielbestaetigungen: "retention.spielbestaetigungen",
  retentionspielberichte: "retention.spielberichte",
  retentionregistrierungen: "retention.registrierungen",
  retentionschiedsrichter: "retention.schiedsrichter",
  retentionspieler: "retention.spieler",
  retentionaddress_changes: "retention.address_changes",
  retentionbans: "retention.bans",
} as const;

/**
 * One act as the Protokoll serves it. Its `trace_id` and `record_id` stay in the store.
 */
export interface FLActionLogEntry {
  action: FLAction;
  at: string;
  by: string;
  count: number | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  label: string | null;
  team: string | null;
}

export type FLActionType = (typeof FLActionType)[keyof typeof FLActionType];

export const FLActionType = {
  saison: "saison",
  spieltag: "spieltag",
  spiel: "spiel",
  spielbestaetigung: "spielbestaetigung",
  spielbericht: "spielbericht",
  aufstellung: "aufstellung",
  team: "team",
  bewerbung: "bewerbung",
  registrierung: "registrierung",
  spieler: "spieler",
  schiedsrichter: "schiedsrichter",
  spielort: "spielort",
  grant: "grant",
  ban: "ban",
  address_change: "address_change",
  erasure: "erasure",
  retention: "retention",
} as const;

/**
 * What the Protokoll's read narrows by, in a body: `by` is an address and `q` whatever was typed.
 */
export interface FLActionLogFilterPayload {
  by?: string | null;
  cursor?: string | null;
  from_day?: string | null;
  q?: string | null;
  type?: FLActionType[] | null;
}

export interface FLActionLogListResponse {
  action_log: FLActionLogEntry[];
  by_options: string[];
  cursor: string | null;
}

export type FLActionLogPageSize = 50;

/**
 * How many seasons the activation moved off `active` -- normally exactly one.
 */
export interface FLActivateSaisonResponse {
  deactivated: number;
}

export interface FLAddress {
  /** @minLength 1 */
  city: string;
  district: string;
  /** @pattern ^([0-9\-abcABC]+)?$ */
  house_number: string;
  /** @pattern ^[0-9]{5}$ */
  postcode: string;
  /** @minLength 1 */
  street: string;
}

/**
 * Exactly one key: the new mailbox's link token, or the change a re-send names.
 */
export interface FLAddressChangeAddressPayload {
  address_change_id?: string | null;
  token?: string | null;
}

/**
 * A live change's new address and nothing else, server to server alone.
 */
export interface FLAddressChangeAddressResponse {
  email: string | null;
}

export type FLOutboxDeliveryState = (typeof FLOutboxDeliveryState)[keyof typeof FLOutboxDeliveryState];

export const FLOutboxDeliveryState = {
  delivered: "delivered",
  delayed: "delayed",
  undeliverable: "undeliverable",
  suppressed: "suppressed",
  complaint: "complaint",
} as const;

export interface FLOutboxDelivery {
  at: string;
  reason: string | null;
  state: FLOutboxDeliveryState;
}

export type FLOutboxStatusState = (typeof FLOutboxStatusState)[keyof typeof FLOutboxStatusState];

export const FLOutboxStatusState = {
  open: "open",
  sent: "sent",
  held: "held",
  barred: "barred",
  dropped: "dropped",
  abandoned: "abandoned",
} as const;

/**
 * What became of the last mail owed about one record and seat, as an editor reads it beside the link.
 */
export interface FLOutboxStatus {
  delivery: FLOutboxDelivery | null;
  state: FLOutboxStatusState;
  /**
   * Whether the mail did not arrive: given up, or refused, suppressed or marked as spam by its recipient.
   *
   * The one judgement of it, which the backend's refusals and every page showing the seat read.
   */
  readonly undeliverable: boolean;
}

/**
 * One live change as Adressänderungen shows it, admin tier: both addresses, and no hash.
 */
export interface FLAddressChangeAdminOpen {
  address: string;
  delivery: FLOutboxStatus | null;
  effective_from: string | null;
  email: string;
  expired: boolean;
  holder: FLAdminTier | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  valid_until: string | null;
  waits_on: FLAddressChangeWaitsOn;
}

/**
 * The running changes this administrator may act on, newest first.
 */
export interface FLAddressChangeAdminListResponse {
  changes: FLAddressChangeAdminOpen[];
}

/**
 * The address a change starts on, and the address it goes to.
 */
export interface FLAddressChangeAdminPayload {
  /** @maxLength 254 */
  address: string;
  /** @maxLength 254 */
  email: string;
}

export type FLAddressChangeAnswer = (typeof FLAddressChangeAnswer)[keyof typeof FLAddressChangeAnswer];

export const FLAddressChangeAnswer = {
  confirmed: "confirmed",
  declined: "declined",
} as const;

export interface FLAddressChangeAnswerPayload {
  answer: FLAddressChangeAnswer;
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
export interface FLAddressChangeAnswerResponse {
  answer: FLAddressChangeAnswer;
  effective: boolean;
  effective_from: string | null;
}

/**
 * The new mailbox's notice that a confirmed change did not take effect: never why, nor the address on file.
 */
export const FLAddressChangeDiscardedDataValue = {
  kind: "address_change_discarded",
} as const;
export type FLAddressChangeDiscardedData = typeof FLAddressChangeDiscardedDataValue;

/**
 * The replaced address's notice that the change took effect.
 */
export interface FLAddressChangeEffectiveData {
  instant: string;
  kind: "address_change_effective";
}

export type FLAddressChangeEndKind = (typeof FLAddressChangeEndKind)[keyof typeof FLAddressChangeEndKind];

export const FLAddressChangeEndKind = {
  effective: "effective",
  declined: "declined",
  stopped: "stopped",
  expired: "expired",
  replaced: "replaced",
  discarded: "discarded",
} as const;

/**
 * A started, re-sent or discarded change: its mails are owed in the Postausgang, so no link is answered.
 */
export interface FLAddressChangeIdResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * The new mailbox's link to confirm an address change, minted at the hand-out into the change's `token_hashes`.
 */
export interface FLAddressChangeLinkData {
  holder: FLAdminTier | null;
  kind: "address_change_link";
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
  new: string;
  old: string;
}

/**
 * The sign-in accounts the effects still owe to carry, server to server alone: each names two addresses.
 *
 * A page at a time; a full page means more wait.
 */
export interface FLAddressChangeMovesResponse {
  moves: FLAddressChangeOpenMove[];
}

/**
 * The address on file's mail about an address change, its link minted at the hand-out into `stop.token_hashes`.
 *
 * On the person's own `account` way the link confirms or declines the change before the new mailbox is asked, and once
 * it confirmed, stops the change; on the lost-mailbox way it stops the change.
 */
export interface FLAddressChangeNoticeData {
  holder: FLAdminTier | null;
  kind: "address_change_notice";
  way: FLAddressChangeWay;
}

export const FLAddressChangeStopResponseValue = {
  stopped: true,
} as const;
export type FLAddressChangeStopResponse = typeof FLAddressChangeStopResponseValue;

/**
 * One call's share of the live changes whose step lapsed or whose waiting time ended.
 */
export interface FLAddressChangeSweepResponse {
  after: string | null;
  /** @minimum 0 */
  discarded: number;
  /** @minimum 0 */
  effective: number;
  remaining: number;
  removed: number;
}

export type FLAddressChangeValidHours = 24;

export type FLAddressChangeViewEndedSide = (typeof FLAddressChangeViewEndedSide)[keyof typeof FLAddressChangeViewEndedSide];

export const FLAddressChangeViewEndedSide = {
  new: "new",
  previous: "previous",
} as const;

/**
 * What either link opens once its change ended, for as long as its record is kept.
 */
export interface FLAddressChangeViewEnded {
  confirmed_on: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  ended_on: string;
  kind: FLAddressChangeEndKind;
  released_on: string | null;
  side: FLAddressChangeViewEndedSide;
  state: "ended";
  way: FLAddressChangeWay;
}

export type FLAddressChangeViewNewState = (typeof FLAddressChangeViewNewState)[keyof typeof FLAddressChangeViewNewState];

export const FLAddressChangeViewNewState = {
  valid: "valid",
  expired: "expired",
  not_confirmable: "not_confirmable",
  confirmed: "confirmed",
} as const;

/**
 * What the new mailbox's link opens while the change stands.
 */
export interface FLAddressChangeViewNew {
  confirmed_on: string | null;
  effective_from: string | null;
  email: string | null;
  side: "new";
  state: FLAddressChangeViewNewState;
  way: FLAddressChangeWay;
}

export type FLAddressChangeViewPreviousState = (typeof FLAddressChangeViewPreviousState)[keyof typeof FLAddressChangeViewPreviousState];

export const FLAddressChangeViewPreviousState = {
  release_open: "release_open",
  release_expired: "release_expired",
  open: "open",
  waiting_period: "waiting_period",
} as const;

/**
 * What the address on file's link opens: the step the change waits on, never whether the new mailbox could confirm it.
 */
export interface FLAddressChangeViewPrevious {
  effective_from: string | null;
  email: string | null;
  released_on: string | null;
  side: "previous";
  state: FLAddressChangeViewPreviousState;
  way: FLAddressChangeWay;
}

/**
 * What one address link opens: never a name or the id.
 *
 * The new address only where its holder judges by it: the new mailbox's `valid` link, and the address on file's link while
 * the change stands, masked on `waiting_period`.
 */
export interface FLAddressChangeViewResponse {
  view: FLAddressChangeViewNew | FLAddressChangeViewPrevious | FLAddressChangeViewEnded;
}

export type FLAddressChangeWaitingPeriodDays = 7;

export interface FLAddressPayload {
  /**
   * @minLength 1
   * @maxLength 80
   */
  city: string;
  /** @maxLength 80 */
  district: string;
  /**
   * @maxLength 16
   * @pattern ^([0-9\-abcABC]+)?$
   */
  house_number: string;
  /**
   * @minLength 5
   * @maxLength 5
   * @pattern ^[0-9]{5}$
   */
  postcode: string;
  /**
   * @minLength 1
   * @maxLength 120
   */
  street: string;
}

/**
 * One pupil a club fields in one match: on the pitch from the start, or on the bench.
 */
export interface FLAufstellungEntry {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  starts: boolean;
}

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

export type FLSpielberichtSpielerType = (typeof FLSpielberichtSpielerType)[keyof typeof FLSpielberichtSpielerType];

export const FLSpielberichtSpielerType = {
  named: "named",
  anonymous: "anonymous",
  unknown: "unknown",
} as const;

/**
 * One pupil of a line-up, as the base tier serves them, with the captaincy their squad row holds.
 *
 * `rolle` only where `type` is `named`: the mark stands beside a name, and beside a withheld one it would say who the
 * nameless pupil is.
 */
export interface FLAufstellungEntryPublic {
  first_name: string | null;
  last_name: string | null;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  starts: boolean;
  type: FLSpielberichtSpielerType;
}

/**
 * An entry of the locked line-up naming a pupil erased since it locked, which the club fielded and nobody names.
 *
 * Read-only and counted: no save names it, and every save keeps it as stored while the line-up stays locked, since it
 * is the record of whom the club fielded. A fixture re-dated ahead of its lock serves none, and its next save drops them.
 */
export interface FLAufstellungErased {
  starts: boolean;
}

export type FLAufstellungPhase = (typeof FLAufstellungPhase)[keyof typeof FLAufstellungPhase];

export const FLAufstellungPhase = {
  open: "open",
  overdue: "overdue",
  locked: "locked",
} as const;

/**
 * What a team's read serves about a line-up: whether one is stored, and where the clock stands against its fixture's kick-off.
 *
 * Two facts and the instant it is due, never one combined state: a page calls a line-up due where it is `open` with
 * none stored, and overdue where the due mark has passed with none stored.
 */
export interface FLAufstellungMarks {
  due_at: string;
  phase: FLAufstellungPhase;
  stored: boolean;
}

/**
 * A club's whole line-up for one fixture, written wholesale.
 */
export interface FLAufstellungPayload {
  /** @maxItems 60 */
  spieler: FLAufstellungEntry[];
  version: number | null;
}

/**
 * One club's line-up for the match, starters and substitutes in the order the club entered them.
 */
export interface FLAufstellungPublic {
  spieler: FLAufstellungEntryPublic[];
}

/**
 * A fixture as a mail asking about it states it, its ground among the rest.
 */
export interface FLSpielMailAnsetzung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  spielort: string | null;
  team1: string;
  team2: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  time: string;
}

/**
 * A club's one reminder that it has entered no line-up for a fixture: the pairing, the kick-off and the ground, and where it is entered.
 */
export interface FLAufstellungReminderData {
  appointment: FLSpielMailAnsetzung;
  due_at: string;
  kind: "aufstellung_reminder";
  saison_id: string;
  team: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * A pupil a line-up may name or names, as the club's own people read them: the whole surname, and what their squad row holds.
 *
 * Both names null where no record holds the pupil.
 */
export interface FLAufstellungSpieler {
  first_name: string | null;
  is_nachnominiert: boolean;
  last_name: string | null;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

export type FLSaisonStatus = (typeof FLSaisonStatus)[keyof typeof FLSaisonStatus];

export const FLSaisonStatus = {
  past: "past",
  active: "active",
  future: "future",
} as const;

export type FLSaisonPhase = (typeof FLSaisonPhase)[keyof typeof FLSaisonPhase];

export const FLSaisonPhase = {
  gruppenphase: "gruppenphase",
  achtelfinale: "achtelfinale",
  viertelfinale: "viertelfinale",
  halbfinale: "halbfinale",
  finale: "finale",
} as const;

export interface FLSpielberichtTeam {
  name: string;
  shorthand: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * The fixture a line-up is for, as its screen states it, with the matchday the screen's lead names it by.
 */
export interface FLAufstellungSpiel {
  /** @minimum 1 */
  count_spieltage_in_phase: number;
  date: string | null;
  for_third_place: boolean;
  saison_id: string;
  saison_phase: FLSaisonPhase;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @minimum 1 */
  spieltag_position: number;
  team1: FLSpielberichtTeam | null;
  team2: FLSpielberichtTeam | null;
  time: string | null;
}

/**
 * One club's line-up screen for one fixture: the squad to pick from, the stored line-up and what its save sends back.
 *
 * `saison_status` as the match editor's read serves it (`FLSpieleAdminSingleResponse`): a finished season's line-up
 * opens read-only, which the save refuses (`saison_past`).
 */
export interface FLAufstellungResponse {
  erased: FLAufstellungErased[];
  kader: FLAufstellungSpieler[];
  marks: FLAufstellungMarks | null;
  named: FLAufstellungSpieler[];
  saison_status: FLSaisonStatus;
  spiel: FLAufstellungSpiel;
  spieler: FLAufstellungEntry[];
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  version: number | null;
}

export type FLAufstellungStartersMax = 11;

/**
 * A stored line-up as the match editor states it per side: how many pupils it names, and how many of them start.
 */
export interface FLAufstellungSummary {
  /** @minimum 0 */
  count: number;
  /** @minimum 0 */
  starters: number;
}

/**
 * Each side's line-up, the one whose club the fixture fields there now; null where none of that club's stands.
 */
export interface FLAufstellungenPublic {
  team1: FLAufstellungPublic | null;
  team2: FLAufstellungPublic | null;
}

export type FLAustrittType = (typeof FLAustrittType)[keyof typeof FLAustrittType];

export const FLAustrittType = {
  disqualifikation: "disqualifikation",
  rueckzug: "rueckzug",
} as const;

/**
 * How a team came to be out of one season, why, and from when.
 *
 * `reason` is FREE TEXT and PUBLIC -- it appears on the team's page, and this league publishes no
 * disciplinary code an enum could cite.
 */
export interface FLAustritt {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  /** @minLength 1 */
  reason: string;
  type: FLAustrittType;
}

/**
 * A fixture as a mail lists it: its two sides in the fixture's order, its day and its hour where it holds them.
 */
export interface FLSpielMailEntry {
  date: string | null;
  team1: string;
  team2: string;
  time: string | null;
}

/**
 * An opponent's word that a club left the season, owed at the exit's own write: the fixtures left open between them.
 */
export interface FLAustrittNoticeData {
  kind: "austritt_notice";
  saison_id: string;
  /** @minItems 1 */
  spiele: FLSpielMailEntry[];
  team: string;
}

/**
 * The exit as an administrator writes it: the reason ceilinged as it arrives and stripped before its floor.
 *
 * On the WRITE side alone, so a read model takes a stored blank or a longer reason as it stands.
 */
export interface FLAustrittPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  /**
   * @minLength 1
   * @maxLength 500
   * @pattern ^[^\x00\v\f\u0085\u2028\u2029]*$
   */
  reason: string;
  type: FLAustrittType;
}

/**
 * The ban's own notice, the one mail a ban does not stop (`app/api/outbox/services.py :: UNBARRED`).
 */
export interface FLBanData {
  ban_reason: string;
  barred_until_saison_id: string;
  kind: "ban";
}

export type FLBanDurationSaisons = 5;

/**
 * One ban as the list serves it.
 */
export interface FLBanListRow {
  /** @minLength 1 */
  address: string;
  /** @minLength 1 */
  ban_reason: string;
  /**
   * @minLength 4
   * @maxLength 4
   */
  barred_until_saison_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  created_at: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

/**
 * Every ban, newest first.
 */
export interface FLBanListResponse {
  ban_list: FLBanListRow[];
}

/**
 * The removal is hard, so the id is all there is to answer with: no document survives to echo.
 */
export interface FLBanListWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  ban_list_entry_id: string;
}

export type FLBewerbungConfirmationState = (typeof FLBewerbungConfirmationState)[keyof typeof FLBewerbungConfirmationState];

export const FLBewerbungConfirmationState = {
  valid: "valid",
  confirmed: "confirmed",
  declined: "declined",
  expired: "expired",
} as const;

/**
 * One seat's confirmation bookkeeping as the triage reads it, without its link's hashes.
 */
export interface FLBewerbungConfirmation {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  declined_at: string | null;
  delivery: FLOutboxStatus | null;
  reminded_at: string | null;
  sent_at: string | null;
  state: FLBewerbungConfirmationState;
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
 * When this application was decided, and on a decline why.
 */
export interface FLBewerbungDecision {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  made_at: string;
  reason: string | null;
}

/**
 * The school's own estimate of its squad, which nothing checks afterwards.
 */
export interface FLBewerbungKader {
  expected_size: number;
  good_spieler: number;
}

export type FLSeatScopeTextVersion = "2026-11-whatsapp-1";

export type FLSchiedsrichterScopeTextVersion = "2026-11-name-spielplan-1";

export type FLEinwilligungTextVersion =
  FLSeatScopeTextVersion | FLSpielerScopeTextVersion | FLSchiedsrichterScopeTextVersion | FLCitedMediaTextVersion;

/**
 * When a person set one consent choice, and under which wording.
 */
export interface FLEinwilligungReceipt {
  at: string;
  text_version: FLEinwilligungTextVersion;
}

/**
 * The evidence one consent choice keeps: the act that set its value, and on a withdrawal the grant it ended.
 */
export interface FLEinwilligungEvidence {
  at: string;
  given_before: FLEinwilligungReceipt | null;
  text_version: FLEinwilligungTextVersion;
}

/**
 * Each choice's evidence, null until its person sets it: a record no person has answered carries none.
 */
export interface FLEinwilligungEvidenceSet {
  media: FLEinwilligungEvidence | null;
  scope: FLEinwilligungEvidence | null;
}

/**
 * How this person's record came to be held, and what they answered.
 *
 * Kenntnisnahme and not Einwilligung: the published basis is Art. 6(1)(b)/(f), and the pupil's
 * `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` holds other values entirely
 * (`docs/glossary.md :: Einwilligung`).
 */
export interface FLKontaktKenntnisnahme {
  confirmed_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  evidence: FLEinwilligungEvidenceSet;
  media: boolean;
  scope: FLKontaktKenntnisnahmeScope;
}

/**
 * One person the league reaches this team through, for one season.
 */
export interface FLKontaktperson {
  birth_date: string | null;
  einwilligung: FLKontaktKenntnisnahme;
  email: string;
  /** @minLength 1 */
  first_name: string;
  /** @minLength 1 */
  last_name: string;
  phone: string;
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
 * finished season keeps those who confirmed their seat.
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
  existing_set: string;
  wunschfarbe: FLTrikotFarbe;
}

/**
 * One school's application to play one season, as stored.
 */
export interface FLBewerbung {
  confirmations: FLBewerbungConfirmations;
  decision: FLBewerbungDecision | null;
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
  version: number;
  wunschgegner: string | null;
}

/**
 * A decline, to one person of the application, with the administrator's reason verbatim.
 */
export interface FLBewerbungAbsageData {
  kind: "bewerbung_absage";
  reason: string;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  team: string;
}

/**
 * The school's address, with the district required.
 */
export interface FLBewerbungAddressPayload {
  /**
   * @minLength 1
   * @maxLength 80
   */
  city: string;
  /**
   * @minLength 1
   * @maxLength 80
   */
  district: string;
  /**
   * @maxLength 16
   * @pattern ^([0-9\-abcABC]+)?$
   */
  house_number: string;
  /**
   * @minLength 5
   * @maxLength 5
   * @pattern ^[0-9]{5}$
   */
  postcode: string;
  /**
   * @minLength 1
   * @maxLength 120
   */
  street: string;
}

export type FLBewerbungConfirmationDeadlineDays = 14;

export type FLEinwilligungOutcome = (typeof FLEinwilligungOutcome)[keyof typeof FLEinwilligungOutcome];

export const FLEinwilligungOutcome = {
  confirmed: "confirmed",
  declined: "declined",
} as const;

/**
 * What the answer did; a Widerspruch's notice to the Ansprechperson is owed in the same write.
 */
export interface FLBewerbungEinwilligungAnswerResponse {
  birth_date: string | null;
  media: boolean;
  outcome: FLEinwilligungOutcome;
  quelle: "bewerbung";
  whatsapp: boolean;
}

/**
 * One person's Widerspruch for one seat, which empties their slot: it carries nothing of them.
 */
export interface FLBewerbungEinwilligungDeclined {
  answer: "declined";
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
}

/**
 * A contact seat's two wordings: the WhatsApp switch and the media switch.
 */
export interface FLSeatTextVersions {
  media: FLCitedMediaTextVersion;
  scope: FLSeatScopeTextVersion;
}

/**
 * One person's consent for one seat: their own birthdate, their two choices and the wording they saw.
 */
export interface FLBewerbungEinwilligungGiven {
  answer: "given";
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  birth_date: string;
  media: boolean;
  text_versions: FLSeatTextVersions;
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
  whatsapp: boolean;
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
} as const;

export type FLKontaktRow = (typeof FLKontaktRow)[keyof typeof FLKontaktRow];

export const FLKontaktRow = {
  open: "open",
  saison_past: "saison_past",
  exited: "exited",
} as const;

/**
 * What the page renders for one seat, and nothing of the person.
 */
export interface FLBewerbungEinwilligungViewResponse {
  also_rolle: FLKontaktRolle | null;
  answered_at: string | null;
  deadline: string | null;
  maximum_age: number;
  minimum_age: number;
  quelle: FLBewerbungEinwilligungViewResponseQuelle;
  rolle: FLKontaktRolle;
  row: FLKontaktRow | null;
  saison_id: string;
  schule: string;
  state: FLBewerbungEinwilligungViewResponseState;
}

/**
 * Where an accepted application's club stands in the season, which the decision itself does not record.
 */
export interface FLBewerbungEntry {
  gruppe: FLGruppenNames;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * One group an acceptance may name, and whether it has room.
 */
export interface FLBewerbungGruppeOffer {
  free: number;
  gruppe: FLGruppenNames;
}

/**
 * What an acceptance into one season would meet, so its dialog offers what the write takes: no page derives it.
 */
export interface FLBewerbungEntryOffer {
  gruppen: FLBewerbungGruppeOffer[];
  status: FLSaisonStatus;
  taken: FLTrikotFarbe[];
}

/**
 * One club as the public form offers it: its id and its name.
 */
export interface FLBewerbungSchuleOption {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
}

export type FLBewerbungFormWindowState = (typeof FLBewerbungFormWindowState)[keyof typeof FLBewerbungFormWindowState];

export const FLBewerbungFormWindowState = {
  running: "running",
  upcoming: "upcoming",
  closed: "closed",
  ended: "ended",
} as const;

/**
 * A season's application window as the form's page shows it.
 */
export interface FLBewerbungFormWindow {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start: string;
  state: FLBewerbungFormWindowState;
}

/**
 * What one season's application form shows, whichever state its page takes.
 */
export interface FLBewerbungFormResponse {
  schulen: FLBewerbungSchuleOption[];
  taken: FLTrikotFarbe[];
  window: FLBewerbungFormWindow | null;
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

export type FLBewerbungKontaktMinAgeYears = 16;

/**
 * The person a seat is to hold, who has agreed to nothing yet, and the `version` the page read the application at.
 */
export interface FLBewerbungKontaktSeatPayload {
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  first_name: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  last_name: string;
  /** @pattern ^([+]?[ 0-9\-().]{2,19}[0-9])$ */
  phone: string;
  /** @minimum 0 */
  version: number;
}

/**
 * A seat's address as the write left it; the link is owed there in the same write.
 */
export interface FLBewerbungKontaktSeatResponse {
  email: string;
}

/**
 * One of the three people, as a member of the public submits them, without a birthdate.
 */
export interface FLBewerbungKontaktpersonPayload {
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  first_name: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  last_name: string;
  /** @pattern ^([+]?[ 0-9\-().]{2,19}[0-9])$ */
  phone: string;
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

export type FLBewerbungLinkDataKind = (typeof FLBewerbungLinkDataKind)[keyof typeof FLBewerbungLinkDataKind];

export const FLBewerbungLinkDataKind = {
  bewerbung_confirmation: "bewerbung_confirmation",
  bewerbung_reminder: "bewerbung_reminder",
} as const;

/**
 * One person's confirmation link on an application: at its submission, a re-send, a correction or a reseat, or the one reminder.
 *
 * `rollen` are every seat the link answers, two where the Trainer holds a second; the reminder's link joins the first.
 */
export interface FLBewerbungLinkData {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  kind: FLBewerbungLinkDataKind;
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  schule: string;
}

/**
 * One application as the season's list shows it, holding nothing of a person.
 */
export interface FLBewerbungListRow {
  duplicate: boolean;
  expected_kader: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  name: string;
  new_school: boolean;
  people: number;
  seats_confirmed: number;
  shorthand: string | null;
  status: FLBewerbungStatus;
  stufengroesse: number;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  submitted_at: string;
  unmailed: boolean;
  version: number;
  wunschfarbe: FLTrikotFarbe;
  wunschgegner: string | null;
}

/**
 * A contact's Widerspruch, to the Ansprechperson, naming the seats it emptied: it stands as the deletion notice too.
 */
export interface FLBewerbungObjectionData {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  /** @minItems 1 */
  declined: FLKontaktRolle[];
  kind: "bewerbung_objection";
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
}

/**
 * The Ansprechperson's receipt, which carries their own link: their seats and every other seat still to answer.
 */
export interface FLBewerbungReceivedData {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  kind: "bewerbung_received";
  pending: FLKontaktRolle[];
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
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
  /**
   * @minLength 1
   * @maxLength 60
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  team_name: string;
  website_url: string | null;
}

/**
 * One application as its review page shows it.
 */
export interface FLBewerbungSingleResponse {
  bewerbung: FLBewerbung;
  duplicate: boolean;
  entry: FLBewerbungEntry | null;
  name: string;
  saison: FLBewerbungEntryOffer;
  seats_confirmed: number;
  shorthand: string | null;
}

/**
 * One season's pass: each clock's count, every reminder and deletion notice owed in the write it belongs to.
 */
export interface FLBewerbungSweepResponse {
  erased: number;
  erased_accepted: number;
  erased_declined: number;
  erased_without_decision: number;
  failed: number;
  kontakt_blocks_emptied: number;
  kontakt_seats_emptied: number;
  reminded: number;
  saison_id: string;
}

export interface FLBewerbungTrikotPayload {
  /** @maxLength 500 */
  existing_set: string;
  wunschfarbe: FLTrikotFarbe;
}

/**
 * The application window open today, by the one rule the submission refuses on: the season it is for and its last day.
 */
export interface FLBewerbungWindow {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end: string;
  saison_id: string;
}

/**
 * An acceptance, to one person of the application, naming the seats they were entered for.
 */
export interface FLBewerbungZusageData {
  gruppe: FLGruppenNames;
  kind: "bewerbung_zusage";
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  saison_id: string;
  shorthand: string;
  team: string;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * The season's applications and what an acceptance would meet there.
 */
export interface FLBewerbungenAdminListResponse {
  bewerbungen: FLBewerbungListRow[];
  complete: boolean;
  saison: FLBewerbungEntryOffer;
}

export type FLBookingResource = (typeof FLBookingResource)[keyof typeof FLBookingResource];

export const FLBookingResource = {
  spielort: "spielort",
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
  gruppenphase_spiel_wired: "gruppenphase_spiel_wired",
  source_feeds_another_spiel: "source_feeds_another_spiel",
} as const;

export type FLSpielSide = (typeof FLSpielSide)[keyof typeof FLSpielSide];

export const FLSpielSide = {
  team1: "team1",
  team2: "team2",
} as const;

/**
 * One slot carrying a reference it must not carry, whatever that reference names.
 */
export interface FLBracketFaultSlot {
  quelle: FLSpielQuelle;
  reason: FLBracketFaultSlotReason;
  side: FLSpielSide;
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
  austritt_type: FLAustrittType;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  exited_since: string;
  reason: FLBracketFaultOccupantReason;
  side: FLSpielSide;
  spiel_date: string | null;
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
  side: FLSpielSide;
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
  other_date: string;
  other_saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  other_spiel_id: string;
  /** @exclusiveMinimum 0 */
  other_spiel_nr: number;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  other_time: string;
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

export type FLByAdminKind = (typeof FLByAdminKind)[keyof typeof FLByAdminKind];

export const FLByAdminKind = {
  admin: "admin",
} as const;

/**
 * An administrator's act, naming nobody: the record keeps how a thing was settled, not who typed it.
 */
export interface FLByAdmin {
  kind: FLByAdminKind;
}

export type FLCardColour = (typeof FLCardColour)[keyof typeof FLCardColour];

export const FLCardColour = {
  gelb: "gelb",
  gelb_rot: "gelb_rot",
  rot: "rot",
} as const;

export type FLConfirmationState = (typeof FLConfirmationState)[keyof typeof FLConfirmationState];

export const FLConfirmationState = {
  valid: "valid",
  confirmed: "confirmed",
  expired: "expired",
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
   * @pattern ^[^\x00\v\f\u0085\u2028\u2029]*$
   */
  reason: string;
  /** @minimum 0 */
  version: number;
}

/**
 * The declined application; its mails are owed in the same write.
 */
export interface FLDeclineBewerbungResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
}

export type FLDeclinedRetentionDays = 14;

/**
 * The one deletion notice, to a person who confirmed what went: an application's owed by a league write, an account's here.
 */
export interface FLDeletionNoticeData {
  kind: "deletion_notice";
  saison_id: string | null;
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
  date: string;
  evidence: FLEinwilligungEvidenceSet;
  media: boolean;
  scope: FLEinwilligungScope;
}

/**
 * A club the league holds, picked from the list's create dialog.
 */
export interface FLEntryKnownClub {
  kind: "known";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
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
 * A club the entry founds, in the transaction that enters it.
 */
export interface FLEntryNewClub {
  kind: "new";
  team: FLPostTeamPayload;
}

/**
 * The mailbox an erasure or its counts are looked up by.
 */
export interface FLErasureAddressPayload {
  /**
   * Its domain, after the last `@`, in ASCII alone, an international one in punycode; else `email_not_accepted`.
   * @maxLength 254
   * @pattern @
   */
  email: string;
}

/**
 * The mailbox, and the reference to the request the erasure answers, free text the log's row keeps.
 */
export interface FLErasurePayload {
  /**
   * Its domain, after the last `@`, in ASCII alone, an international one in punycode; else `email_not_accepted`.
   * @maxLength 254
   * @pattern @
   */
  email: string;
  /**
   * @minLength 1
   * @maxLength 200
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  reason: string;
}

/**
 * One call's share of the season-after rule: what it erased, whom it passed over, and how many are still due.
 */
export interface FLErasureSweepResponse {
  after: string | null;
  completed_saison_id: string | null;
  failed: number;
  registrierungen: number;
  remaining: number;
  saison_spieler: number;
  skipped: number;
  spieler: number;
}

/**
 * What the administrator's erasure of one address reaches, counted and never named, so the confirmation shows no person.
 */
export interface FLErasureViewResponse {
  /** @minimum 0 */
  address_change: number;
  /** @minimum 0 */
  bewerbung_seats: number;
  /** @minimum 0 */
  grants: number;
  /** @minimum 0 */
  kontakt_seats: number;
  /** @minimum 0 */
  registrierungen: number;
  /** @minimum 0 */
  schiedsrichter: number;
  /** @minimum 0 */
  spiele: number;
  /** @minimum 0 */
  spieler: number;
}

export type FLRefusedFieldIn = (typeof FLRefusedFieldIn)[keyof typeof FLRefusedFieldIn];

export const FLRefusedFieldIn = {
  body: "body",
  query: "query",
  path: "path",
  header: "header",
  cookie: "cookie",
} as const;

export type FLRefusedFieldCtx = { [key: string]: string | number | boolean | number[] };

export interface FLRefusedField {
  ctx: FLRefusedFieldCtx;
  in: FLRefusedFieldIn;
  kind: string;
  path: (string | number)[];
}

/**
 * Every refusal's one body, whatever its status, in the shape of RFC 9457's problem details.
 *
 * Its members are this API's own extensions alone: a client words a refusal from its code, so no
 * `type`, `title` or `detail` carries English a visitor would read.
 */
export interface FLFailureBody {
  error_code: Code;
  fields: FLRefusedField[];
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
 * season editor then counts off the stored matchdays and fixtures, so the two can be compared by eye.
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

export type FLGrantDataChange = (typeof FLGrantDataChange)[keyof typeof FLGrantDataChange];

export const FLGrantDataChange = {
  granted: "granted",
  revoked: "revoked",
  handover: "handover",
  address: "address",
} as const;

export type FLGrantDataStage = (typeof FLGrantDataStage)[keyof typeof FLGrantDataStage];

export const FLGrantDataStage = {
  started: "started",
  withdrawn: "withdrawn",
  completed: "completed",
} as const;

/**
 * One step of what changes who holds the administration, as every holder in effect and the person named are told it.
 */
export interface FLGrantData {
  address: string | null;
  change: FLGrantDataChange;
  effective_from: string | null;
  kind: "grant";
  new_address: string | null;
  stage: FLGrantDataStage;
}

export interface FLGrantHandoverPassResponse {
  /** @minimum 0 */
  handed_over: number;
}

/**
 * One grant as the list serves it.
 */
export interface FLGrantRow {
  address: string;
  admin_tier: FLAdminTier;
  effective_from: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  owner_from: string | null;
}

export type FLGrantWaitHours = 24;

/**
 * The grant an act named: a removal is hard, so the id is all there is to answer with.
 */
export interface FLGrantWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  grant_id: string;
}

/**
 * Every grant, never in part, a waiting addition among them.
 */
export interface FLGrantsListResponse {
  grants: FLGrantRow[];
}

/**
 * A team's registration link, to one confirmed contact seat, for the pupils to register through.
 */
export interface FLInvitationData {
  kind: "invitation";
  saison_id: string;
  team: string;
}

/**
 * How the press's teams came out: the season editor's rows then read what each team holds.
 */
export interface FLInvitationDispatchResponse {
  /** @minimum 0 */
  failed: number;
  /** @minimum 0 */
  mailed: number;
  /** @minLength 1 */
  saison_id: string;
  /** @minimum 0 */
  skipped: number;
}

export type FLInvitationSkipReason = (typeof FLInvitationSkipReason)[keyof typeof FLInvitationSkipReason];

export const FLInvitationSkipReason = {
  austritt_entered: "austritt_entered",
  no_kontakt_block: "no_kontakt_block",
  no_confirmed_kontaktperson: "no_confirmed_kontaktperson",
  already_sent: "already_sent",
} as const;

/**
 * One team as the season editor's registration links list it: today's preview of the press, and the link the team holds.
 */
export interface FLInvitationLinkRow {
  has_link: boolean;
  sent_at: string | null;
  skipped: FLInvitationSkipReason | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  /** @minLength 1 */
  team_name: string;
}

/**
 * The one live link a team's panel shows, to be mailed to the team's confirmed seats.
 */
export interface FLInvitationMailPayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  invitation_id: string;
}

/**
 * How many the team's live link is owed to: its confirmed seats, one per stored address, 0 where nobody confirmed.
 */
export interface FLInvitationMailResponse {
  /** @minimum 0 */
  mailed: number;
}

/**
 * A freshly minted registration link, and the only answer that ever carries its raw value.
 *
 * Shown once for copying and mailed on a separate press; no later read recovers it from the hash.
 */
export interface FLInvitationMintResponse {
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
 * One live link as the team's read serves it.
 */
export interface FLInvitationRow {
  delivery: FLOutboxStatus | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  revoked_at: string | null;
  /** @minLength 1 */
  saison_id: string;
  sent_at: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
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
  /** @minLength 1 */
  first_name: string;
  inactive_since: string | null;
  is_nachnominiert: boolean;
  last_name: string | null;
  nummer: string | null;
  nummer_double: boolean;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  version: number;
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
 * The referee as the public reads serve it: a forename and a surname initial where they consented, else no name.
 *
 * Neither the payment nor the referee's id is served.
 */
export interface FLSpielSchiedsrichterFieldPublic {
  name: string | null;
  name_is_public: boolean;
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
 * The venue as the public reads serve it: which ground, its current name and where to find it, without the rent.
 */
export interface FLSpielortFieldPublic {
  /** @minLength 1 */
  maps_link: string;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielort_id: string;
}

/**
 * One side as a read serves it: its club's name and shorthand in the season, and the way it left, null while it has not.
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
  date: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  for_third_place: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  note: string | null;
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
  spielort: FLSpielortFieldPublic | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  team1: FLSpielTeamFieldJoined | null;
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelle | null;
  time: string | null;
}

/**
 * One matchday as the Spielplan shows it, holding its matches in the order the draw numbered them.
 */
export interface FLSpielplanSpieltag {
  /** @minimum 0 */
  count_spiele: number;
  end: string | null;
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
  spiele: FLSpielJoined[];
  start: string | null;
  version: number;
}

/**
 * A season's knockout matchdays in the order they are played, each holding its matches.
 *
 * A side whose club is not yet known is null, and its `quelle` says where it comes from.
 */
export interface FLKoRundeResponse {
  spieltage: FLSpielplanSpieltag[];
}

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

/**
 * One person an administrator seated on a team's season row, asked to confirm.
 */
export interface FLKontaktLinkData {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  kind: "kontakt_confirmation";
  /** @minItems 1 */
  rollen: FLKontaktRolle[];
  row: FLKontaktRow;
  saison_id: string;
  schule: string;
}

export interface FLKontaktPayload {
  /** @maxLength 254 */
  email: string;
  phone: string | null;
}

/**
 * The person one seat is to hold, on the row's `version` the dialog read, who has agreed to nothing yet.
 */
export interface FLKontaktSeatPayload {
  /** @maxLength 254 */
  email: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  first_name: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  last_name: string;
  /** @pattern ^([+]?[ 0-9\-().]{2,19}[0-9])$ */
  phone: string;
  trainer_is_also?: FLTrainerAlso | null;
  /** @minimum 0 */
  version: number;
}

/**
 * Where the seat write's link went.
 */
export interface FLKontaktSeatResponse {
  email: string | null;
}

/**
 * A club as the landing names it, on the opening match or the podium, under the name and shorthand it plays the season under.
 */
export interface FLLandingSide {
  name: string;
  shorthand: string;
}

/**
 * The season's opening match: when it is set to start, in Berlin wall time, its two sides and its Spieltag's `position`.
 *
 * A side is null while its slot is empty, as a match's own sides are.
 */
export interface FLLandingOpeningSpiel {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  /** @minimum 1 */
  spieltag_position: number;
  team1: FLLandingSide | null;
  team2: FLLandingSide | null;
  time: string | null;
}

/**
 * One club of a season as the Teams page lists it: the name and shorthand it plays this season under.
 */
export interface FLSaisonTeamEntry {
  austritt_type: FLAustrittType | null;
  gruppe: FLGruppenNames;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
}

/**
 * Before its start date: its opening match, the earliest dated group match, null while none is.
 */
export interface FLLandingBeforeStart {
  id: string;
  opening_spiel: FLLandingOpeningSpiel | null;
  starts_at: string;
  state: "before_start";
  teams: FLSaisonTeamEntry[];
}

/**
 * The league's four figures over every season the public reads, counted on every read and never stored.
 *
 * `count_saisons` is those seasons; `count_schulen` the clubs that took part in any of them, each counted once;
 * `count_spiele` every match of any phase the Tabelle would count, one carrying an `ergebnis`, a forfeit among them;
 * `count_tore` both sides' goals summed over the same matches, a forfeit's awarded goals among them, a shoot-out's never.
 */
export interface FLLandingCounts {
  /** @minimum 0 */
  count_saisons: number;
  /** @minimum 0 */
  count_schulen: number;
  /** @minimum 0 */
  count_spiele: number;
  /** @minimum 0 */
  count_tore: number;
}

/**
 * Once all four places are in: places one to four in their order.
 */
export interface FLLandingDecided {
  id: string;
  /**
   * @minItems 4
   * @maxItems 4
   */
  podium: [FLLandingSide | null, FLLandingSide | null, FLLandingSide | null, FLLandingSide | null];
  starts_at: string;
  state: "decided";
  teams: FLSaisonTeamEntry[];
}

/**
 * From its start date: the latest result and the next match, at most one of each, empty where there is none.
 */
export interface FLLandingRunning {
  id: string;
  recent: FLSpielJoined[];
  starts_at: string;
  state: "running";
  teams: FLSaisonTeamEntry[];
  upcoming: FLSpielJoined[];
}

/**
 * The landing's facts: the season the site is on, null for a league that has none, an open window, and the league's figures.
 */
export interface FLLandingResponse {
  bewerbung_opens_on: string | null;
  bewerbung_window: FLBewerbungWindow | null;
  bewerbung_window_held: boolean;
  counts: FLLandingCounts;
  saison: FLLandingBeforeStart | FLLandingRunning | FLLandingDecided | null;
}

export type FLMediaMinAgeYears = 18;

export type FLMediaTextVersion = "2026-11-medien-1";

export type FLNameKaderTextVersion = "2026-11-name-kader-1";

export type FLNameSpielplanTextVersion = "2026-11-name-spielplan-1";

/**
 * The stored person a confirmed registration's address resolves to, named so the team can be asked whether it is the same one.
 */
export interface FLRegistrierungPerson {
  deviates_from: boolean;
  /** @minLength 1 */
  first_name: string;
  last_name: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

/**
 * One pending registration as the team deciding it reads it.
 */
export interface FLOpenRegistrierung {
  admissible: boolean;
  /** @minLength 1 */
  first_name: string;
  kader_full: boolean;
  /** @minLength 1 */
  last_name: string;
  nummer: string | null;
  nummer_double: boolean;
  person: FLRegistrierungPerson | null;
  position: FLSpielerPosition | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  submitted_at: string;
}

/**
 * One team's pending registrations for one season, newest first.
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
  at: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  reason: string | null;
  state: FLOutboxDeliveryState;
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
  kind: "sign_in_code",
} as const;
export type FLSignInCodeData = typeof FLSignInCodeDataValue;

export type FLPasskeyDataKind = (typeof FLPasskeyDataKind)[keyof typeof FLPasskeyDataKind];

export const FLPasskeyDataKind = {
  passkey_added: "passkey_added",
  passkey_erased: "passkey_erased",
} as const;

export interface FLPasskeyData {
  instant: string;
  kind: FLPasskeyDataKind;
}

/**
 * A referee's confirmation link, owed by their entry, a corrected address, a re-send or their return.
 */
export interface FLSchiedsrichterConfirmationData {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  kind: "schiedsrichter_confirmation";
}

export type FLSpielRequestDataKind = (typeof FLSpielRequestDataKind)[keyof typeof FLSpielRequestDataKind];

export const FLSpielRequestDataKind = {
  spiel_request: "spiel_request",
  spiel_reminder: "spiel_reminder",
} as const;

/**
 * A fixture's slot as a mail names it: its two sides in the fixture's order, its day and its hour.
 */
export interface FLSpielMailAppointment {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  team1: string;
  team2: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  time: string;
}

/**
 * A club's request to confirm a fixture, or the reminder of it, each leading to the club's own pages.
 */
export interface FLSpielRequestData {
  ansetzung: FLSpielMailAnsetzung;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  kind: FLSpielRequestDataKind;
  moved_from: FLSpielMailAppointment | null;
  saison_id: string;
  team: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * A referee's word that they are booked onto a fixture, which they answer on their own panel.
 */
export interface FLSpielEinteilungData {
  ansetzung: FLSpielMailAnsetzung;
  kind: "spiel_einteilung";
  moved_from: FLSpielMailAppointment | null;
}

export type FLSpielMovedDataRecipient = (typeof FLSpielMovedDataRecipient)[keyof typeof FLSpielMovedDataRecipient];

export const FLSpielMovedDataRecipient = {
  team: "team",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A party's word that a fixture it was asked about left that slot, owed where no request about its new slot goes now.
 *
 * The mail's own request carries the move where the new slot is asked at once (`FLSpielRequestData.moved_from`).
 */
export interface FLSpielMovedData {
  appointment: FLSpielMailAppointment;
  asked_again: boolean;
  kind: "spiel_moved";
  moved_to: FLSpielMailAppointment | null;
  recipient: FLSpielMovedDataRecipient;
}

export type FLSpielNoticeDataRecipient = (typeof FLSpielNoticeDataRecipient)[keyof typeof FLSpielNoticeDataRecipient];

export const FLSpielNoticeDataRecipient = {
  team: "team",
  schiedsrichter: "schiedsrichter",
} as const;

/**
 * A party's word that a fixture it was asked about was called off: the slot it was asked about.
 */
export interface FLSpielNoticeData {
  appointment: FLSpielMailAppointment;
  kind: "spiel_cancelled";
  recipient: FLSpielNoticeDataRecipient;
}

/**
 * A referee's word that they were taken off a fixture after being told of it: the slot they were told of.
 */
export interface FLSpielEinteilungLiftedData {
  appointment: FLSpielMailAppointment;
  kind: "spiel_einteilung_lifted";
}

/**
 * A club's word that the league kept the date it declined and proposed another for: the slot that stands.
 */
export interface FLSpielVorschlagDiscardedData {
  appointment: FLSpielMailAppointment;
  kind: "spiel_vorschlag_discarded";
}

/**
 * A pupil's confirmation link.
 *
 * The window its mail states is published, never carried here: `app/shared/schemas/bounds.py ::
 * FLRegistrierungConfirmationDeadlineDays`.
 */
export interface FLRegistrierungLinkData {
  kind: "registrierung_confirmation";
  saison_id: string;
  team: string;
}

/**
 * A team's decline, to a pupil whose address was confirmed.
 */
export interface FLRegistrierungAbsageData {
  kind: "registrierung_absage";
  reason: "other_person" | null;
  saison_id: string;
  team: string;
}

/**
 * One owed mail a claim hands out, server to server alone: it names its recipient and may carry a live link or secret.
 */
export interface FLOutboxHandout {
  /** @minimum 1 */
  attempt: number;
  data:
    | FLSignInCodeData
    | FLPasskeyData
    | FLAccountErasureData
    | FLBanData
    | FLGrantData
    | FLAddressChangeLinkData
    | FLAddressChangeNoticeData
    | FLAddressChangeEffectiveData
    | FLAddressChangeDiscardedData
    | FLSchiedsrichterConfirmationData
    | FLSpielRequestData
    | FLSpielEinteilungData
    | FLSpielMovedData
    | FLSpielNoticeData
    | FLSpielEinteilungLiftedData
    | FLSpielVorschlagDiscardedData
    | FLAufstellungReminderData
    | FLAustrittNoticeData
    | FLRegistrierungLinkData
    | FLRegistrierungAbsageData
    | FLInvitationData
    | FLBewerbungLinkData
    | FLBewerbungReceivedData
    | FLBewerbungZusageData
    | FLBewerbungAbsageData
    | FLDeletionNoticeData
    | FLBewerbungObjectionData
    | FLKontaktLinkData;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  secret: string | null;
  to: string;
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
  held: "held",
} as const;

/**
 * The outcome of one handed-out mail's send, reported as the send returns.
 */
export interface FLOutboxResultPayload {
  delivery_reason: string | null;
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
  held: number;
  /** @minimum 0 */
  ignored: number;
  /** @minimum 0 */
  repeated: number;
  /** @minimum 0 */
  sent: number;
}

/**
 * One mail of the sign-in library, owed to the address it names.
 */
export interface FLOutboxSignInPayload {
  data: FLSignInCodeData | FLPasskeyData | FLAccountErasureData | FLDeletionNoticeData;
  secret: string | null;
  /** @maxLength 254 */
  to: string;
  valid_until: string | null;
}

export type FLOverviewAnswerKind = (typeof FLOverviewAnswerKind)[keyof typeof FLOverviewAnswerKind];

export const FLOverviewAnswerKind = {
  spielbestaetigung_overdue: "spielbestaetigung_overdue",
  spielbestaetigung_due: "spielbestaetigung_due",
} as const;

export type FLOverviewBewerbungRowKind = (typeof FLOverviewBewerbungRowKind)[keyof typeof FLOverviewBewerbungRowKind];

export const FLOverviewBewerbungRowKind = {
  bewerbung: "bewerbung",
} as const;

/**
 * One undecided application to play the season, by its school's name and how many of its seats have confirmed.
 */
export interface FLOverviewBewerbungRow {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  bewerbung_id: string;
  kind: FLOverviewBewerbungRowKind;
  name: string;
  seats: number;
  seats_confirmed: number;
}

export type FLOverviewBracketFaultRowKind = (typeof FLOverviewBracketFaultRowKind)[keyof typeof FLOverviewBracketFaultRowKind];

export const FLOverviewBracketFaultRowKind = {
  bracket_fault: "bracket_fault",
} as const;

/**
 * The referee as the admin reads serve them: the whole name and the payment.
 */
export interface FLSpielSchiedsrichterField {
  name: string | null;
  /** @minimum 0 */
  payment: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * The venue as the admin reads serve it, the rent included.
 */
export interface FLSpielortField {
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
 * The same fixture for the admin reads: the referee as booked, whole name and payment, and the venue's rent.
 *
 * `version` counts the fixture's writes; a save sending it back is refused once another write has raised it.
 */
export interface FLSpielJoinedAdmin {
  ansetzung_confirmed: boolean | null;
  date: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  for_third_place: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  note: string | null;
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
  spielort: FLSpielortField | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  team1: FLSpielTeamFieldJoined | null;
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelle | null;
  time: string | null;
  version: number;
}

/**
 * One derived fault of the season's bracket or bookings, on the fixture it names.
 */
export interface FLOverviewBracketFaultRow {
  fault: FLBracketFault;
  kind: FLOverviewBracketFaultRowKind;
  spiel: FLSpielJoinedAdmin;
}

export type FLOverviewCardName = (typeof FLOverviewCardName)[keyof typeof FLOverviewCardName];

export const FLOverviewCardName = {
  due: "due",
  ergebnisse: "ergebnisse",
  dates: "dates",
  bewerbungen: "bewerbungen",
} as const;

export type FLOverviewSpielRowKind = (typeof FLOverviewSpielRowKind)[keyof typeof FLOverviewSpielRowKind];

export const FLOverviewSpielRowKind = {
  appointment_missing: "appointment_missing",
  ergebnis_missing: "ergebnis_missing",
  schiedsrichter_missing: "schiedsrichter_missing",
  spielort_missing: "spielort_missing",
  team_missing: "team_missing",
} as const;

/**
 * A fixture lacking what its kind names, or played and still without a result; its act is the match editor's.
 */
export interface FLOverviewSpielRow {
  kind: FLOverviewSpielRowKind;
  spiel: FLSpielJoinedAdmin;
}

export type FLOverviewSpielbestaetigungRowKind = (typeof FLOverviewSpielbestaetigungRowKind)[keyof typeof FLOverviewSpielbestaetigungRowKind];

export const FLOverviewSpielbestaetigungRowKind = {
  spielbestaetigung_due: "spielbestaetigung_due",
  spielbestaetigung_overdue: "spielbestaetigung_overdue",
} as const;

export interface FLSpielbestaetigungPartyTeam {
  kind: "team";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLSpielbestaetigungPartySchiedsrichter {
  kind: "schiedsrichter";
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

/**
 * One party's open confirmation row, a club's or the booked referee's: the row „Zusage eintragen“ records its agreement on.
 *
 * `name` is the one its own record holds, as each act's recipients are named, so the page names every party one way.
 */
export interface FLOverviewParty {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  /** @minLength 1 */
  name: string;
  party: FLSpielbestaetigungPartyTeam | FLSpielbestaetigungPartySchiedsrichter;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
}

/**
 * A fixture whose parties owe their answer: overdue where one party's deadline has passed, else due today.
 */
export interface FLOverviewSpielbestaetigungRow {
  kind: FLOverviewSpielbestaetigungRowKind;
  parties: FLOverviewParty[];
  spiel: FLSpielJoinedAdmin;
}

export interface FLSpielRecipientTeam {
  kind: "team";
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

export interface FLSpielRecipientSchiedsrichter {
  kind: "schiedsrichter";
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  schiedsrichter_id: string;
}

export type FLOverviewVorschlagRowKind = (typeof FLOverviewVorschlagRowKind)[keyof typeof FLOverviewVorschlagRowKind];

export const FLOverviewVorschlagRowKind = {
  vorschlag_open: "vorschlag_open",
} as const;

/**
 * A date and time without a ground: a team's proposal, and the slot a moved fixture left.
 */
export interface FLSpielbestaetigungAppointment {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  time: string;
}

/**
 * A club's decline proposing another date and hour, neither adopted nor discarded; its row is the one both acts write.
 *
 * Each act's recipients are the parties the backend mails of it, each by the name its own record holds, so its question
 * names them: `adoption_recipients` those the confirmation pass tells of the move, `discard_recipients` the club the
 * discard tells the date stands, none once its kick-off has come.
 */
export interface FLOverviewVorschlagRow {
  adoption_recipients: (FLSpielRecipientTeam | FLSpielRecipientSchiedsrichter)[];
  discard_recipients: (FLSpielRecipientTeam | FLSpielRecipientSchiedsrichter)[];
  kind: FLOverviewVorschlagRowKind;
  spiel: FLSpielJoinedAdmin;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  vorschlag: FLSpielbestaetigungAppointment;
}

export type FLOverviewSpielberichtRowKind = (typeof FLOverviewSpielberichtRowKind)[keyof typeof FLOverviewSpielberichtRowKind];

export const FLOverviewSpielberichtRowKind = {
  spielbericht_open: "spielbericht_open",
} as const;

export type FLSpielberichtOpenState = (typeof FLSpielberichtOpenState)[keyof typeof FLSpielberichtOpenState];

export const FLSpielberichtOpenState = {
  proposed: "proposed",
  differing: "differing",
  sides_changed: "sides_changed",
} as const;

/**
 * A report awaiting the administrator: not adopted, changed since its adoption, or written for other clubs.
 */
export interface FLOverviewSpielberichtRow {
  kind: FLOverviewSpielberichtRowKind;
  spiel: FLSpielJoinedAdmin;
  state: FLSpielberichtOpenState;
}

export type FLOverviewRow =
  | FLOverviewSpielRow
  | FLOverviewSpielbestaetigungRow
  | FLOverviewVorschlagRow
  | FLOverviewSpielberichtRow
  | FLOverviewBracketFaultRow
  | FLOverviewBewerbungRow;

/**
 * One card and its rows, a fixture once, ordered by `CARD_OF`'s kinds, then each fixture's day, undated last, then its number.
 */
export interface FLOverviewCard {
  card: FLOverviewCardName;
  rows: FLOverviewRow[];
}

export type FLOverviewGapKind = (typeof FLOverviewGapKind)[keyof typeof FLOverviewGapKind];

export const FLOverviewGapKind = {
  ergebnis_missing: "ergebnis_missing",
  appointment_missing: "appointment_missing",
  spielort_missing: "spielort_missing",
  schiedsrichter_missing: "schiedsrichter_missing",
  team_missing: "team_missing",
} as const;

/**
 * One season as a frame's season button lists it: its id and its span.
 */
export interface FLSaisonFrameEntry {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
}

/**
 * The seasons a signed-in person holds a row in, the newest first, which their own frame's season button offers.
 *
 * A season the public frame withholds, a planned one, is served as any other: the person's row in it is what the
 * frame leads to.
 */
export interface FLOwnSaisonsResponse {
  saisons: FLSaisonFrameEntry[];
}

export type FLOwnerWaitDays = 7;

/**
 * A seat holder's edit of a squad row.
 */
export interface FLPatchKaderRowPayload {
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  stufe: FLSpielerStufe | null;
  /** @minimum 0 */
  version: number;
}

/**
 * The application window as a season write sends it, judged apart from the season's own span: it may open before the season does.
 */
export interface FLSaisonBewerbungPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end: string;
  open: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start: string;
}

/**
 * When a pupil's entry is an ordinary one: from the season's activation to `end`, which falls before the season's start.
 *
 * No start of its own, the activation being the opening (`app/api/registrierungen/services.py ::
 * saison_takes_registrierungen`). Past `end` the link runs on until the season ends and an entry is a nominee
 * (`app/api/saisons/services.py :: entry_is_a_nominee`); `open` pauses the link alone. Its own model rather than an alias of
 * `FLSaisonBewerbung` above: the two windows are two decisions an administrator takes apart.
 */
export interface FLSaisonRegistrierung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end: string;
  open: boolean;
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
  /** @minimum 0 */
  loss_points: number;
  /**
   * @maximum 50
   * @exclusiveMinimum 0
   */
  max_kader_size: number;
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
  bewerbung: FLSaisonBewerbungPayload | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  /** @minimum 0 */
  version: number;
}

export interface FLPatchSaisonResponse {
  version: number;
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
  /** @minimum 0 */
  version: number;
}

/**
 * The confirmation link a write owed the referee, which the Postausgang mints and mails: never the link itself.
 */
export interface FLSchiedsrichterMint {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  /** @minLength 1 */
  email: string;
}

export interface FLPatchSchiedsrichterResponse {
  confirmation: FLSchiedsrichterMint | null;
  version: number;
}

/**
 * A shoot-out as a save sends it: a key beside the two counts is refused, never dropped.
 *
 * Its own model, since a model's configuration reaches none nested in it, and the stored one stays lenient for the
 * documents it reads.
 */
export interface FLSpielElfmeterschiessenPayload {
  /** @minimum 0 */
  team1: number;
  /** @minimum 0 */
  team2: number;
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

/**
 * The venue as the save sends it: which ground, and what this fixture pays for it.
 */
export interface FLSpielortFieldPayload {
  /** @minimum 0 */
  mietpreis: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielort_id: string;
}

/**
 * One side of a fixture as the save sends it: the team and its goals.
 *
 * A name sent is ignored: a side's name and shorthand are its season row's, joined at read.
 */
export interface FLSpielTeamFieldPayload {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  tore: number | null;
}

/**
 * A later fixture's stored result that a save deletes: its ground score, its shoot-out and a no-show, each null where it held none.
 */
export interface FLSpielVoidedResult {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @exclusiveMinimum 0 */
  spiel_nr: number;
  voided_elfmeterschiessen: FLSpielElfmeterschiessen | null;
  voided_ergebnis: string | null;
  voided_sonderereignis: FLSonderereignis | null;
}

export interface FLPatchSpielDataPayload {
  date: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessenPayload | null;
  note: string | null;
  schiedsrichter: FLSpielSchiedsrichterFieldPayload | null;
  sonderereignis: FLSonderereignis | null;
  spielort: FLSpielortFieldPayload | null;
  team1: FLSpielTeamFieldPayload | null;
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldPayload | null;
  team2_quelle: FLSpielQuelle | null;
  time: string | null;
  /** @minimum 0 */
  version: number;
  voided_results?: FLSpielVoidedResult[];
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
  side: FLSpielSide;
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
 * Every fixture the save moved beyond its own edit, each with the result it destroyed.
 *
 * `version` is the fixture's own after the save, the one its next save sends. `recipients`, on a `dry_run` alone and
 * null on a save, is every party the confirmation pass mails about this fixture once it is saved so, and would not as
 * it stands: told of the move, of the referee taken off it, or of its call-off, each by its name.
 * `voided_results` is every later result among those fixtures the save deletes, each once, in their numbers' order:
 * the set a save names in its body to delete them.
 */
export interface FLPatchSpielDataResponse {
  advanced_to: FLSpielAdvancement[];
  recipients: (FLSpielRecipientTeam | FLSpielRecipientSchiedsrichter)[] | null;
  released_sides: FLSpielReleasedSide[];
  version: number;
  voided_results: FLSpielVoidedResult[];
}

/**
 * The Spieler editor's one save: the person, and their squad row in the season the page stands under.
 *
 * Replaced wholesale, as `_KaderRowFields` is. No consent and no address: each is the person's own to change.
 */
export interface FLPatchSpielerSaisonPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  birth_date: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  first_name: string;
  last_name: string | null;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  stufe: FLSpielerStufe | null;
  /** @minimum 0 */
  version: number;
}

/**
 * The count the editor's next save sends.
 */
export interface FLPatchSpielerSaisonResponse {
  /** @minimum 0 */
  version: number;
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
  /** @minimum 0 */
  version: number;
}

export interface FLPatchSpielortResponse {
  version: number;
}

export interface FLPatchSpieltagPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start: string;
  /** @minimum 0 */
  version: number;
}

/**
 * The team editor's one save: the club, and its colour and group in the season the page stands under.
 *
 * Replaced wholesale. No seat and no `austritt`: a seat is its dialog's, and an exit is the
 * danger box's own write, which owes mail.
 */
export interface FLPatchTeamSaisonPayload {
  address: FLAddressPayload;
  /** @maxLength 4096 */
  description: string;
  /**
   * @minLength 1
   * @maxLength 120
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  full_name: string;
  gruppe: FLGruppenNames;
  /**
   * @minLength 1
   * @maxLength 60
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  name: string;
  schulform: FLSchulform | null;
  /** @pattern ^\s*[A-Za-z]{3}\s*$ */
  shorthand: string;
  trikot_farbe: FLTrikotFarbe | null;
  /** @minimum 0 */
  version: number;
  website_url: string | null;
}

/**
 * The count the editor's next save sends.
 */
export interface FLPatchTeamSaisonResponse {
  /** @minimum 0 */
  version: number;
}

export interface FLPostBanListEntryPayload {
  /**
   * @minLength 1
   * @maxLength 500
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  ban_reason: string;
  /** @maxLength 254 */
  email: string;
  notify: boolean;
}

export interface FLPostBanListEntryResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  created_id: string;
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
  first_name: string;
  /**
   * @minLength 1
   * @maxLength 80
   * @pattern ^\p{L}[\p{L}\-' ]*$
   */
  last_name: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  stufe: FLSpielerStufe | null;
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
}

/**
 * The stored registration, the one a replayed key wrote first; its confirmation mail is owed in the same write.
 */
export interface FLPostRegistrierungResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
}

export interface FLPostSaisonPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
}

export interface FLPostSaisonResponse {
  created_id: string;
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

/**
 * One club's entry into a season, the club known or new. One field rather than two nullable ones, so no body names both.
 */
export interface FLPostTeamEntryPayload {
  club: FLEntryKnownClub | FLEntryNewClub;
  gruppe: FLGruppenNames;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * The club the entry wrote a row for, whose editor the list opens.
 */
export interface FLPostTeamEntryResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
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

/**
 * One pending registration as the Registrierungen list shows it: the pupil's name and nothing else of them.
 */
export interface FLRegistrierungAdminRow {
  confirmed: boolean;
  /** @minLength 1 */
  first_name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  last_name: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  submitted_at: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string | null;
  unmailed: boolean;
}

/**
 * The squad entry the admission wrote, and the person it belongs to.
 */
export interface FLRegistrierungAdmissionResponse {
  /** @minLength 1 */
  first_name: string;
  is_nachnominiert: boolean;
  /** @minLength 1 */
  last_name: string;
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
}

/**
 * The team's answer to the question the read asked: the person this registration is admitted into, or none.
 */
export interface FLRegistrierungAdmitPayload {
  spieler_id: string | null;
}

export type FLRegistrierungConfirmationDeadlineDays = 14;

/**
 * One pupil's own answer: their date of birth and the two consents.
 */
export interface FLRegistrierungConfirmationPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  birth_date: string;
  media: boolean;
  scope: FLEinwilligungScope;
  text_versions: FLSpielerTextVersions;
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
}

/**
 * What the pupil just recorded, echoed so the answer panel states it rather than opening the link a second time.
 */
export interface FLRegistrierungConfirmationResponse {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  birth_date: string;
  media: boolean;
  outcome: "confirmed";
  scope: FLEinwilligungScope;
}

/**
 * What one confirmation link opens, and no field past the ones declared here.
 */
export interface FLRegistrierungConfirmationViewResponse {
  answered_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  /** @exclusiveMinimum 0 */
  maximum_age: number;
  minimum_age: number;
  saison_id: string;
  /** @minLength 1 */
  schule: string;
  state: FLConfirmationState;
  /** @minLength 1 */
  team: string;
}

/**
 * Why the team declines, from a closed set or not at all.
 */
export interface FLRegistrierungDeclinePayload {
  reason: "other_person" | null;
}

/**
 * The declined registration, and the first name the seat holder is told the decision by.
 */
export interface FLRegistrierungDeclineResponse {
  /** @minLength 1 */
  first_name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
}

export type FLRegistrierungMinAgeYears = 16;

/**
 * One season's pass: the erasures made, each committed.
 */
export interface FLRegistrierungSweepResponse {
  erased_declined: number;
  erased_unconfirmed: number;
  erased_without_decision: number;
  failed: number;
  saison_id: string;
}

/**
 * One season's pending registrations, newest first.
 */
export interface FLRegistrierungenAdminListResponse {
  complete: boolean;
  registrierungen: FLRegistrierungAdminRow[];
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
  gruppe: FLGruppenNames;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  incoming_team_id: string;
  kontakte: FLSaisonTeamKontakte | null;
  /** @minLength 1 */
  name: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  outgoing_team_id: string;
  retired_kader_rows: number;
  rewritten_spiele: number;
  saison_id: string;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * When the league accepts applications for this season: while today lies between `start` and `end`, both included.
 *
 * `open` pauses the form alone, its dates untouched and the applications already received staying in triage, as
 * `FLSaisonRegistrierung.open` pauses a link (`app/api/bewerbungen/services.py :: saison_takes_bewerbungen`).
 */
export interface FLSaisonBewerbung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end: string;
  open: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start: string;
}

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

export interface FLSaison {
  bewerbung: FLSaisonBewerbung | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  id: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  schedule: FLSaisonPhaseSchedule[];
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  status: FLSaisonStatus;
  version: number;
}

/**
 * Why each of the editor's season acts would be refused if pressed now, judged by its write's own rules; null where it takes it.
 *
 * `activate` and `undraw` are their writes' whole judgement. `create` and `recreate` are the draw's judgement of the
 * stored rules the editor's presses draw, over the clubs entered, `recreate` then the reports it would delete.
 */
export interface FLSaisonActRefusals {
  activate: Code | null;
  create: Code | null;
  recreate: Code | null;
  undraw: Code | null;
}

/**
 * The same season for the admin surfaces, with whether it has started and whether a fixture of it has taken place.
 */
export interface FLSaisonAdmin {
  begun: boolean;
  bewerbung: FLSaisonBewerbung | null;
  decided: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  id: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  schedule: FLSaisonPhaseSchedule[];
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  status: FLSaisonStatus;
  taken_place: boolean;
  version: number;
}

/**
 * A club a replacement may bring into the season: one still in the league that holds no row of it.
 */
export interface FLSaisonAdminIncomingTeam {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  name: string;
  shorthand: string;
}

/**
 * One season as the admin list shows it: the editor's season and how many clubs and matches it holds.
 */
export interface FLSaisonAdminListed {
  begun: boolean;
  bewerbung: FLSaisonBewerbung | null;
  /** @minimum 0 */
  count_spiele: number;
  /** @minimum 0 */
  count_teams: number;
  decided: boolean;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  end_date: string;
  id: string;
  registrierung: FLSaisonRegistrierung | null;
  rules: FLSaisonRules;
  schedule: FLSaisonPhaseSchedule[];
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  status: FLSaisonStatus;
  taken_place: boolean;
  version: number;
}

/**
 * A season's Spielplan as every write judges it: the matchdays and fixtures it holds, and the day the draw wrote them.
 *
 * Counted per read off the stored rows, the facts a first draw refuses on (`spielplan_already_drawn`,
 * `spielplan_spieltage_held`) and the undraw and the replace remove, so the editor shows the draw's acts exactly where
 * those writes take them. `generated_at` is the draw's own day, `null` on a season whose rows no draw dated.
 */
export interface FLSaisonDrawn {
  generated_at: string | null;
  /** @minimum 0 */
  spiele: number;
  /** @minimum 0 */
  spieltage: number;
}

/**
 * One club's row of the season as the editor's swap and replacement sections list it, graded as each write judges it.
 *
 * Both flags are `app/api/teams/services.py :: has_taken_place` over the row's fixtures, the predicate each write's
 * refusal reads: over its group fixtures for the swap's `swap_sides_taken_place`, the swap rewriting those alone, so
 * a pair is closed where either club's is; over every fixture for the replacement's `replace_sides_taken_place`, the
 * replacement handing the whole schedule over.
 */
export interface FLSaisonAdminTeam {
  austritt: FLAustritt | null;
  group_spiel_taken_place: boolean;
  gruppe: FLGruppenNames;
  name: string;
  shorthand: string;
  spiel_taken_place: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * What the season editor shows, in one read: its season, clubs, shapes and matchdays, its acts' states and its registration links.
 *
 * `shapes` is every shape the season's other rules admit, judged as the draw judges a shape it is given;
 * `spielplan` is the Spielplan the season holds, `null` while it holds no matchday and no fixture; `invitations`
 * holds one row per club, in `teams`' order.
 */
export interface FLSaisonAdminResponse {
  incoming_teams: FLSaisonAdminIncomingTeam[];
  invitations: FLInvitationLinkRow[];
  refusals: FLSaisonActRefusals;
  saison: FLSaisonAdmin;
  shapes: FLSpielplanShape[];
  spielplan: FLSaisonDrawn | null;
  teams: FLSaisonAdminTeam[];
}

/**
 * Every season the public may read, the newest first, and the one the site is on.
 *
 * `active_saison_id` is null for a league no season has been activated in; a season stays active, finished or not,
 * until the next is activated.
 */
export interface FLSaisonFrameResponse {
  active_saison_id: string | null;
  saisons: FLSaisonFrameEntry[];
}

export interface FLSaisonOverviewResponse {
  cards: FLOverviewCard[];
}

/**
 * One seat's link as the contacts editor reads it: the stored link and whether it has lapsed.
 */
export interface FLSaisonTeamConfirmationView {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  declined_at: string | null;
  delivery: FLOutboxStatus | null;
  expired: boolean;
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
export interface FLSaisonTeamEinwilligungAnswerResponse {
  birth_date: string | null;
  media: boolean;
  outcome: FLEinwilligungOutcome;
  quelle: "saison";
  whatsapp: boolean;
}

/**
 * A season's clubs, by name.
 */
export interface FLSaisonTeamsResponse {
  teams: FLSaisonTeamEntry[];
}

/**
 * Why the list's act would be refused if pressed now, by its write's own judgement; null where it takes it.
 */
export interface FLSaisonsAdminRefusals {
  create: Code | null;
}

/**
 * Every season, with the id the next create mints and why a create would be refused now.
 */
export interface FLSaisonsAdminListResponse {
  format: "list";
  /**
   * @minLength 4
   * @maxLength 4
   */
  next_saison_id: string;
  refusals: FLSaisonsAdminRefusals;
  saisons: FLSaisonAdminListed[];
}

export interface FLSaisonsSingleResponse {
  format: "single";
  saison: FLSaison;
}

/**
 * A referee's confirmation bookkeeping as an administrator reads it, the objection's day with it.
 */
export interface FLSchiedsrichterConfirmation {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  declined_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  sent_at: string;
}

export interface FLSchiedsrichter {
  birth_date: string | null;
  confirmation: FLSchiedsrichterConfirmation | null;
  /** @minimum 0 */
  default_payment: number;
  einwilligung: FLEinwilligung | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  kontakt: FLKontakt;
  name: string | null;
  schule: string | null;
  version: number;
}

/**
 * A referee's two wordings: the name on the fixtures and the media switch.
 */
export interface FLSchiedsrichterTextVersions {
  media: FLCitedMediaTextVersion;
  scope: FLSchiedsrichterScopeTextVersion;
}

/**
 * A referee's own two choices on their record.
 */
export interface FLSchiedsrichterAccountEinwilligungPayload {
  evidence_state: FLEinwilligungStatePayload;
  media: boolean;
  scope: FLEinwilligungScope;
  text_versions: FLSchiedsrichterTextVersions;
}

export type FLSchiedsrichterConfirmationDeadlineDays = 14;

export interface FLSchiedsrichterConfirmationPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  birth_date: string;
  media: boolean;
  scope: FLEinwilligungScope;
  text_versions: FLSchiedsrichterTextVersions;
  /**
   * @minLength 1
   * @maxLength 128
   * @pattern ^[^\x00\n\v\f\r\u0085\u2028\u2029]*$
   */
  token: string;
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
  media: boolean;
  scope: FLEinwilligungScope;
}

export type FLSchiedsrichterConfirmationState = (typeof FLSchiedsrichterConfirmationState)[keyof typeof FLSchiedsrichterConfirmationState];

export const FLSchiedsrichterConfirmationState = {
  valid: "valid",
  confirmed: "confirmed",
  declined: "declined",
  expired: "expired",
} as const;

/**
 * What one confirmation link opens, and nothing a leaked one should not learn (`READ-REFEREE-002`).
 *
 * Never a name, the school, the contact details, the fee, the birthdate or the id.
 */
export interface FLSchiedsrichterConfirmationViewResponse {
  answered_at: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  /** @exclusiveMinimum 0 */
  maximum_age: number;
  minimum_age: number;
  state: FLSchiedsrichterConfirmationState;
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

export interface FLSchiedsrichterSingleResponse {
  confirmation_expired: boolean;
  delivery: FLOutboxStatus | null;
  schiedsrichter: FLSchiedsrichter;
}

export type FLSchiedsrichterSpielState = (typeof FLSchiedsrichterSpielState)[keyof typeof FLSchiedsrichterSpielState] | null;

export const FLSchiedsrichterSpielState = {
  valid: "valid",
  agreed: "agreed",
  declined: "declined",
  expired: "expired",
  invalid: "invalid",
  cancelled: "cancelled",
} as const;

/**
 * One fixture booked to the signed-in referee, as their one list shows it: the booking they were asked about and the report they owe.
 */
export interface FLSchiedsrichterSpiel {
  date: string | null;
  entered: boolean;
  past: boolean;
  reason: string | null;
  reportable: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  spielbestaetigung_id: string | null;
  spielort: FLSpielortFieldPublic | null;
  state: FLSchiedsrichterSpielState;
  submitted_at: string | null;
  team1_name: string | null;
  team2_name: string | null;
  time: string | null;
}

/**
 * A referee's fixtures of one season, open work first.
 */
export interface FLSchiedsrichterSpieleResponse {
  saison_id: string;
  spiele: FLSchiedsrichterSpiel[];
}

/**
 * One pass of the unconfirmed entries' clock: the entries it erased and the ones it passed over, which stay due.
 */
export interface FLSchiedsrichterSweepResponse {
  erased: number;
  failed: number;
}

/**
 * A seat holder's own two choices for every seat they hold on one row, under any label their kind cites.
 *
 * Both choices on every press: a page that sent one alone would leave the other judged by nothing.
 */
export interface FLSeatEinwilligungPayload {
  evidence_state: FLEinwilligungStatePayload;
  media: boolean;
  scope: FLKontaktKenntnisnahmeScope;
  text_versions: FLSeatTextVersions;
}

/**
 * The sign-in gate's whole answer: the records' two flags, the ban and the grant, and no record itself.
 *
 * The ban narrows neither flag: whether a barred person signs in is the gate's to decide.
 */
export interface FLSignInResponse {
  account: boolean;
  admin_tier: FLAdminTier | null;
  barred: boolean;
  unconfirmed: boolean;
}

export type FLSignatoryMinAgeYears = 18;

/**
 * Each side's line-up as the editor's line states it, the club the fixture fields there now; null where it has stored none.
 */
export interface FLSpielEditorAufstellungen {
  team1: FLAufstellungSummary | null;
  team2: FLAufstellungSummary | null;
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
 * Each count is the entries credited to that side, written by the report's save and sent by no form. Both null on a
 * no-show alone: the save composes its goals from the season's forfeit, which counted goals could never equal.
 */
export interface FLSpielberichtVorschlag {
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  sonderereignis: FLSpielberichtVorschlagSonderereignis;
  team1_tore: number | null;
  team2_tore: number | null;
}

/**
 * A pupil a report may name or names, with the names their record holds, both null where an erasure took the record.
 */
export interface FLSpielberichtSpieler {
  first_name: string | null;
  last_name: string | null;
  nummer: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
}

/**
 * One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one.
 */
export interface FLSpielberichtScorer {
  eigentor: boolean;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  side: FLSpielSide;
  spieler_id: string | null;
}

/**
 * The clubs the fixture fielded at the block's last write, null on a slot then open.
 *
 * Stamped by every write and on no payload: entries go by side, and a knockout correction can re-field one.
 */
export interface FLSpielberichtSides {
  team1: string | null;
  team2: string | null;
}

export type FLSpielberichtState = (typeof FLSpielberichtState)[keyof typeof FLSpielberichtState];

export const FLSpielberichtState = {
  proposed: "proposed",
  adopted: "adopted",
  differing: "differing",
  cancelled: "cancelled",
  sides_changed: "sides_changed",
} as const;

/**
 * The fixture's report as the editor's Spielbericht section shows it: its goals and the result they propose.
 *
 * `version` is the report document's, the one an adoption names (`adopts_bericht`), `sides` the clubs the report is
 * about, and `named` each pupil a goal names, by the names their record holds.
 */
export interface FLSpielEditorBericht {
  ergebnis_vorschlag: FLSpielberichtVorschlag;
  named: FLSpielberichtSpieler[];
  scorers: FLSpielberichtScorer[];
  sides: FLSpielberichtSides;
  state: FLSpielberichtState;
  version: number;
}

/**
 * A referee the editor offers: their whole name, the fee they default to, how they answered their entry, and the day they retired.
 */
export interface FLSpielEditorSchiedsrichter {
  confirmed: boolean;
  declined: boolean;
  /** @minimum 0 */
  default_payment: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  /** @minLength 1 */
  name: string;
}

/**
 * A venue the editor offers: its name, the rent it defaults to, and the day it retired, null while it serves.
 */
export interface FLSpielEditorSpielort {
  /** @minimum 0 */
  default_mietpreis: number;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  /** @minLength 1 */
  name: string;
}

/**
 * A club a knockout fixture's Begegnung offers for either side, by the name and shorthand its season row holds.
 *
 * `on_spieltag`: the club stands on another fixture of this matchday, which a save fielding it here either moves it
 * off or is refused for. `fieldable`: a save fielding it on this fixture as it stands passes the write's eligibility
 * and occupancy rules (`find_eligibility_refusal`, `judge_spieltag_occupancy`), judged on the side it already holds.
 */
export interface FLSpielEditorTeam {
  fieldable: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
  on_spieltag: boolean;
  /** @minLength 1 */
  shorthand: string;
}

/**
 * One pupil an entry names, as the base tier serves them; no record id (`READ-PUPIL-005`).
 *
 * The names only where `type` is `named`, the surname as an initial (`READ-PUPIL-001`); the number and position off
 * the pupil's squad row for that side's club in the match's season, kept where the name is withheld.
 */
export interface FLSpielberichtSpielerPublic {
  first_name: string | null;
  last_name: string | null;
  nummer: string | null;
  position: FLSpielerPosition | null;
  type: FLSpielberichtSpielerType;
}

/**
 * One card, `side` its player's club.
 */
export interface FLSpielberichtCardPublic {
  colour: FLCardColour;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  side: FLSpielSide;
  spieler: FLSpielberichtSpielerPublic;
}

/**
 * One goal: `side` is the scorer's own club, and an own goal (`eigentor`) counts for the other one.
 */
export interface FLSpielberichtScorerPublic {
  eigentor: boolean;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  side: FLSpielSide;
  spieler: FLSpielberichtSpielerPublic;
}

/**
 * What the public may read of one match's report.
 *
 * The scorers and the cards only while the referee's report reads `adopted` -- adopted, unchanged since, and
 * matching the result -- each by minute; null otherwise, which is "not official yet" where an empty list is "nobody
 * scored".
 */
export interface FLSpielberichtPublic {
  cards: FLSpielberichtCardPublic[] | null;
  scorers: FLSpielberichtScorerPublic[] | null;
}

/**
 * Where one side of a group match stands in the Tabelle: its group, and its `platz`, null while it holds none.
 */
export interface FLSpielSideStanding {
  gruppe: FLGruppenNames;
  platz: number | null;
}

/**
 * Each side's place in the Tabelle on a group match.
 *
 * Null on a knockout match, whose round is the match's own phase, and for a side the groups do not list.
 */
export interface FLSpielSideStandings {
  team1: FLSpielSideStanding | null;
  team2: FLSpielSideStanding | null;
}

/**
 * One match as its page and its pop-up show it.
 *
 * The match, its matchday's `position` and its phase's count of matchdays, which together name the matchday, where
 * each side stands, each side's line-up from the moment its club stores one, and what the public may read of its
 * report, null where none is stored.
 */
export interface FLSpielPageResponse {
  aufstellungen: FLAufstellungenPublic;
  bericht: FLSpielberichtPublic | null;
  /** @minimum 1 */
  count_spieltage_in_phase: number;
  spiel: FLSpielJoined;
  /** @minimum 1 */
  spieltag_position: number;
  standings: FLSpielSideStandings;
}

/**
 * One card: who was shown it, when, and its colour.
 *
 * A null `spieler_id` is a player nobody named and nothing else, as a scorer's is: a side whose club holds no squad
 * still takes cards.
 */
export interface FLSpielberichtCard {
  colour: FLCardColour;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  side: FLSpielSide;
  spieler_id: string | null;
}

/**
 * The referee's account of one match, one proposal, a correction after its adoption reading `differing`.
 */
export interface FLSpielberichtBericht {
  adopted: boolean;
  cards: FLSpielberichtCard[];
  ergebnis_vorschlag: FLSpielberichtVorschlag;
  remarks: string | null;
  scorers: FLSpielberichtScorer[];
  sides: FLSpielberichtSides;
  submitted_at: string;
}

/**
 * One card as the referee's save sends it: a key the card does not declare is refused, never dropped.
 */
export interface FLSpielberichtCardPayload {
  colour: FLCardColour;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  side: FLSpielSide;
  spieler_id: string | null;
}

export type FLSpielberichtVorschlagPayloadSonderereignis =
  (typeof FLSpielberichtVorschlagPayloadSonderereignis)[keyof typeof FLSpielberichtVorschlagPayloadSonderereignis] | null;

export const FLSpielberichtVorschlagPayloadSonderereignis = {
  abgebrochen: "abgebrochen",
  nichtantreten_team1: "nichtantreten_team1",
  nichtantreten_team2: "nichtantreten_team2",
} as const;

/**
 * What the referee proposes beside the goals: a shoot-out, or the event the match ended in.
 */
export interface FLSpielberichtVorschlagPayload {
  elfmeterschiessen: FLSpielElfmeterschiessenPayload | null;
  sonderereignis: FLSpielberichtVorschlagPayloadSonderereignis;
}

/**
 * One goal as the referee's save sends it: a key the goal does not declare is refused, never dropped.
 */
export interface FLSpielberichtScorerPayload {
  eigentor: boolean;
  /** @pattern ^[0-9]{1,3}(\+[0-9]{1,2})?$ */
  minute: string;
  side: FLSpielSide;
  spieler_id: string | null;
}

export interface FLSpielberichtBerichtPayload {
  /** @maxItems 60 */
  cards: FLSpielberichtCardPayload[];
  ergebnis_vorschlag: FLSpielberichtVorschlagPayload;
  remarks: string | null;
  /** @maxItems 60 */
  scorers: FLSpielberichtScorerPayload[];
}

/**
 * Each side's live squad of the season, the pupils a new entry may name.
 */
export interface FLSpielberichtKader {
  team1: FLSpielberichtSpieler[];
  team2: FLSpielberichtSpieler[];
}

/**
 * The whole `bericht` block, written wholesale by the referee's PUT.
 */
export interface FLSpielberichtPayload {
  bericht: FLSpielberichtBerichtPayload;
  version: number | null;
}

/**
 * The fixture a report is about, as its form states it: no money, no booking, no result.
 */
export interface FLSpielberichtSpiel {
  date: string | null;
  saison_id: string;
  saison_phase: FLSaisonPhase;
  sonderereignis: FLSonderereignis | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  spielort: FLSpielortFieldPublic | null;
  team1: FLSpielberichtTeam | null;
  team2: FLSpielberichtTeam | null;
  time: string | null;
}

/**
 * The booked referee's form, the stored remarks included.
 */
export interface FLSpielberichtSchiedsrichterResponse {
  bericht: FLSpielberichtBericht | null;
  completed: boolean;
  kader: FLSpielberichtKader;
  named: FLSpielberichtSpieler[];
  reportable: boolean;
  sides_changed: FLSpielSide[];
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
 * The Ansetzung a row answers about: every input of `digest`, stored beside it.
 *
 * A digest is opaque to an aggregation, so the public fixture's verdict compares these five values
 * rather than `digest` (`app/api/spielbestaetigungen/services.py :: ANSETZUNG_QUELLEN`).
 */
export interface FLSpielbestaetigungAnsetzung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  digest: string;
  spielort_id: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team1_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team2_id: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  time: string;
}

export type FLSpielbestaetigungByKontaktKind = (typeof FLSpielbestaetigungByKontaktKind)[keyof typeof FLSpielbestaetigungByKontaktKind];

export const FLSpielbestaetigungByKontaktKind = {
  kontakt: "kontakt",
} as const;

/**
 * The seat its holder answered from, never the person: of two seats one person holds, the first in order is recorded.
 */
export interface FLSpielbestaetigungByKontakt {
  kind: FLSpielbestaetigungByKontaktKind;
  rolle: FLKontaktRolle;
}

export type FLSpielbestaetigungBySchiedsrichterKind =
  (typeof FLSpielbestaetigungBySchiedsrichterKind)[keyof typeof FLSpielbestaetigungBySchiedsrichterKind];

export const FLSpielbestaetigungBySchiedsrichterKind = {
  schiedsrichter: "schiedsrichter",
} as const;

export interface FLSpielbestaetigungBySchiedsrichter {
  kind: FLSpielbestaetigungBySchiedsrichterKind;
}

export type FLSpielbestaetigungBy = FLSpielbestaetigungByKontakt | FLByAdmin | FLSpielbestaetigungBySchiedsrichter;

export type FLSpielbestaetigungAnswerKind = (typeof FLSpielbestaetigungAnswerKind)[keyof typeof FLSpielbestaetigungAnswerKind];

export const FLSpielbestaetigungAnswerKind = {
  agreed: "agreed",
  declined: "declined",
} as const;

/**
 * Written once, while the row is open: a second press finds the row answered and changes nothing.
 */
export interface FLSpielbestaetigungAnswer {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  at: string;
  by: FLSpielbestaetigungBy;
  kind: FLSpielbestaetigungAnswerKind;
  reason: string | null;
  vorschlag: FLSpielbestaetigungAppointment | null;
}

export type FLSpielbestaetigungClosedReason = (typeof FLSpielbestaetigungClosedReason)[keyof typeof FLSpielbestaetigungClosedReason];

export const FLSpielbestaetigungClosedReason = {
  ansetzung_changed: "ansetzung_changed",
  austritt: "austritt",
  spiel_decided: "spiel_decided",
  cancelled: "cancelled",
  schiedsrichter_switched: "schiedsrichter_switched",
  schiedsrichter_declined: "schiedsrichter_declined",
  discarded: "discarded",
  spiel_past: "spiel_past",
} as const;

export interface FLSpielbestaetigungClosed {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  at: string;
  reason: FLSpielbestaetigungClosedReason;
}

/**
 * One party's confirmation of one Ansetzung, as an administrator reads it.
 *
 * The close reaches an answered row too, so an agreement a move overtook records why it stopped
 * applying (`app/api/spielbestaetigungen/services.py :: build_closable_filter`).
 */
export interface FLSpielbestaetigung {
  ansetzung: FLSpielbestaetigungAnsetzung;
  answer: FLSpielbestaetigungAnswer | null;
  asked_at: string | null;
  closed: FLSpielbestaetigungClosed | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  party: FLSpielbestaetigungPartyTeam | FLSpielbestaetigungPartySchiedsrichter;
  reminded_at: string | null;
  saison_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
}

/**
 * What the answer recorded: its way, the seat it came from, and the answering club's own proposal. No receipt is mailed off it.
 */
export interface FLSpielbestaetigungAnswerResponse {
  answered_by: FLSpielbestaetigungBy;
  state: FLSpielbestaetigungAnswerKind;
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
   * @pattern ^[^\x00\v\f\u0085\u2028\u2029]*$
   */
  reason: string;
}

/**
 * A referee's answer about one row naming them: a decline gives a reason, which the administrator reads.
 */
export interface FLSpielbestaetigungSchiedsrichterAnswerPayload {
  answer: FLSpielbestaetigungAnswerKind;
  reason: string | null;
}

export interface FLSpielbestaetigungSchiedsrichterAnswerResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  state: FLSpielbestaetigungAnswerKind;
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

export interface FLSpielbestaetigungVorschlagPayload {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  time: string;
}

/**
 * One club's answer about one Ansetzung, from whichever of its seats presses first.
 */
export interface FLSpielbestaetigungTeamAnswerPayload {
  answer: FLSpielbestaetigungAnswerKind;
  reason: string | null;
  vorschlag: FLSpielbestaetigungVorschlagPayload | null;
}

export type FLSpielbestaetigungTeamState = (typeof FLSpielbestaetigungTeamState)[keyof typeof FLSpielbestaetigungTeamState];

export const FLSpielbestaetigungTeamState = {
  valid: "valid",
  vorschlag: "vorschlag",
  expired: "expired",
  agreed: "agreed",
  declined: "declined",
} as const;

/**
 * The clubs, the day, the hour and the ground a page or a message states, the fixture's as it stands.
 */
export interface FLSpielbestaetigungViewAnsetzung {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  date: string;
  spielort: FLSpielortFieldPublic | null;
  team1_name: string;
  team2_name: string;
  /** @pattern ^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$ */
  time: string;
}

/**
 * The rows newest first, closed ones included.
 */
export interface FLSpielbestaetigungenListResponse {
  complete: boolean;
  spielbestaetigungen: FLSpielbestaetigung[];
}

/**
 * One fixture for the match editor, money and `version` included, and all its sections offer and show beside it.
 *
 * `saison_status` on the response rather than on the fixture: the editor alone asks it, to open a finished season's
 * match read-only, which the save refuses (`saison_past`), and a fixture carries no season-scoped state.
 */
export interface FLSpieleAdminSingleResponse {
  aufstellungen: FLSpielEditorAufstellungen;
  saison_status: FLSaisonStatus;
  schiedsrichter: FLSpielEditorSchiedsrichter[];
  spiel: FLSpielJoinedAdmin;
  spielbericht: FLSpielEditorBericht | null;
  spielbestaetigungen: FLSpielbestaetigung[];
  spielorte: FLSpielEditorSpielort[];
  teams: FLSpielEditorTeam[] | null;
}

export interface FLSpieleSingleResponse {
  spiel: FLSpielJoined;
}

/**
 * One matchday as the administrator's Spiele list shows it, its matches in the admin shape.
 */
export interface FLSpielplanSpieltagAdmin {
  /** @minimum 0 */
  count_spiele: number;
  end: string | null;
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
  spiele: FLSpielJoinedAdmin[];
  start: string | null;
  version: number;
}

/**
 * A season's matchdays and knockout rounds in playing order, matches in the admin shape, and the one to open on.
 *
 * `current_spieltag_id` is the Spielplan's own: the first matchday holding a match still to be played, else the last;
 * in a finished season, the last. Null for a season with no matchday.
 */
export interface FLSpieleSpielplanAdminResponse {
  current_spieltag_id: string | null;
  spieltage: FLSpielplanSpieltagAdmin[];
}

/**
 * One squad row as the Spieler list shows it: the person's name and nothing else of them.
 */
export interface FLSpielerAdminRow {
  /** @minLength 1 */
  first_name: string;
  inactive_since: string | null;
  is_nachnominiert: boolean;
  last_name: string | null;
  nummer: string | null;
  nummer_double: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string | null;
}

/**
 * One season's squad rows, every team's, live and ausgetragen alike, sorted by name.
 */
export interface FLSpielerAdminListResponse {
  spieler: FLSpielerAdminRow[];
}

/**
 * One squad row as the BASE TIER serves it -- all an anonymous visitor may read.
 *
 * `build_spieler_pipeline` withholds the rest: the surname is an initial (`READ-PUPIL-001`), the
 * `stufe` is gone (`READ-PUPIL-002`), and the consent record with it.
 */
export interface FLSpielerPublic {
  first_name: string | null;
  last_name: string | null;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
}

/**
 * The squad row the editor stands on, with the name its club plays the season under.
 */
export interface FLSpielerSaisonKader {
  inactive_since: string | null;
  is_nachnominiert: boolean;
  nummer: string | null;
  position: FLSpielerPosition | null;
  rolle: FLSpielerRolle | null;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string | null;
}

/**
 * The person as the editor shows them: their own record, which outlives the season.
 */
export interface FLSpielerSaisonPerson {
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  birth_date: string;
  einwilligung: FLEinwilligung;
  email: string;
  /** @minLength 1 */
  first_name: string;
  last_name: string | null;
}

/**
 * What the Spieler editor shows in one read: the person, their row of the season, and what its boxes may offer.
 */
export interface FLSpielerSaisonAdminResponse {
  /** @minItems 1 */
  allowed_stufen: FLSpielerStufe[];
  kader: FLSpielerSaisonKader;
  person: FLSpielerSaisonPerson;
  taken_rollen: FLSpielerRolle[];
  /** @minimum 0 */
  version: number;
}

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
 * One fixture of the pupil's club, with their own place in the club's line-up for it.
 */
export interface FLSpielerSaisonSelfSpiel {
  ansetzung_confirmed: boolean | null;
  /** @minimum 1 */
  count_spieltage_in_phase: number;
  date: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  for_third_place: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  note: string | null;
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
  spielort: FLSpielortFieldPublic | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  /** @minimum 1 */
  spieltag_position: number;
  starts: boolean | null;
  team1: FLSpielTeamFieldJoined | null;
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelle | null;
  time: string | null;
}

/**
 * A pupil's own season: where they play, and their club's fixtures.
 */
export interface FLSpielerSaisonSelfResponse {
  kader: FLSpielerSelfKaderRow | null;
  saison_id: string;
  spiele: FLSpielerSaisonSelfSpiel[];
}

/**
 * One player as the BASE TIER serves them -- an allow-list of what this surface needs.
 *
 * Squad fields are season-scoped, and inventing a season would make the answer depend on a default
 * nobody stated. `last_name` is an INITIAL here (`READ-PUPIL-001`).
 */
export interface FLSpielerSingleResponse {
  first_name: string | null;
  last_name: string | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieler_id: string;
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

/**
 * A season's matchdays in the order they are played, and the one the Spielplan opens on.
 *
 * `current_spieltag_id` is the first matchday holding a match still to be played, else the last; in a finished
 * season, the last. Null for a season with no matchday.
 */
export interface FLSpielplanResponse {
  current_spieltag_id: string | null;
  spieltage: FLSpielplanSpieltag[];
}

export interface FLSpieltag {
  /** @minimum 0 */
  count_spiele: number;
  end: string | null;
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
  start: string | null;
  version: number;
}

/**
 * A matchday as its editor reads it, with how many matchdays its phase holds, by which a page names a round's legs.
 */
export interface FLSpieltagAdmin {
  /** @minimum 0 */
  count_spiele: number;
  /** @minimum 1 */
  count_spieltage_in_phase: number;
  end: string | null;
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
  start: string | null;
  version: number;
}

/**
 * One matchday for its editor, and its season's status, by which the editor opens a finished season's read-only.
 *
 * On the response rather than on the matchday, as the match editor's read serves it: a matchday carries no
 * season-scoped state.
 */
export interface FLSpieltagAdminResponse {
  saison_status: FLSaisonStatus;
  spieltag: FLSpieltagAdmin;
}

export interface FLSpieltagWriteResponse {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  version: number;
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
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  saison_end_date: string;
  saison_id: string;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  saison_start_date: string;
  saison_status: FLSaisonStatus;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  team_name: string;
  team_shorthand: string;
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
 * Which confirmed, live records one mailbox matches, and the grant it holds.
 */
export interface FLSubjectResponse {
  admin_tier: FLAdminTier | null;
  granted_since: string | null;
  schiedsrichter: FLSubjectSchiedsrichter[];
  seats: FLSubjectSeat[];
  spieler: FLSubjectSpieler[];
  unconfirmed: boolean;
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

export interface FLTeamStatistik {
  /** @minimum 0 */
  count_cancelled_spiele: number;
  /** @minimum 0 */
  count_played_spiele: number;
  /** @minimum 0 */
  niederlagen: number;
  /** @minimum 0 */
  punkte: number;
  /** @minimum 0 */
  siege: number;
  /** @minimum 0 */
  tore_conceded: number;
  /** @minimum 0 */
  tore_scored: number;
  /** @minimum 0 */
  unentschieden: number;
}

/**
 * One row of the Tabelle: the standing row and its placing, null for a club with no match or gone before its group was decided.
 */
export interface FLTabelleRow {
  austritt_type: FLAustrittType | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
  platz: number | null;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  statistik: FLTeamStatistik;
}

/**
 * Every group the season offers in standing order, the clubs that have played no match last.
 *
 * Each club that has played and stood in the season on the day its group was decided is numbered as a `Platz` is, and
 * clubs the chain leaves level share one.
 */
export type FLTabelle = Partial<Record<FLGruppenNames, FLTabelleRow[]>>;

/**
 * One season's Tabelle: each group's standing over the group phase, and how many of each group advance.
 */
export interface FLTabelleResponse {
  gruppen: FLTabelle;
  /** @exclusiveMinimum 0 */
  qualifiers_per_gruppe: number;
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
 * A club the entry's picker offers: one still in the league that holds no row of the season.
 */
export interface FLTeamEntryClub {
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  name: string;
  shorthand: string;
}

/**
 * One group a season offers, closed where it is full.
 */
export interface FLTeamGruppeOffer {
  full: boolean;
  gruppe: FLGruppenNames;
}

/**
 * What the list's create dialog offers, and why the entry would be refused now.
 */
export interface FLTeamEntryOffer {
  closed: boolean;
  clubs: FLTeamEntryClub[];
  gruppen: FLTeamGruppeOffer[];
  taken: FLTrikotFarbe[];
}

/**
 * The team editor's registration link box: the live link, whether it opens anything, and what a press would do for the team.
 */
export interface FLTeamLinkState {
  invitation: FLInvitationRow | null;
  paused: boolean;
  running: boolean;
  skipped: FLInvitationSkipReason | null;
}

export type FLTeamListState = (typeof FLTeamListState)[keyof typeof FLTeamListState];

export const FLTeamListState = {
  active: "active",
  departed: "departed",
  retired: "retired",
} as const;

/**
 * One junction row as seen from its club: which season, which group, and the record if any.
 */
export interface FLTeamMembership {
  austritt: FLAustritt | null;
  confirmations: FLSaisonTeamConfirmationsView | null;
  gruppe: FLGruppenNames;
  kontakte: FLSaisonTeamKontakte | null;
  saison_id: string;
  trikot_farbe: FLTrikotFarbe | null;
  version: number;
}

/**
 * One coming fixture of the team holding a day and an hour, with its line-up's marks.
 */
export interface FLTeamPanelAufstellung {
  ansetzung: FLSpielbestaetigungViewAnsetzung;
  marks: FLAufstellungMarks;
  side: FLSpielSide;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
}

/**
 * One pending registration as the Übersicht names it: who waits, since when, as what, and whether the team may admit them yet.
 */
export interface FLTeamPanelRegistrierung {
  admissible: boolean;
  /** @minLength 1 */
  first_name: string;
  /** @minLength 1 */
  last_name: string;
  position: FLSpielerPosition | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  registrierung_id: string;
  stufe: FLSpielerStufe | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  submitted_at: string;
}

/**
 * One person on the team's seats as the people beside them see it: who, which seats, and whether they answered their link.
 *
 * A Trainer holding a second seat is one entry naming both, as the league's own team editor lists them. No address,
 * telephone number or birthdate: only administrators see those.
 */
export interface FLTeamSeat {
  confirmed: boolean;
  name: string | null;
  rollen: FLKontaktRolle[];
}

/**
 * One date the league asked the team to confirm, while it still holds work for the team or waits on the league.
 *
 * An agreed date is no row here. A declined one stays, with the team's own proposal, until the league adopts or
 * discards it.
 */
export interface FLTeamPanelTermin {
  ansetzung: FLSpielbestaetigungViewAnsetzung;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  deadline: string;
  side: FLSpielSide;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spiel_id: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spielbestaetigung_id: string;
  state: FLSpielbestaetigungTeamState;
  vorschlag: FLSpielbestaetigungAppointment | null;
}

/**
 * A team's Übersicht in one read: who the team is, the work open for it, and its three seats.
 *
 * The three lists are open work alone and carry no totals: the dates awaiting the team's answer or the league's
 * decision, the coming fixtures the team has entered no line-up for, and the registrations awaiting its decision.
 */
export interface FLTeamOverviewResponse {
  aufstellungen: FLTeamPanelAufstellung[];
  /** @minLength 1 */
  full_name: string;
  /** @minLength 1 */
  name: string;
  registrierungen: FLTeamPanelRegistrierung[];
  registrierungen_complete: boolean;
  rollen: FLKontaktRolle[];
  saison_id: string;
  seats: FLTeamSeat[];
  /** @minLength 1 */
  shorthand: string;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
  termine: FLTeamPanelTermin[];
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * The club as its page in one season shows it: the school, its group, and how it left the season if it did.
 *
 * The whole `austritt` record, reason and day: this page is the one that publishes them.
 */
export interface FLTeamPageClub {
  address: FLAddress;
  austritt: FLAustritt | null;
  /** @maxLength 4096 */
  description: string;
  /** @minLength 1 */
  full_name: string;
  gruppe: FLGruppenNames;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  /** @minLength 1 */
  name: string;
  schulform: FLSchulform | null;
  /** @pattern ^[A-Z]{3}$ */
  shorthand: string;
  website_url: string | null;
}

/**
 * One of a club's matches with its matchday's `position` and its phase's count of matchdays, which the page names the matchday by.
 */
export interface FLTeamPageSpiel {
  ansetzung_confirmed: boolean | null;
  /** @minimum 1 */
  count_spieltage_in_phase: number;
  date: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  for_third_place: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  note: string | null;
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
  spielort: FLSpielortFieldPublic | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  /** @minimum 1 */
  spieltag_position: number;
  team1: FLSpielTeamFieldJoined | null;
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelle | null;
  time: string | null;
}

/**
 * One club's page in one season: the club, its row of the Tabelle, its matches and its squad.
 *
 * `standing` is null for a club no group of the Tabelle lists, one that left the league; `spiele` are in the order the
 * draw numbered them, each with its matchday's `position`; the squad is the base tier's, names withheld where the
 * pupil's consent does not publish them.
 */
export interface FLTeamPageResponse {
  kader: FLSpielerPublic[];
  spiele: FLTeamPageSpiel[];
  standing: FLTabelleRow | null;
  team: FLTeamPageClub;
}

/**
 * One of the team's matches as its own list shows it: the fixture and its matchday, and the two things that can be open on it.
 */
export interface FLTeamPanelSpiel {
  ansetzung_confirmed: boolean | null;
  aufstellung: FLAufstellungMarks | null;
  /** @minimum 1 */
  count_spieltage_in_phase: number;
  date: string | null;
  elfmeterschiessen: FLSpielElfmeterschiessen | null;
  ergebnis: string | null;
  for_third_place: boolean;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  note: string | null;
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
  spielort: FLSpielortFieldPublic | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  spieltag_id: string;
  /** @minimum 1 */
  spieltag_position: number;
  team1: FLSpielTeamFieldJoined | null;
  team1_quelle: FLSpielQuelle | null;
  team2: FLSpielTeamFieldJoined | null;
  team2_quelle: FLSpielQuelle | null;
  termin: FLSpielbestaetigungTeamState | null;
  time: string | null;
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
  version: number;
  website_url: string | null;
}

/**
 * The season a team editor stands under, as far as the editor's locks read it.
 */
export interface FLTeamSaisonFacts {
  begun: boolean;
  id: string;
  registrierung_end: string | null;
  /** @pattern ^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ */
  start_date: string;
  status: FLSaisonStatus;
}

/**
 * What the team editor shows in one read: the club, its row of the season, and what each of its acts would meet.
 */
export interface FLTeamSaisonAdminResponse {
  gruppe_locked: boolean;
  gruppen: FLTeamGruppeOffer[];
  link: FLTeamLinkState | null;
  membership: FLTeamMembership | null;
  retire_blocked_by: string | null;
  saison: FLTeamSaisonFacts;
  taken_trikot_farben: FLTrikotFarbe[];
  team: FLTeamRecord;
  /** @minimum 0 */
  version: number;
}

export type FLTeamShorthandLength = 3;

/**
 * Every fixture of one team in one season, in the order the draw numbered them.
 */
export interface FLTeamSpieleResponse {
  saison_id: string;
  spiele: FLTeamPanelSpiel[];
  /** @pattern ^[0-9a-fA-F]{24}$ */
  team_id: string;
}

/**
 * One club as the Teams list shows it: the name it plays this season under, or today's for a club holding no row of it.
 */
export interface FLTeamsAdminRow {
  austritt_type: FLAustrittType | null;
  gruppe: FLGruppenNames | null;
  /** @pattern ^[0-9a-fA-F]{24}$ */
  id: string;
  inactive_since: string | null;
  name: string;
  /** @minimum 0 */
  seats_confirmed: number;
  /** @minimum 0 */
  seats_filled: number;
  shorthand: string;
  trikot_farbe: FLTrikotFarbe | null;
}

/**
 * One season's Teams list, and what its create dialog offers.
 */
export interface FLTeamsAdminListResponse {
  entry: FLTeamEntryOffer;
  teams: FLTeamsAdminRow[];
}

/**
 * One team, from `GET /teams/{team_id}`.
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

export type FLWhatsappTextVersion = "2026-11-whatsapp-1";

export type Rule = (typeof Rule)[keyof typeof Rule];

export const Rule = {
  acceptance_with_proposal: "acceptance_with_proposal",
  acceptance_with_reason: "acceptance_with_reason",
  address_in_free_text: "address_in_free_text",
  bewerbung_window_ends_before_start: "bewerbung_window_ends_before_start",
  date_not_in_calendar: "date_not_in_calendar",
  decline_without_proposal: "decline_without_proposal",
  decline_without_reason: "decline_without_reason",
  elfmeterschiessen_without_draw: "elfmeterschiessen_without_draw",
  elfmeterschiessen_without_winner: "elfmeterschiessen_without_winner",
  email_not_accepted: "email_not_accepted",
  good_spieler_exceed_kader: "good_spieler_exceed_kader",
  grant_wording_stale: "grant_wording_stale",
  nichtantreten_with_elfmeterschiessen: "nichtantreten_with_elfmeterschiessen",
  nichtantreten_with_scorers: "nichtantreten_with_scorers",
  registrierung_window_reaches_saison_start: "registrierung_window_reaches_saison_start",
  saison_ends_before_start: "saison_ends_before_start",
  spieler_named_twice: "spieler_named_twice",
  spieltag_ends_before_start: "spieltag_ends_before_start",
  starters_exceed_eleven: "starters_exceed_eleven",
  text_version_of_another_wording: "text_version_of_another_wording",
  url_not_accepted: "url_not_accepted",
} as const;

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
export type N422Response = FLFailureBody;

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

export type AddressChangeSweepAddressChangeParams = {
  after?: string | null;
};

export type BewerbungenGetBewerbungenAdminParams = {
  saison_id: string;
};

export type IdentitySweepErasureParams = {
  after?: string | null;
};

export type RegistrierungenGetRegistrierungenAdminParams = {
  saison_id: string;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
};

export type SaisonsGetSaisonsAdminParams = {
  status?: FLSaisonStatus | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SaisonsGetSaisonsAdminSortBy;
  order?: SaisonsGetSaisonsAdminOrder;
};

export type SaisonsGetSaisonsAdminSortBy = (typeof SaisonsGetSaisonsAdminSortBy)[keyof typeof SaisonsGetSaisonsAdminSortBy];

export const SaisonsGetSaisonsAdminSortBy = {
  _id: "_id",
  start_date: "start_date",
  end_date: "end_date",
} as const;

export type SaisonsGetSaisonsAdminOrder = (typeof SaisonsGetSaisonsAdminOrder)[keyof typeof SaisonsGetSaisonsAdminOrder];

export const SaisonsGetSaisonsAdminOrder = {
  asc: "asc",
  desc: "desc",
} as const;

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

export type SpielbestaetigungenGetSpielbestaetigungenParams = {
  saison_id: string;
  spiel_id?: string | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
};

export type SpieleGetSpieleSpielplanParams = {
  /**
   * The season whose matchdays and knockout rounds the list shows
   */
  saison_id: string;
};

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

export type SpielerGetSpielerAdminParams = {
  saison_id: string;
};

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

export type SpieltageGetSpieltageAdminParams = {
  saison_id?: string | null;
  saison_phase?: "playoffs" | FLSaisonPhase | null;
  /**
   * @minimum 1
   * @maximum 1024
   */
  limit?: number;
  sort_by?: SpieltageGetSpieltageAdminSortBy;
  order?: SpieltageGetSpieltageAdminOrder;
};

export type SpieltageGetSpieltageAdminSortBy = (typeof SpieltageGetSpieltageAdminSortBy)[keyof typeof SpieltageGetSpieltageAdminSortBy];

export const SpieltageGetSpieltageAdminSortBy = {
  natural: "natural",
  start: "start",
  end: "end",
} as const;

export type SpieltageGetSpieltageAdminOrder = (typeof SpieltageGetSpieltageAdminOrder)[keyof typeof SpieltageGetSpieltageAdminOrder];

export const SpieltageGetSpieltageAdminOrder = {
  asc: "asc",
  desc: "desc",
} as const;

export type TeamsGetTeamsAdminParams = {
  saison_id: string;
  gruppe?: FLGruppenNames | null;
  state?: FLTeamListState | null;
};

export type TeamsGetTeamParams = {
  saison_id?: string | null;
  statistik_scope?: TeamsGetTeamStatistikScope;
};

export type TeamsGetTeamStatistikScope = (typeof TeamsGetTeamStatistikScope)[keyof typeof TeamsGetTeamStatistikScope];

export const TeamsGetTeamStatistikScope = {
  gruppenphase: "gruppenphase",
  total: "total",
} as const;
