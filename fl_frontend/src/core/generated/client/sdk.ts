import {
  adminKeyDryRunTransport,
  adminKeyReadTransport,
  adminKeyTransport,
  baseKeyReadTransport,
  baseKeyTransport,
  serializeQuery,
  systemKeyReadTransport,
  systemKeyTransport,
  unkeyedTransport,
} from "@/core/transport";

import type {
  AddressChangeSweepAddressChangeParams,
  BewerbungenGetBewerbungenAdminParams,
  CheckIsLiveResponse,
  FLAcceptBewerbungPayload,
  FLAcceptBewerbungResponse,
  FLAccountAddressChangeMintResponse,
  FLAccountAddressChangePayload,
  FLAccountAddressChangeResponse,
  FLAccountEinwilligungenResponse,
  FLAccountEinwilligungPayload,
  FLAccountErasureViewResponse,
  FLActionLogFilterPayload,
  FLActionLogListResponse,
  FLActivateSaisonResponse,
  FLAddressChangeAddressPayload,
  FLAddressChangeAddressResponse,
  FLAddressChangeAdminListResponse,
  FLAddressChangeAdminPayload,
  FLAddressChangeAnswerPayload,
  FLAddressChangeAnswerResponse,
  FLAddressChangeIdResponse,
  FLAddressChangeMovesDonePayload,
  FLAddressChangeMovesDoneResponse,
  FLAddressChangeMovesResponse,
  FLAddressChangeStopResponse,
  FLAddressChangeSweepResponse,
  FLAddressChangeViewResponse,
  FLAufstellungPayload,
  FLAufstellungResponse,
  FLAustrittPayload,
  FLBanListResponse,
  FLBanListWriteResponse,
  FLBewerbungEinwilligungAnswerResponse,
  FLBewerbungEinwilligungDeclined,
  FLBewerbungEinwilligungGiven,
  FLBewerbungEinwilligungResendResponse,
  FLBewerbungEinwilligungViewResponse,
  FLBewerbungenAdminListResponse,
  FLBewerbungFormResponse,
  FLBewerbungKontaktSeatPayload,
  FLBewerbungKontaktSeatResponse,
  FLBewerbungSingleResponse,
  FLBewerbungSweepResponse,
  FLCreatedResponse,
  FLDeclineBewerbungPayload,
  FLDeclineBewerbungResponse,
  FLErasureAddressPayload,
  FLErasurePayload,
  FLErasureResponse,
  FLErasureSweepResponse,
  FLErasureViewResponse,
  FLGenerateSpielplanPayload,
  FLGenerateSpielplanResponse,
  FLGrantHandoverPassResponse,
  FLGrantsListResponse,
  FLGrantWriteResponse,
  FLInvitationDispatchResponse,
  FLInvitationMailPayload,
  FLInvitationMailResponse,
  FLInvitationMintResponse,
  FLInvitationViewResponse,
  FLInvitationWriteResponse,
  FLKaderResponse,
  FLKaderRow,
  FLKontaktInviteResponse,
  FLKontaktSeatPayload,
  FLKontaktSeatResponse,
  FLKoRundeResponse,
  FLLandingResponse,
  FLOpenRegistrierungenResponse,
  FLOutboxEventPayload,
  FLOutboxEventResponse,
  FLOutboxHandoutResponse,
  FLOutboxResultPayload,
  FLOutboxResultResponse,
  FLOutboxSignInPayload,
  FLOwnSaisonsResponse,
  FLPatchKaderRowPayload,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPatchSchiedsrichterPayload,
  FLPatchSchiedsrichterResponse,
  FLPatchSpielDataPayload,
  FLPatchSpielDataResponse,
  FLPatchSpielerSaisonPayload,
  FLPatchSpielerSaisonResponse,
  FLPatchSpielortPayload,
  FLPatchSpielortResponse,
  FLPatchSpieltagPayload,
  FLPatchTeamSaisonPayload,
  FLPatchTeamSaisonResponse,
  FLPostBanListEntryPayload,
  FLPostBanListEntryResponse,
  FLPostBewerbungPayload,
  FLPostGrantPayload,
  FLPostRegistrierungPayload,
  FLPostRegistrierungResponse,
  FLPostSaisonPayload,
  FLPostSaisonResponse,
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
  FLPostSpielortPayload,
  FLPostTeamEntryPayload,
  FLPostTeamEntryResponse,
  FLReferencesPayload,
  FLReferencesResponse,
  FLRegistrierungAdmissionResponse,
  FLRegistrierungAdmitPayload,
  FLRegistrierungConfirmationPayload,
  FLRegistrierungConfirmationResponse,
  FLRegistrierungConfirmationViewResponse,
  FLRegistrierungDeclinePayload,
  FLRegistrierungDeclineResponse,
  FLRegistrierungenAdminListResponse,
  FLRegistrierungSweepResponse,
  FLReplaceSaisonTeamPayload,
  FLReplaceSaisonTeamResponse,
  FLSaisonAdminResponse,
  FLSaisonFrameResponse,
  FLSaisonOverviewResponse,
  FLSaisonsAdminListResponse,
  FLSaisonsSingleResponse,
  FLSaisonTeamEinwilligungAnswerResponse,
  FLSaisonTeamsResponse,
  FLSchiedsrichterAccountEinwilligungPayload,
  FLSchiedsrichterConfirmationPayload,
  FLSchiedsrichterConfirmationResponse,
  FLSchiedsrichterConfirmationViewResponse,
  FLSchiedsrichterListResponse,
  FLSchiedsrichterMintResponse,
  FLSchiedsrichterReactivateResponse,
  FLSchiedsrichterSingleResponse,
  FLSchiedsrichterSpieleResponse,
  FLSchiedsrichterSweepResponse,
  FLSeatEinwilligungPayload,
  FLSignInResponse,
  FLSpielberichteSaisonResponse,
  FLSpielberichtPayload,
  FLSpielberichtSchiedsrichterResponse,
  FLSpielbestaetigungAnswerResponse,
  FLSpielbestaetigungenListResponse,
  FLSpielbestaetigungEnterPayload,
  FLSpielbestaetigungSchiedsrichterAnswerPayload,
  FLSpielbestaetigungSchiedsrichterAnswerResponse,
  FLSpielbestaetigungSweepResponse,
  FLSpielbestaetigungTeamAnswerPayload,
  FLSpieleAdminSingleResponse,
  FLSpielerAdminListResponse,
  FLSpielerSaisonAdminResponse,
  FLSpielerSaisonSelfResponse,
  FLSpielerSingleResponse,
  FLSpieleSingleResponse,
  FLSpieleSpielplanAdminResponse,
  FLSpielorteListResponse,
  FLSpielorteSingleResponse,
  FLSpielPageResponse,
  FLSpielplanResponse,
  FLSpieltagAdminResponse,
  FLSpieltageListResponse,
  FLSpieltageSingleResponse,
  FLSpieltagWriteResponse,
  FLSubjectPayload,
  FLSubjectResponse,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
  FLSweepSaisonsResponse,
  FLTabelleResponse,
  FLTeamOverviewResponse,
  FLTeamPageResponse,
  FLTeamsAdminListResponse,
  FLTeamSaisonAdminResponse,
  FLTeamSpieleResponse,
  FLTeamsSingleResponse,
  FLTokenPayload,
  FLUndrawSpielplanResponse,
  IdentitySweepErasureParams,
  RegistrierungenGetRegistrierungenAdminParams,
  SaisonsGetSaisonsAdminParams,
  SchiedsrichterGetSchiedsrichterParams,
  SpielberichteGetSpielberichteParams,
  SpielbestaetigungenGetSpielbestaetigungenParams,
  SpieleGetSpieleSpielplanParams,
  SpielePatchSpielParams,
  SpielerGetSpielerAdminParams,
  SpielorteGetSpielorteParams,
  SpieltageGetSpieltageAdminParams,
  TeamsGetTeamParams,
  TeamsGetTeamsAdminParams,
} from "./types.ts";

export const getAccountDeleteAddressChangeUrl = () => {
  return `/api/v0/account/address_change`;
};

/**
 * Stop the change pending on the signed-in address at any step: its new address goes.
 *
 * Its address on file's question unanswered too, which the link mailed there declines rather than stops. Asks no fresh
 * confirmation and counts nothing: a stop hands nothing over. A holder's change in its wait tells every holder. 404 where no
 * change is pending on the address.
 * @summary Stop the address change pending on the signed-in person
 */
export const accountDeleteAddressChange = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAccountAddressChangeResponse> => {
  return adminKeyTransport<FLAccountAddressChangeResponse>(getAccountDeleteAddressChangeUrl(), {
    ...options,
    method: "DELETE",
  });
};

export const getAccountGetAddressChangeUrl = () => {
  return `/api/v0/account/address_change`;
};

/**
 * Answer the change pending on the signed-in address, null where none is, and the tier whose wait a change of it serves.
 *
 * PERSON TIER. Whether the address holds anything a change moves is the start's to answer, refused
 * `address_change_nothing`. **The pending address is served masked where an administrator started the change**, whole
 * only where the person typed it here: a change an administrator started may be a pretext whose target the holder of
 * the address on file must not learn. `waits_on` names the step, `previous_address` the link the person's own change
 * mailed the address on file, which this page answers nothing of; `expired` says the step the change waits on lapsed,
 * whose press is refused until the hourly pass ends the change. `wait_tier` is null for an address holding no grant, and
 * `owner` for a row a handover names, whatever its stored tier.
 * @summary The address change pending on a signed-in person
 */
export const accountGetAddressChange = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLAccountAddressChangeResponse> => {
  return adminKeyTransport<FLAccountAddressChangeResponse>(getAccountGetAddressChangeUrl(), {
    ...options,
    method: "GET",
  });
};

export const getAccountPostAddressChangeUrl = () => {
  return `/api/v0/account/address_change`;
};

/**
 * Start a change of the address the person signs in on, its first mail owed in the same transaction and no link answered.
 *
 * **The address on file confirms first**: it is owed a link, and only its confirmation owes the new mailbox the
 * second; **everything the address holds as its person's own moves when the new mailbox confirms**, each link within
 * `ADDRESS_CHANGE_VALID_HOURS`, and declining either ends the change. Where it holds a grant, the change waits whole
 * from that confirmation, `GRANT_WAIT_HOURS` or the owner's `OWNER_WAIT_DAYS`, the old address working until the
 * hourly pass moves it. The address's live change ends replaced, an administrator's too: a sign-in at the address on
 * file proves the mailbox is not lost. **Nothing about the new address is judged here** -- another pupil, a grant it
 * holds -- so this start answers alike whatever the new address holds.
 *
 * Refused `address_change_started_recently`, a 429 whose `Retry-After` names the seconds left, where the address's
 * live change owed its last mail less than `ADDRESS_CHANGE_RESTART_SECONDS` ago; `address_change_nothing` where the
 * address holds nothing a change moves; and `address_change_unchanged` where the typed address is the one signed in.
 * @summary Start a change of the signed-in person's address
 */
export const accountPostAddressChange = async (
  fLAccountAddressChangePayload: FLAccountAddressChangePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAccountAddressChangeMintResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLAccountAddressChangeMintResponse>(getAccountPostAddressChangeUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAccountAddressChangePayload),
  });
};

export const getAccountGetEinwilligungenUrl = () => {
  return `/api/v0/account/einwilligungen`;
};

/**
 * Answer every confirmed consent record the signed-in address holds, its pupil, referee and contact-seat records alike.
 *
 * The seats come one entry per team season on which the address holds a confirmed seat, however many of its slots;
 * `bewerbungen` one per PENDING application on which it does, whose two choices the account page may only withdraw;
 * `registrierungen` one per pending registration its pupil confirmed, withdraw-only alike until the admission.
 *
 * PERSON TIER, for the account page, which every signed-in person reaches: an address holding nothing is answered
 * `spieler: null` and four empty lists, never refused. A retired record, a past season's seat and a withdrawn team's
 * seat are served too, a withdrawal staying open wherever a consent stands; `givable` says whether a grant is
 * admitted, `media_offered` whether the media consent may be switched on. A record awaiting its person's
 * confirmation is not served: there is nothing on it yet to change.
 * @summary A signed-in person's own consent records
 */
export const accountGetEinwilligungen = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLAccountEinwilligungenResponse> => {
  return adminKeyTransport<FLAccountEinwilligungenResponse>(getAccountGetEinwilligungenUrl(), {
    ...options,
    method: "GET",
  });
};

export const getActionLogGetActionLogUrl = () => {
  return `/api/v0/action_log/view`;
};

/**
 * The newest 50 acts the filters keep, after `cursor` where one is given, with where the next page starts and no count.
 *
 * A POST that reads: `by` is an administrator's address and `q` whatever was typed, and a query string stands on every
 * `http.answered` line, where the log's scrubber reads no `%40`.
 *
 * `_id` orders them, the manual's own range pagination (`cursor.skip`'s page): no row repeats or drops at a seam, and no
 * index is needed past `_id`. `by_options` is every `by` the log holds, whatever the filters keep.
 * @summary List recorded acts
 */
export const actionLogGetActionLog = async (
  fLActionLogFilterPayload: FLActionLogFilterPayload,
  options?: Parameters<typeof adminKeyReadTransport>[1],
): Promise<FLActionLogListResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyReadTransport<FLActionLogListResponse>(getActionLogGetActionLogUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLActionLogFilterPayload),
  });
};

export const getAddressChangeGetAddressChangesUrl = () => {
  return `/api/v0/address_change`;
};

/**
 * Answer every running change, newest first: its two addresses and the step it waits on.
 *
 * ADMIN TIER. The rows `address_change_viewable_denied` refuses are left out, rather than refused: the actor's own, which
 * their account page shows, and a holder's unless the owner asks. Read whole, a capped list would hide a running change:
 * each lasts days at most, and an ended one holds no address.
 * @summary List the running address changes
 */
export const addressChangeGetAddressChanges = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAddressChangeAdminListResponse> => {
  return adminKeyTransport<FLAddressChangeAdminListResponse>(getAddressChangeGetAddressChangesUrl(), {
    ...options,
    method: "GET",
  });
};

export const getAddressChangePostAddressChangeAdminUrl = () => {
  return `/api/v0/address_change`;
};

/**
 * Start a change of the typed address for a person who says they cannot sign in, its mails owed in the same transaction.
 *
 * **Nothing moves here.** A person who can still sign in at the address on file changes it on their own account page. The
 * new mailbox is owed its link and the address on file a notice with its stop link; the change then takes effect
 * `ADDRESS_CHANGE_WAITING_PERIOD_DAYS` after the new mailbox confirms, the old address working until then. No link is
 * answered. The address's live change ends replaced.
 *
 * Refused the administrator's own address (`own_address`), a grant holder's unless the owner asks (`admin_address`),
 * the address on file typed again (`address_change_unchanged`), an address holding nothing a change moves
 * (`address_change_nothing`), a new address another pupil signs in on where the change moves a pupil
 * (`address_change_taken`), and a new address any entry names, confirmed or not (`address_change_occupied`). A banned new
 * address is refused nothing: its link stops at the hand-out.
 * @summary Start an address change for a person who says they cannot sign in
 */
export const addressChangePostAddressChangeAdmin = async (
  fLAddressChangeAdminPayload: FLAddressChangeAdminPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAddressChangeIdResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLAddressChangeIdResponse>(getAddressChangePostAddressChangeAdminUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAddressChangeAdminPayload),
  });
};

export const getAddressChangeGetAddressChangeAddressUrl = () => {
  return `/api/v0/address_change/address`;
};

/**
 * Answer the new address of the live change the new mailbox's link token or the change's id names, folded to the sign-in identifier.
 *
 * For the frontend's server alone, which asks its sign-in store whether an account stands there before a press, a link's
 * view or a re-send; the link's own view never serves the address. A token or id naming no live change -- unknown,
 * ended, or the stop link's token -- is answered null rather than refused, so a lapsed or answered link costs no
 * error. Stores nothing, and a POST for `POST /identity/subject`'s reason: the token travels in the body, and the
 * address only in the answer.
 * @summary Say which address a live change would move to
 */
export const addressChangeGetAddressChangeAddress = async (
  fLAddressChangeAddressPayload: FLAddressChangeAddressPayload,
  options?: Parameters<typeof systemKeyReadTransport>[1],
): Promise<FLAddressChangeAddressResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyReadTransport<FLAddressChangeAddressResponse>(getAddressChangeGetAddressChangeAddressUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAddressChangeAddressPayload),
  });
};

export const getAddressChangePostAddressChangeAnswerUrl = () => {
  return `/api/v0/address_change/confirmation`;
};

/**
 * Record whether the mailbox this link was sent to is the person's: `confirmed` confirms it, `declined` ends the change.
 *
 * **The person's own change asks the address on file first**: its link's confirmation owes the new mailbox its link,
 * and nothing moves yet, answering `confirmed` with `effective` false and `effective_from` null; refused `link_expired`
 * past that link's deadline and `address_change_ended` once answered or ended, a decline refused only the latter, and a
 * decline is the one way this link ends the change before it confirmed (`/stop` refuses it). Every other link the
 * address on file was mailed answers no confirmation (`link_invalid`).
 *
 * The new mailbox's link: **a confirmation moves the person, not a record.** Unless the change waits -- on the lost-mailbox
 * way, or because the address holds a grant -- it takes effect in this transaction: every pupil row, confirmed referee row,
 * confirmed contact seat and registration the address on file holds moves to the new one, asking no consent and writing
 * none, and `effective` says so; its completion notice is owed in this transaction, and so is its sign-in account's
 * carry. A change that waits is confirmed alone, answering `effective_from`, the old address working until the hourly pass
 * moves it; a holder's tells every holder in effect, in this transaction.
 * Either answer spends the link, which keeps answering what became of the change.
 *
 * Refuses a token no change holds (`link_invalid`), a link already answered or a change ended
 * (`address_change_ended`), and, in the order the link's view ranks its states, a CONFIRMATION past its deadline
 * (`link_expired`), one moving a pupil onto an address another pupil signs in on (`address_change_taken`), one moving a
 * grant onto an address holding one (`address_change_new_granted`), and one whose new address any entry names, confirmed
 * or not (`address_change_occupied`): moving the person onto it would join two people's records. **A decline is refused
 * none of these**: it removes an address nobody proved.
 *
 * A confirmation whose address has come to hold nothing to move is refused `address_change_nothing`, writing nothing, and
 * the change lapses with its link. The codes past `link_expired` tell a caller what the view's `not_confirmable` keeps
 * alike; only the edge keeps them from the link's holder.
 * @summary Confirm or decline a pending address
 */
export const addressChangePostAddressChangeAnswer = async (
  fLAddressChangeAnswerPayload: FLAddressChangeAnswerPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLAddressChangeAnswerResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<FLAddressChangeAnswerResponse>(getAddressChangePostAddressChangeAnswerUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAddressChangeAnswerPayload),
  });
};

export const getAddressChangePostAddressChangeStopUrl = () => {
  return `/api/v0/address_change/confirmation/stop`;
};

/**
 * Stop the change the address on file was mailed about: its new address goes.
 *
 * **Refused nothing but a token no change holds, a change ended, and the person's own change before its address on
 * file confirmed it**: a stop hands nothing over, so it answers past every deadline until the change ends. A token no
 * change holds answers `link_invalid` and an ended change `address_change_ended`. The person's own change offers this
 * link no stop until its address on file confirmed it, and answers `link_invalid` as the unknown token does, the page
 * offering no stop then: the question's decline is the one way that link ends it before, so one act keeps one ending.
 * From that confirmation on, the same link is the change's stop on every way. A holder's change in its wait tells
 * every holder.
 * @summary Stop a pending address change
 */
export const addressChangePostAddressChangeStop = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLAddressChangeStopResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<FLAddressChangeStopResponse>(getAddressChangePostAddressChangeStopUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getAddressChangeGetAddressChangeViewUrl = () => {
  return `/api/v0/address_change/confirmation/view`;
};

/**
 * Answer what this token opens: the new mailbox's link, the link the address on file was mailed, or how either's change ended.
 *
 * **Nothing else about the change**: never a name or the id, and the new address only where the link's holder judges by
 * it, the new mailbox's `valid` link and the address on file's link while the change stands, masked on `waiting_period`.
 * A POST that reads,
 * so the token travels in a body and never in a second URL. Refuses only a token no change holds (`link_invalid`); an ended change's
 * links answer `ended`, how it ended and on which day, for as long as its record is kept.
 *
 * The new mailbox's side is served in a state: once pressed, `confirmed`; else `expired`, then `not_confirmable` wherever
 * the press would be refused for the address on file's sake or would
 * find it holding nothing to move, each a state the confirmation is refused in. Those read alike here, though the press
 * answers each by its own code; what keeps the link's holder from telling them apart is the edge, where
 * the proxy routes no public call to this service. The address on file's side answers the step the change waits on,
 * `release_open` while the person's own change waits on this link's confirmation and `release_expired` once that lapsed,
 * never whether the new mailbox could confirm, and the day it confirmed once it has.
 * @summary What one address link opens
 */
export const addressChangeGetAddressChangeView = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyReadTransport>[1],
): Promise<FLAddressChangeViewResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyReadTransport<FLAddressChangeViewResponse>(getAddressChangeGetAddressChangeViewUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getAddressChangeSweepAddressChangeUrl = (params?: AddressChangeSweepAddressChangeParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/address_change/sweep?${stringifiedParams}` : `/api/v0/address_change/sweep`;
};

/**
 * End a bounded share of the live changes whose waiting step lapsed, and make the due ones take effect.
 *
 * **A lapsed change** -- its new mailbox's link, or the question it asked the address on file -- ends as `expired`:
 * its address and reason out of the record (`removed`). **A due change**, one whose waiting time has ended, is judged
 * again as its confirmation was: another pupil signing in on the new address, a grant at it, an entry naming it, or
 * nothing left to move ends it discarded, and `discarded` counts it, its new address owed a notice that it did not take
 * effect and never why; otherwise everything the replaced address holds moves, a grant included, and `effective` counts
 * it, its completion notice owed. A holder's change is stopped only by an entry a person confirmed, never by a seat or an
 * application nobody did: anyone can name an address there, and only the owner stops a holder's change. Each notice is
 * owed in the Postausgang in its change's own transaction, so none rides on this answer.
 *
 * A page's lapsed changes end in one transaction beside their one log row, and each due change takes a transaction of
 * its own; each judges again, so one confirmed, stopped, discarded or replaced since this call read it is left standing.
 * **A pass is a run of calls, each handing the next the `after` the last
 * answered**, the first naming none; it ends at the call answering `after` null. A call reaches at most a fixed share of the
 * changes after `after`, in `_id` order, and the pass holds no state on the server. A change whose handling fails is
 * logged by its id and passed, holding back nobody behind it; it stays due, and the next pass tries it again. Where the
 * request's deadline cuts the call, it stops at that change, warns once, and answers what it did. `remaining` counts
 * the changes standing due after the call, so it is no stopping condition.
 * @summary End the lapsed address changes, and make the due ones take effect
 */
export const addressChangeSweepAddressChange = async (
  params?: AddressChangeSweepAddressChangeParams,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAddressChangeSweepResponse> => {
  return systemKeyTransport<FLAddressChangeSweepResponse>(getAddressChangeSweepAddressChangeUrl(params), {
    ...options,
    method: "POST",
  });
};

export const getAddressChangeGetAddressChangeMovesUrl = () => {
  return `/api/v0/address_change/sweep/moves`;
};

/**
 * List, oldest first and a page at a time, the ended changes still owing to carry a sign-in account to their new address.
 *
 * Each effect owed its carry in its own transaction, so a lost answer loses none. The caller moves each account and
 * hands the ids it moved to `POST /address_change/sweep/moves/done`; one it could not move is listed again by the
 * next call. Moving one twice finds no account left, so no claim holds them. Server to server alone: the answer names
 * addresses.
 * @summary List the sign-in accounts the effects still owe to carry
 */
export const addressChangeGetAddressChangeMoves = async (
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAddressChangeMovesResponse> => {
  return systemKeyTransport<FLAddressChangeMovesResponse>(getAddressChangeGetAddressChangeMovesUrl(), {
    ...options,
    method: "GET",
  });
};

export const getAddressChangePostAddressChangeMovesDoneUrl = () => {
  return `/api/v0/address_change/sweep/moves/done`;
};

/**
 * Take the owed carry off each named change, counting the ones that owed one; an id owing none is left alone.
 * @summary Take the carries done off their changes
 */
export const addressChangePostAddressChangeMovesDone = async (
  fLAddressChangeMovesDonePayload: FLAddressChangeMovesDonePayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAddressChangeMovesDoneResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyTransport<FLAddressChangeMovesDoneResponse>(getAddressChangePostAddressChangeMovesDoneUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAddressChangeMovesDonePayload),
  });
};

export const getAddressChangeDeleteAddressChangeUrl = (addressChangeId: string) => {
  return `/api/v0/address_change/${encodeURIComponent(String(addressChangeId))}`;
};

/**
 * Discard the change this id names: its links open nothing to press, and the address on file stays.
 *
 * A holder's change in its wait tells every holder; nothing else is mailed. Acts on the change the id names alone, so a page
 * showing a change since replaced discards nothing.
 *
 * Refused as the start is about who asks (`own_address`, `admin_address`), and where the change ended
 * (`address_change_ended`); 404 for an id naming no change.
 * @summary Discard a pending address change
 */
export const addressChangeDeleteAddressChange = async (
  addressChangeId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAddressChangeIdResponse> => {
  return adminKeyTransport<FLAddressChangeIdResponse>(getAddressChangeDeleteAddressChangeUrl(addressChangeId), {
    ...options,
    method: "DELETE",
  });
};

export const getAddressChangeInviteAddressChangeUrl = (addressChangeId: string) => {
  return `/api/v0/address_change/${encodeURIComponent(String(addressChangeId))}/invite`;
};

/**
 * Owe the new mailbox a fresh link for the change this id names, in the same transaction.
 *
 * The previous link stops working once the fresh one is handed out; the deadline restarts now. The stop link stays, so
 * the address on file is mailed nothing again. A lapsed link is no refusal while the change stands, which is until the
 * next hourly pass ends it. Acts on the change the id names alone, so a page showing a change since replaced re-sends
 * nothing.
 *
 * Refused as the start is about who asks (`own_address`, `admin_address`), where another pupil has come to sign in on the
 * pending address or an entry has come to name it, confirmed or not (`address_change_new_taken`), and where the change
 * ended (`address_change_ended`). 404 for an id naming no change, and
 * unless the change waits on the new mailbox: one awaiting the address on file's confirmation, or confirmed, has no link to
 * re-send.
 * @summary Send a pending address a fresh link
 */
export const addressChangeInviteAddressChange = async (
  addressChangeId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAddressChangeIdResponse> => {
  return adminKeyTransport<FLAddressChangeIdResponse>(getAddressChangeInviteAddressChangeUrl(addressChangeId), {
    ...options,
    method: "POST",
  });
};

export const getAufstellungenGetAufstellungUrl = (spielId: string, teamId: string) => {
  return `/api/v0/aufstellungen/${encodeURIComponent(String(spielId))}/${encodeURIComponent(String(teamId))}`;
};

/**
 * The line-up screen of one club for one fixture, as the club's own seat holders read it.
 *
 * With the season's status, so a finished season's line-up opens read-only. `document_not_found` for a fixture that
 * does not exist or does not field this club.
 * @summary One club's line-up for one fixture as an administrator reads it
 */
export const aufstellungenGetAufstellung = async (
  spielId: string,
  teamId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAufstellungResponse> => {
  return adminKeyTransport<FLAufstellungResponse>(getAufstellungenGetAufstellungUrl(spielId, teamId), {
    ...options,
    method: "GET",
  });
};

export const getAufstellungenPutAufstellungUrl = (spielId: string, teamId: string) => {
  return `/api/v0/aufstellungen/${encodeURIComponent(String(spielId))}/${encodeURIComponent(String(teamId))}`;
};

/**
 * Save the whole line-up of one club for one fixture, at any time on a fixture holding a day and an hour.
 *
 * The document a seat holder's save writes, on the same payload, so the lock never reaches this save
 * (`aufstellung_locked` is the seat's alone) and a save between the two is refused as any stale one is. Recorded as
 * `aufstellung.saved`.
 *
 * Refuses, in this order, each writing nothing: a fixture that does not exist or does not field this club
 * (`document_not_found`); a fixture of a finished season, whose line-up is read-only (`saison_past`); a fixture
 * holding no day or no hour (`aufstellung_spiel_undated`); a `version` other than
 * the document's now, or than null where none stands (`version_stale`); a pupil newly named whom the club's live
 * squad of the season does not hold, the placeholder of an erased pupil among them (`spieler_not_in_kader`, on each
 * such entry's `spieler_id`); more than eleven starters with the erased pupils' kept entries
 * (`aufstellung_starters_exceed_eleven`, bounded by `max`); and a nominee past the shortage
 * (`aufstellung_nominee_without_shortage`, bounded by `max`). The payload's own rules refuse as they do a seat's
 * save, and every refusal but `version_stale` is asked again outside the transaction just before answering. The
 * stored entries of pupils erased from the locked line-up, which the screen serves as `erased`, are written back after
 * the payload's as they stand while the line-up is locked, and dropped once the fixture is re-dated ahead of its lock.
 * @summary Save one club's line-up for one fixture as an administrator
 */
export const aufstellungenPutAufstellung = async (
  spielId: string,
  teamId: string,
  fLAufstellungPayload: FLAufstellungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAufstellungResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLAufstellungResponse>(getAufstellungenPutAufstellungUrl(spielId, teamId), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAufstellungPayload),
  });
};

export const getAufstellungenGetAufstellungSelfUrl = (spielId: string, teamId: string) => {
  return `/api/v0/aufstellungen/${encodeURIComponent(String(spielId))}/${encodeURIComponent(String(teamId))}/self`;
};

/**
 * The line-up screen of one club for one fixture, for a person holding any contact seat on that club in the fixture's season.
 *
 * The fixture, the club's live squad of the season in shirt-number order, the stored line-up in the order it was
 * saved, every pupil it names outside that squad, the season's status, the document's `version` and the line-up's
 * marks: whether one is stored, the phase the clock puts it in, and the instants it is due and locks at. `marks` is
 * null for a fixture holding no day or no hour, which takes no line-up.
 *
 * Refused `role_not_held` where the signed-in person holds no seat on this club in the fixture's season, a finished
 * season granting none, and `document_not_found` for a fixture that does not exist or does not field this club.
 * @summary One club's line-up for one fixture as its seat holder reads it
 */
export const aufstellungenGetAufstellungSelf = async (
  spielId: string,
  teamId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAufstellungResponse> => {
  return adminKeyTransport<FLAufstellungResponse>(getAufstellungenGetAufstellungSelfUrl(spielId, teamId), {
    ...options,
    method: "GET",
  });
};

export const getAufstellungenPutAufstellungSelfUrl = (spielId: string, teamId: string) => {
  return `/api/v0/aufstellungen/${encodeURIComponent(String(spielId))}/${encodeURIComponent(String(teamId))}/self`;
};

/**
 * Save the whole line-up of one club for one fixture, as any contact seat of the club may until one hour before kick-off.
 *
 * The first save creates the document and answers 201. `version` is the document's as the screen was served it, null
 * where the screen showed no line-up. An emptied line-up is saved as an empty list. The save is recorded as
 * `aufstellung.saved`.
 *
 * Refuses, in this order, each writing nothing: no seat on this club in the fixture's season, a finished season
 * granting none (`role_not_held`); a
 * fixture that does not exist or does not field this club (`document_not_found`); a fixture holding no day or no hour
 * (`aufstellung_spiel_undated`); a save from one hour before kick-off (`aufstellung_locked`); a `version` other than
 * the document's now, or than null where none stands (`version_stale`); a pupil newly named whom the club's live
 * squad of the season does not hold, the placeholder of an erased pupil among them (`spieler_not_in_kader`, on each
 * such entry's `spieler_id`); more than eleven starters with the erased pupils' kept entries
 * (`aufstellung_starters_exceed_eleven`, bounded by `max`); and a nominee named beside eleven regular players, or
 * more nominees than the regular players leave open of eleven (`aufstellung_nominee_without_shortage`, bounded by
 * `max`). A pupil named twice (`spieler_named_twice`) and more than eleven starters (`starters_exceed_eleven`) are
 * refused as the payload's own rules. A line-up being due or overdue refuses nothing. The stored entries of pupils
 * erased from the line-up once it locked, which a seat meets only on a fixture re-dated ahead of its lock since, are
 * dropped by the save, and the screen serves none of them.
 * Every refusal but `version_stale` is asked again outside the transaction just before answering, so a seat ended,
 * a fixture re-dated or a pupil ausgetragen between the two refuses the save rather than letting it stand.
 * @summary Save one club's line-up for one fixture as its seat holder
 */
export const aufstellungenPutAufstellungSelf = async (
  spielId: string,
  teamId: string,
  fLAufstellungPayload: FLAufstellungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAufstellungResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLAufstellungResponse>(getAufstellungenPutAufstellungSelfUrl(spielId, teamId), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAufstellungPayload),
  });
};

export const getBanListGetBanListEntriesUrl = () => {
  return `/api/v0/ban_list`;
};

/**
 * List every ban, newest first: the address, why, on which day and the last season covered.
 *
 * Read whole: the list holds few rows, and a ban left out is one nobody can lift.
 * @summary List the banned addresses
 */
export const banListGetBanListEntries = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLBanListResponse> => {
  return adminKeyTransport<FLBanListResponse>(getBanListGetBanListEntriesUrl(), {
    ...options,
    method: "GET",
  });
};

export const getBanListPostBanListEntryUrl = () => {
  return `/api/v0/ban_list`;
};

/**
 * Ban an address: it cannot sign in and no mail leaves for it, the ban's own notice alone excepted.
 *
 * Refused where the list already holds the address (`duplicate_key`, `uniq_ban_list_address` answering), while no season
 * is running, there being nothing to count the ban's five seasons from (`ban_list_no_saison`), and where the address has
 * a row in `grants`, in effect or waiting, or a holder's live change moves to it (`ban_list_admin`). The ban covers the
 * fifth season after the one running now, the last one it covers stored as `barred_until_saison_id`, and it survives
 * that person's erasure. Where `notify` is set the ban's own notice is owed to the address in the same transaction.
 *
 * `ban_reason` is served, mailed to the address and kept past that person's erasure.
 * @summary Ban an email address
 */
export const banListPostBanListEntry = async (
  fLPostBanListEntryPayload: FLPostBanListEntryPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostBanListEntryResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPostBanListEntryResponse>(getBanListPostBanListEntryUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostBanListEntryPayload),
  });
};

export const getBanListDeleteBanListEntryUrl = (banListEntryId: string) => {
  return `/api/v0/ban_list/${encodeURIComponent(String(banListEntryId))}`;
};

/**
 * Lift a ban before it lapses, removing the row. HARD, and no copy of it stays. 404 where no row holds the id.
 * @summary Lift a ban
 */
export const banListDeleteBanListEntry = async (
  banListEntryId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBanListWriteResponse> => {
  return adminKeyTransport<FLBanListWriteResponse>(getBanListDeleteBanListEntryUrl(banListEntryId), {
    ...options,
    method: "DELETE",
  });
};

export const getBewerbungenPostBewerbungUrl = () => {
  return `/api/v0/bewerbungen`;
};

/**
 * Store one school's application to play one season as submitted, and owe each contact person their confirmation mail.
 *
 * Everything the league decides -- `status`, `submitted_at`, `decision` and each consent's
 * scope, source and date -- is written here and never taken off the payload. One mail per person is owed in the
 * same transaction, a person holding two seats being sent one link for both: the Ansprechperson the receipt naming
 * who is still to answer, every other person their link. Each link is minted when its mail is handed out; no token
 * is answered.
 *
 * The `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * application it holds, stores none and owes nothing again, whatever its body says: a form whose details changed
 * since its last press sends a new key.
 *
 * Two people sharing an address or a number are refused on the later box (`bewerbung_kontakt_repeated`), the seat the
 * Trainer also holds being that one person.
 *
 * A mailbox already holding `OPEN_LINKS_PER_MAILBOX` unanswered links of the season is owed nothing and nothing refuses the
 * press: its seat stands unmailed, with a null `sent_at`, for an administrator to send the link. The answer is the same
 * either way, so it tells a stranger nothing about the address.
 * @summary Submit a Bewerbung
 */
export const bewerbungenPostBewerbung = async (
  fLPostBewerbungPayload: FLPostBewerbungPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLCreatedResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<FLCreatedResponse>(getBewerbungenPostBewerbungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostBewerbungPayload),
  });
};

export const getBewerbungenPostEinwilligungUrl = () => {
  return `/api/v0/bewerbungen/einwilligung`;
};

/**
 * Record one person's consent or decline for the seat their link opens, and for a second seat they hold.
 *
 * A decline empties the slot; on an application it owes the Ansprechperson who still stands and was mailed the notice
 * naming who refused, in the same transaction, which stands as the deletion notice too. Refuses, writing nothing:
 * `link_invalid`, `link_expired`, `bewerbung_seat_already_answered`, `confirmation_age`, `media_age`, and on a team's
 * season row `link_expired` and `kontakt_saison_past`.
 * @summary Confirm or decline one seat of a Bewerbung or of a team's season row
 */
export const bewerbungenPostEinwilligung = async (
  fLBewerbungEinwilligungGivenFLBewerbungEinwilligungDeclined: FLBewerbungEinwilligungGiven | FLBewerbungEinwilligungDeclined,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLBewerbungEinwilligungAnswerResponse | FLSaisonTeamEinwilligungAnswerResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<FLBewerbungEinwilligungAnswerResponse | FLSaisonTeamEinwilligungAnswerResponse>(getBewerbungenPostEinwilligungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungEinwilligungGivenFLBewerbungEinwilligungDeclined),
  });
};

export const getBewerbungenGetEinwilligungViewUrl = () => {
  return `/api/v0/bewerbungen/einwilligung/view`;
};

/**
 * What the confirmation page renders for the seat this token opens, and nothing of the person.
 *
 * A POST, so the token travels in the body. A confirmed, declined or expired link is served in that state; only a token
 * no seat holds is refused (`link_invalid`).
 * @summary What one confirmation link opens
 */
export const bewerbungenGetEinwilligungView = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyReadTransport>[1],
): Promise<FLBewerbungEinwilligungViewResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyReadTransport<FLBewerbungEinwilligungViewResponse>(getBewerbungenGetEinwilligungViewUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getBewerbungenGetFormUrl = (saisonId: string) => {
  return `/api/v0/bewerbungen/form/${encodeURIComponent(String(saisonId))}`;
};

/**
 * One read for the form's page: the window, and while it runs the clubs a school may apply as and the colours taken.
 *
 * 404 only where no season carries the id. A closed or paused window and a season recording none are served, for the
 * page to say so; the clubs and the colours are served on a running window alone, each as a name or a colour and
 * nothing more (`READ-BEWERBUNG-001`).
 * @summary What one Saison's application form shows
 */
export const bewerbungenGetForm = async (
  saisonId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLBewerbungFormResponse> => {
  return baseKeyTransport<FLBewerbungFormResponse>(getBewerbungenGetFormUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenGetBewerbungenAdminUrl = (params: BewerbungenGetBewerbungenAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/bewerbungen/list/admin?${stringifiedParams}` : `/api/v0/bewerbungen/list/admin`;
};

/**
 * One read for the season's list and its bulk accept: its rows, newest first, and what an acceptance would meet.
 *
 * A row holds nothing of a person: a seat's count stands for it. 404 where no season carries the id, and `duplicate`
 * taken over every open application of the season. Degrades rather than refusing: the rows are written by an anonymous
 * public form, so a tripwire would hand whoever writes them the power to 500 this page, and `complete` reports the cut.
 * Every application with a confirmed seat is served past the newest rows a flood can fill: a flood naming strangers
 * confirms nothing, and a sender confirming one seat at a time has to hold each mailbox.
 * @summary One Saison's Bewerbungen for its list
 */
export const bewerbungenGetBewerbungenAdmin = async (
  params: BewerbungenGetBewerbungenAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungenAdminListResponse> => {
  return adminKeyTransport<FLBewerbungenAdminListResponse>(getBewerbungenGetBewerbungenAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenGetSweepSaisonsUrl = () => {
  return `/api/v0/bewerbungen/sweep`;
};

/**
 * Every season's id, oldest first, for the caller to sweep one at a time.
 * @summary Every season the sweep has to visit
 */
export const bewerbungenGetSweepSaisons = async (options?: Parameters<typeof systemKeyTransport>[1]): Promise<FLSweepSaisonsResponse> => {
  return systemKeyTransport<FLSweepSaisonsResponse>(getBewerbungenGetSweepSaisonsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenSweepSaisonUrl = (saisonId: string) => {
  return `/api/v0/bewerbungen/sweep/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Run one season's seven retention clocks as of today, each reminder and deletion notice owed in the write it belongs to.
 *
 * The drain sends what the pass owed. A row that cannot be written is passed over, counted in `failed` and met
 * again by the next pass. 404 where no season has the id.
 * @summary Run one season's retention clocks
 */
export const bewerbungenSweepSaison = async (
  saisonId: string,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBewerbungSweepResponse> => {
  return systemKeyTransport<FLBewerbungSweepResponse>(getBewerbungenSweepSaisonUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getBewerbungenGetBewerbungUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${encodeURIComponent(String(bewerbungId))}`;
};

/**
 * One application.
 *
 * Each seat's `expired` says whether its own deadline has passed today, and `duplicate` is taken over every open
 * application of the season, as the list takes it.
 * @summary One Bewerbung for its review page
 */
export const bewerbungenGetBewerbung = async (
  bewerbungId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungSingleResponse> => {
  return adminKeyTransport<FLBewerbungSingleResponse>(getBewerbungenGetBewerbungUrl(bewerbungId), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenAcceptBewerbungUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${encodeURIComponent(String(bewerbungId))}/accept`;
};

/**
 * Accept an application, creating the school's club where the applicant proposed a new one, each call one transaction.
 *
 * The bulk accept is this endpoint once per card, so a refusal lands on its card and nothing already done is undone:
 * one request over a season's applications would outrun `app/core/middlewares.py :: REQUEST_DEADLINE_S`.
 *
 * IRREVERSIBLE. `saison_teams` has no DELETE, so a club entered in error leaves only through an
 * `austritt`, which is a public record carrying a stated reason. Refused while any contact person has yet to
 * confirm their own seat (`bewerbung_kontakte_unconfirmed`), so every seat enters the season as its person confirmed it.
 * A new school takes its `shorthand` here, a taken one refused `duplicate_key` naming it; a picked club sends null.
 * A colour another row of the season holds is refused `trikot_farbe_taken` naming it; no colour stays free for any number.
 * The acceptance is owed to every person of the application in the same transaction, naming the seats each holds.
 * @summary Accept a Bewerbung and enter the school into the season
 */
export const bewerbungenAcceptBewerbung = async (
  bewerbungId: string,
  fLAcceptBewerbungPayload: FLAcceptBewerbungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAcceptBewerbungResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLAcceptBewerbungResponse>(getBewerbungenAcceptBewerbungUrl(bewerbungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAcceptBewerbungPayload),
  });
};

export const getBewerbungenPatchEinwilligungUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${encodeURIComponent(String(bewerbungId))}/account/einwilligung`;
};

/**
 * Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application.
 *
 * A grant is refused. Refuses, writing nothing: `role_not_held`, `choices_stale` and
 * `giving_not_allowed`.
 * @summary Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung
 */
export const bewerbungenPatchEinwilligung = async (
  bewerbungId: string,
  fLSeatEinwilligungPayload: FLSeatEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<void>(getBewerbungenPatchEinwilligungUrl(bewerbungId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSeatEinwilligungPayload),
  });
};

export const getBewerbungenDeclineBewerbungUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${encodeURIComponent(String(bewerbungId))}/decline`;
};

/**
 * Decline an application, recording who decided and the reason they gave, and owe each person it mailed the decline.
 *
 * The submission itself is untouched: a decline moves `status` and `decision` and nothing else,
 * so what the school wrote stays the record the decision was taken against. The mails carry the reason verbatim.
 * @summary Decline a Bewerbung
 */
export const bewerbungenDeclineBewerbung = async (
  bewerbungId: string,
  fLDeclineBewerbungPayload: FLDeclineBewerbungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLDeclineBewerbungResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLDeclineBewerbungResponse>(getBewerbungenDeclineBewerbungUrl(bewerbungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLDeclineBewerbungPayload),
  });
};

export const getBewerbungenResendEinwilligungUrl = (bewerbungId: string, seat: string) => {
  return `/api/v0/bewerbungen/${encodeURIComponent(String(bewerbungId))}/einwilligung/${encodeURIComponent(String(seat))}/resend`;
};

/**
 * Void one seat's link and owe its person a fresh one in the same transaction; the old link then opens nothing.
 *
 * Where one person holds two seats both entries are replaced, so the old links die on both and the one new link answers both.
 * The answer names the address and the seats as the write found them, so a seat write landing mid-request is where the link goes.
 * That seat's 14 days restart from today, no other seat's moving, and its reminder is owed again. The mirrored seat
 * is judged with the pressed one, a seat an erasure emptied is refused as an answered one is, and a
 * decision, an answer or an erasure landing while the request runs is refused too. A path naming no seat is a 404.
 * @summary Re-send one seat's confirmation link
 */
export const bewerbungenResendEinwilligung = async (
  bewerbungId: string,
  seat: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungEinwilligungResendResponse> => {
  return adminKeyTransport<FLBewerbungEinwilligungResendResponse>(getBewerbungenResendEinwilligungUrl(bewerbungId, seat), {
    ...options,
    method: "POST",
  });
};

export const getBewerbungenPostKontaktSeatUrl = (bewerbungId: string, seat: string) => {
  return `/api/v0/bewerbungen/${encodeURIComponent(String(bewerbungId))}/kontakte/${encodeURIComponent(String(seat))}`;
};

/**
 * „Sitz bearbeiten“: write the person into one seat and owe them their link in the same transaction.
 *
 * One write judged by the seat's state. A standing seat's person is replaced or their address corrected, a seat a
 * Widerspruch emptied is filled, and a confirmed seat's person gives way, the record written being administrative
 * and confirming nothing: the person's own link is what asks them, and an acceptance waits on that answer as it
 * waits on the other two. Where one person holds two seats both are written from one press and one link answers
 * both. The link the seat's last holder was sent opens nothing afterwards, and that seat's 14 days restart from today
 * EVEN WHERE THEY HAD PASSED: left where they were, the person would be handed a link that opens nothing.
 *
 * Refused on a stale `version` (`version_stale`), on an application already decided (`bewerbung_already_decided`), on
 * a seat erased at its person's request, the claimed mirror included (`bewerbung_seat_already_answered`), and on an
 * address or a number another contact person on this application already holds (`bewerbung_kontakt_email_taken`,
 * `bewerbung_kontakt_phone_taken`). A path naming no seat is a 404.
 * @summary Write the person one contact seat holds and mail them a fresh link
 */
export const bewerbungenPostKontaktSeat = async (
  bewerbungId: string,
  seat: string,
  fLBewerbungKontaktSeatPayload: FLBewerbungKontaktSeatPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungKontaktSeatResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLBewerbungKontaktSeatResponse>(getBewerbungenPostKontaktSeatUrl(bewerbungId, seat), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungKontaktSeatPayload),
  });
};

export const getGrantsGetGrantsUrl = () => {
  return `/api/v0/grants`;
};

/**
 * List every grant by address: its tier, when it holds, and when a handover to it completes.
 *
 * Uncapped, as few people hold one. A future `effective_from` is an addition still waiting, and `owner_from` a handover still waiting.
 * @summary List who may enter the administration
 */
export const grantsGetGrants = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLGrantsListResponse> => {
  return adminKeyTransport<FLGrantsListResponse>(getGrantsGetGrantsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGrantsPostGrantUrl = () => {
  return `/api/v0/grants`;
};

/**
 * Add an address as `administration`, holding once `GRANT_WAIT_HOURS` have passed. No request grants `owner`.
 *
 * Only the owner adds (`grant_only_owner`). The address is stored folded to its sign-in identifier, the spelling every admin-tier
 * request is judged by. Refused where a grant already holds the address, a waiting one included (`grant_exists`), and where the ban
 * list holds it (`grant_barred`). Any live address change at that address ends here: left standing, its switch could carry a grant
 * to an address nobody named. Every holder in effect and the person named are told in the same transaction, and told what date
 * it holds from.
 * @summary Add an administrator
 */
export const grantsPostGrant = async (
  fLPostGrantPayload: FLPostGrantPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLGrantWriteResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLGrantWriteResponse>(getGrantsPostGrantUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostGrantPayload),
  });
};

export const getGrantsPostHandoverPassUrl = () => {
  return `/api/v0/grants/handover`;
};

/**
 * Move the owner role to the row whose `owner_from` has passed, the old owner staying an administrator, and tell every holder.
 *
 * Late rather than early where a pass is missed: nothing moves until one runs, and a quiet pass writes nothing.
 * @summary Complete a handover whose wait has ended
 */
export const grantsPostHandoverPass = async (options?: Parameters<typeof systemKeyTransport>[1]): Promise<FLGrantHandoverPassResponse> => {
  return systemKeyTransport<FLGrantHandoverPassResponse>(getGrantsPostHandoverPassUrl(), {
    ...options,
    method: "POST",
  });
};

export const getGrantsDeleteGrantUrl = (grantId: string) => {
  return `/api/v0/grants/${encodeURIComponent(String(grantId))}`;
};

/**
 * Remove one grant at once, HARD, no soft form: the removed address meets `actor_not_admin` on its next request.
 *
 * Only the owner removes (`grant_only_owner`), judged before anything about the target is answered. 404 where no grant has the id.
 * Refused for the `owner` row (`grant_owner`), which leaves only by a handover. A row still waiting is withdrawn by the same press,
 * and a handover waiting on the row ends with it, told apart. Every holder in effect and the person named are told in the same
 * transaction. An address change standing on the row is left to run, as a
 * change of an address holding no grant.
 * @summary Remove an administrator, or withdraw a waiting addition
 */
export const grantsDeleteGrant = async (grantId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLGrantWriteResponse> => {
  return adminKeyTransport<FLGrantWriteResponse>(getGrantsDeleteGrantUrl(grantId), {
    ...options,
    method: "DELETE",
  });
};

export const getGrantsDeleteHandoverUrl = (grantId: string) => {
  return `/api/v0/grants/${encodeURIComponent(String(grantId))}/handover`;
};

/**
 * Stop a waiting handover, the role staying with the owner.
 *
 * Only the owner stops one (`grant_only_owner`), which a press landing after the pass no longer is. 404 where the row waits on
 * no handover. Every holder in effect is told in the same transaction.
 * @summary Stop a waiting handover
 */
export const grantsDeleteHandover = async (
  grantId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLGrantWriteResponse> => {
  return adminKeyTransport<FLGrantWriteResponse>(getGrantsDeleteHandoverUrl(grantId), {
    ...options,
    method: "DELETE",
  });
};

export const getGrantsPostHandoverUrl = (grantId: string) => {
  return `/api/v0/grants/${encodeURIComponent(String(grantId))}/handover`;
};

/**
 * Start handing the owner role to a current administrator, completed by the hourly pass once `OWNER_WAIT_DAYS` have passed.
 *
 * Only the owner starts one (`grant_only_owner`), and the owner stays the owner until it completes. 404 where no grant has the id.
 * Refused for the owner's own row (`grant_owner`), while any handover waits (`grant_handover_waiting`), for a row whose own wait
 * still runs (`grant_not_in_effect`), and where the ban list holds the address (`grant_barred`). Every holder in effect is told in
 * the same transaction, and told what date it completes on.
 * @summary Hand the owner role over to an administrator
 */
export const grantsPostHandover = async (grantId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLGrantWriteResponse> => {
  return adminKeyTransport<FLGrantWriteResponse>(getGrantsPostHandoverUrl(grantId), {
    ...options,
    method: "POST",
  });
};

export const getIdentityPostAccountErasureUrl = () => {
  return `/api/v0/identity/account/erasure`;
};

/**
 * Erase every record the signed-in address holds, at once and as one write, and answer how many of each kind went.
 *
 * PERSON TIER. The owner is refused until a handover (`owner_erasure`), since nobody else could name an owner, and a
 * person holding a grant erases it with the rest. No other precondition stands in front of a person's own request, a
 * pupil in a live squad and a referee booked on a fixture still to be played included. Nothing is counted against the
 * person's day.
 *
 * Removed: the pupil record and every squad row it holds, so the team reads one player fewer, its match reports' goals
 * and cards and its entries on line-ups locked before their match moving to the one row that holds no person, and its
 * entries on line-ups not yet locked going; the referee record,
 * every fixture it was booked on moving to the one row that holds no person and keeping its own fee, and every
 * confirmation it was asked for, answered or not; every registration at the address, pending or declined; another
 * address's pending change naming this one as its new address, every record it would move standing at its own; every
 * grant the address holds, every administrator being told it ended.
 * Emptied: every contact seat the address holds on a team's season row and on an application of any status, the row
 * and its other seats standing.
 * Every reason the person typed answering a match confirmation, from any seat they held, goes from its row, the answer
 * standing. Every match report stands, its remarks and entries included, and names no referee. Every record the
 * person made as an administrator or decided as a seat holder -- a grant, a ban, an invitation, an application's or a
 * registration's decision -- and every log row naming their address name a fixed marker in their place.
 *
 * An address holding nothing is answered with every count zero rather than refused. The 409 answers only a database
 * changed by hand, a second nameless referee meeting the ghost's name index. The 404 is published for the steps' reads by
 * id, which no request can meet: every id comes from the subject read in the same snapshot. The sign-in account is not
 * touched here: deleting it is the caller's, once this has answered.
 * @summary Erase every record the signed-in address holds
 */
export const identityPostAccountErasure = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLErasureResponse> => {
  return adminKeyTransport<FLErasureResponse>(getIdentityPostAccountErasureUrl(), {
    ...options,
    method: "POST",
  });
};

export const getIdentityGetAccountErasureViewUrl = () => {
  return `/api/v0/identity/account/erasure/view`;
};

/**
 * Answer what `POST /identity/account/erasure` would remove for the signed-in address, by kind and by name.
 *
 * Read through that erasure's own selections in one snapshot, so it names every record of the person's own the erasure
 * removes or empties, an unconfirmed seat, a retired row and a declined registration among them, and no other. No address
 * and no birthdate is answered. Another address's pending change naming this one is counted and not named, once its link
 * has reached this mailbox: its records are not this address's until it takes effect. Reached and not named: the fixtures
 * booking their referee record, which move onto the ghost; the confirmations their referee record was asked for, which go;
 * the goals, cards and locked line-ups' entries of their pupil record, which move onto the ghost, and its entries on
 * line-ups not yet locked, which go; every reason they typed
 * answering a match confirmation, from any
 * seat they held, which goes from its row, the answer standing; what the person made or decided for others, which names a
 * marker in their place; and the log rows naming their address. Written besides: the notice that their grant ended, which
 * every administrator is sent. `admin_tier` is the tier of the grant the address holds, or null; a dead spelling of the
 * address, which admits nobody, goes with the erasure unnamed.
 * @summary Show what an erasure of the signed-in address would remove
 */
export const identityGetAccountErasureView = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAccountErasureViewResponse> => {
  return adminKeyTransport<FLAccountErasureViewResponse>(getIdentityGetAccountErasureViewUrl(), {
    ...options,
    method: "GET",
  });
};

export const getIdentityPostErasureUrl = () => {
  return `/api/v0/identity/erasure`;
};

/**
 * Erase every record an address holds, on a request that person made by mail, at once and as one write, and answer how many of each kind went.
 *
 * ADMIN TIER. It runs the erasure `POST /identity/account/erasure` runs and refuses nothing about the person's own
 * state: a pupil in a live squad and a referee booked on a fixture still to be played are erased on one pass. Three
 * refusals are about who asks. The administrator's own address is refused (`own_address`): their account page serves it,
 * or the owner. An address holding a grant is refused unless the administrator holds an owner's power (`admin_address`),
 * judged inside the write. An address another address's pending change would move to is refused, judged inside the write,
 * where that address holds a grant and the administrator no owner's power (`foreign_address_change`): the erasure ends the
 * change, a discard only the owner makes of it.
 *
 * `reason` names the request the erasure answers, as free text. An address holding nothing is answered with every count
 * zero. The 404 and the 409 answer only a database changed by hand under the request. The sign-in account is not touched
 * here: deleting it is the caller's, once this has answered.
 * @summary Erase every record an address holds, on that person's request
 */
export const identityPostErasure = async (
  fLErasurePayload: FLErasurePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLErasureResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLErasureResponse>(getIdentityPostErasureUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLErasurePayload),
  });
};

export const getIdentitySweepErasureUrl = (params?: IdentitySweepErasureParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/identity/erasure/sweep?${stringifiedParams}` : `/api/v0/identity/erasure/sweep`;
};

/**
 * Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.
 *
 * The rule, read from the seasons' stored statuses at each call: a pupil is due once they hold no squad row, live or retired,
 * in the latest `past` season, in any season with a greater id or in the running one, and no registration still `submitted`
 * at their address, compared as the sign-in folds it. While no season is `past` nobody is due, and `completed_saison_id`
 * is null. A pupil holding no address is never due: nothing else erases by a name.
 *
 * Each pupil is deleted in a transaction of their own, which first judges them again: one who has gained a squad row or a
 * pending registration since this call read them, the two committing before that transaction writes included, or whom another
 * call deleted first, is counted `skipped` and left standing. A squad entry or a registration meeting that transaction's
 * writes waits for it to end: the entry then finds nobody, and the registration is stored for a pupil already gone.
 * Two calls at once therefore delete each pupil once. Deleted are
 * the pupil's own data alone: the pupil record, every squad row it holds and every registration at the address, a declined
 * one included. A contact seat, a referee record, a grant and anything else held at the same address stand.
 *
 * **A pass is a run of calls, each handing the next the `after` the last answered**, the first naming none; it ends at the call
 * answering `after` null. A call reaches at most a fixed share of the due pupils after `after`, in `_id` order, and the pass
 * holds no state on the server. A pupil whose deletion fails, the database refusing it or anything else, is counted
 * `failed`, logged by id and passed, so a failing record holds back nobody behind it in the pass; it stays due, and
 * the next pass tries it again. Where the request's deadline cuts the call, it stops at that pupil, warns once, and answers
 * what it did; the rest stay due, and the pass goes on from the next call. `remaining` counts the pupils due after the
 * call, those it failed or passed over among them, so it is no stopping condition. No body: the call takes no season and no
 * limit.
 *
 * The 409 is published because the duplicate-key trace reaches the registry's insert of the pupils' sentinel and reads no
 * handler; this call counts that failure as any other and never answers it.
 * @summary Delete one share of the pupils the season-after rule makes due
 */
export const identitySweepErasure = async (
  params?: IdentitySweepErasureParams,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLErasureSweepResponse> => {
  return systemKeyTransport<FLErasureSweepResponse>(getIdentitySweepErasureUrl(params), {
    ...options,
    method: "POST",
  });
};

export const getIdentityGetErasureViewUrl = () => {
  return `/api/v0/identity/erasure/view`;
};

/**
 * Count what `POST /identity/erasure` would remove or empty for this address, by kind, and name nothing.
 *
 * ADMIN TIER. Takes that erasure's own payload address and reads through its own selections in one snapshot. `spiele`
 * counts the fixtures still to be played that a referee row is booked on. `address_change` counts the address's own live
 * change and each other address's change naming it, leaving out a grant holder's for an administrator without an owner's
 * power, since counting it would answer whether a typed address is its new one. Stores nothing.
 *
 * Refused as the erasure is: the administrator's own address (`own_address`), an address holding a grant unless the
 * administrator holds an owner's power (`admin_address`).
 * @summary Count what an erasure of an address would remove
 */
export const identityGetErasureView = async (
  fLErasureAddressPayload: FLErasureAddressPayload,
  options?: Parameters<typeof adminKeyReadTransport>[1],
): Promise<FLErasureViewResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyReadTransport<FLErasureViewResponse>(getIdentityGetErasureViewUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLErasureAddressPayload),
  });
};

export const getIdentityGetReferencesUrl = () => {
  return `/api/v0/identity/references`;
};

/**
 * Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in.
 * @summary Say which of these sign-in addresses no record references
 */
export const identityGetReferences = async (
  fLReferencesPayload: FLReferencesPayload,
  options?: Parameters<typeof systemKeyReadTransport>[1],
): Promise<FLReferencesResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyReadTransport<FLReferencesResponse>(getIdentityGetReferencesUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLReferencesPayload),
  });
};

export const getIdentityGetSignInUrl = () => {
  return `/api/v0/identity/sign_in`;
};

/**
 * Answer what the sign-in gate decides on for one mailbox: two flags, its ban and its grant's tier, and never a record.
 *
 * The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with both flags false.
 * @summary Say whether one mailbox may be offered a sign-in
 */
export const identityGetSignIn = async (
  fLSubjectPayload: FLSubjectPayload,
  options?: Parameters<typeof systemKeyReadTransport>[1],
): Promise<FLSignInResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyReadTransport<FLSignInResponse>(getIdentityGetSignInUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSubjectPayload),
  });
};

export const getIdentityGetSubjectUrl = () => {
  return `/api/v0/identity/subject`;
};

/**
 * Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its grant.
 *
 * The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with three empty lists rather
 * than a 404.
 * @summary Say which league records one mailbox holds
 */
export const identityGetSubject = async (
  fLSubjectPayload: FLSubjectPayload,
  options?: Parameters<typeof systemKeyReadTransport>[1],
): Promise<FLSubjectResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyReadTransport<FLSubjectResponse>(getIdentityGetSubjectUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSubjectPayload),
  });
};

export const getOutboxPostEventUrl = () => {
  return `/api/v0/outbox/event`;
};

/**
 * Record what the mail provider reported about one message, on the row of the mail it was.
 *
 * The row is the one `id` names, which the send carried as a tag, so an event arriving before the send's report finds
 * it all the same. Applied only where the row's delivery state is one the event's may follow -- a delay before
 * anything, a complaint after a delivery, nothing after a refusal -- so a redelivery or an event arriving after a later
 * one changes nothing. Both answer `applied: false`, as do an id no row has and a row whose address was replaced since
 * its send, which keeps its key alone, rather than a refusal the provider
 * would retry for hours. A delivery applied to a mail about an application opens the closed chase of every seat holding
 * its address, in the same transaction.
 * @summary Record one delivery event on its mail's row
 */
export const outboxPostEvent = async (
  fLOutboxEventPayload: FLOutboxEventPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLOutboxEventResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyTransport<FLOutboxEventResponse>(getOutboxPostEventUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLOutboxEventPayload),
  });
};

export const getOutboxPostHandoutUrl = () => {
  return `/api/v0/outbox/handout`;
};

/**
 * Claim, a page at a time, the owed mails no claim holds, for five minutes, and hand each out.
 *
 * The sign-in library's mails come first, each tried once, then the rest, each oldest first. A mail past its deadline
 * is given up rather than handed out, and counted in `abandoned`, as is one whose facts no kind reads, which would
 * hold every claim until its deadline. A mail to an address a ban holds is stopped as
 * `barred`, the ban's own notice alone excepted. A mail to a club's contact seats is stopped as `dropped` where no
 * confirmed seat of that club's season row holds its address any more. A mail carrying a link has it minted here, its hash written to
 * the record the mail is about and the raw token answered once, in `token`; a record gone since, or one no longer
 * holding the mail's address where its link names it, stops the mail as `dropped`. A second call inside the lease is
 * answered none of these rows. The caller sends each under the idempotency key its `attempt` names and reports every
 * outcome, with `lease`, to `POST /outbox/result`;
 * where the lease lapses first, the next call hands the row out again with a fresh link and number, every earlier link
 * staying valid unless the mail's link supersedes them. Server to server alone: the answer names addresses, live links
 * and secrets.
 * @summary Claim the mails owed now and hand them out
 */
export const outboxPostHandout = async (options?: Parameters<typeof systemKeyTransport>[1]): Promise<FLOutboxHandoutResponse> => {
  return systemKeyTransport<FLOutboxHandoutResponse>(getOutboxPostHandoutUrl(), {
    ...options,
    method: "POST",
  });
};

export const getOutboxPostResultUrl = () => {
  return `/api/v0/outbox/result`;
};

/**
 * Settle the named mail, where the named claim still holds it, by the outcome of its send, and nothing else.
 *
 * `sent` records the provider's message id; `held` a deployment that sends no mail; `abandon` a
 * refusal every send would meet, any 4xx but a 429. A failed send's `delivery_reason`, the provider's own name for the refusal,
 * is recorded on the row, the send's one record of why. `retry`, for a 429, a 5xx or a send that never reached the
 * provider, hands the mail back for a drain a minute from now, or gives it up where it has grown past its deadline; a
 * mail of the sign-in library is given up at once, its library's repair being a fresh one. A mail the claim does not
 * hold -- unknown, settled already, or claimed since by another drain after this claim lapsed -- is left alone and
 * counted in `ignored`; the answer counts one outcome. Each write names the claim, so its check and the outcome are
 * one atomic operation on one row, needing no transaction; a settled row keeps no facts and no secret.
 * @summary Settle one mail a claim handed out
 */
export const outboxPostResult = async (
  fLOutboxResultPayload: FLOutboxResultPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLOutboxResultResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyTransport<FLOutboxResultResponse>(getOutboxPostResultUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLOutboxResultPayload),
  });
};

export const getOutboxPostSignInUrl = () => {
  return `/api/v0/outbox/sign_in`;
};

/**
 * Owe one mail the sign-in library sends -- the code, a passkey notice, the deletion link -- to the address named.
 *
 * Every call owes a mail of its own, under a key minted here: the library asks for each send once, and nothing repeats
 * the call. `secret` is stored as it arrives, encrypted under a key this service never holds, and dropped once the mail
 * is settled; `valid_until` is both the last moment a hand-out may send it and the moment the row is deleted, settled
 * or not.
 * @summary Owe one mail of the sign-in library
 */
export const outboxPostSignIn = async (
  fLOutboxSignInPayload: FLOutboxSignInPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return systemKeyTransport<void>(getOutboxPostSignInUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLOutboxSignInPayload),
  });
};

export const getRegistrierungenPostRegistrierungUrl = () => {
  return `/api/v0/registrierungen`;
};

/**
 * Store one pupil's registration for the team and season the link belongs to, and owe its confirmation mail.
 *
 * Everything the league decides -- the team, the season, `status`, `submitted_at` and the
 * deadline -- is taken off the invite and the clock and never off the payload. The mail is owed in
 * the Postausgang in the same transaction, its link minted when it is handed out; no token is answered.
 *
 * An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * registration it holds, stores none and owes no second mail, whatever its body says: a form whose details changed
 * since its last press sends a new key. The key goes with its registration, so one pressed again after the team
 * admitted or declined the pupil, or after the row lapsed, is a new registration.
 *
 * A mailbox already holding `OPEN_LINKS_PER_MAILBOX` unanswered links of the season is owed nothing and nothing refuses
 * the press: the row stands unmailed and lapses on its deadline, and the answer is the same either way.
 * @summary Register through a team's link
 */
export const registrierungenPostRegistrierung = async (
  fLPostRegistrierungPayload: FLPostRegistrierungPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLPostRegistrierungResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<FLPostRegistrierungResponse>(getRegistrierungenPostRegistrierungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostRegistrierungPayload),
  });
};

export const getRegistrierungenPatchEinwilligungUrl = (registrierungId: string) => {
  return `/api/v0/registrierungen/account/${encodeURIComponent(String(registrierungId))}/einwilligung`;
};

/**
 * Withdraw the publication scope or the media consent the signed-in pupil gave on their own pending registration.
 *
 * A grant is refused, and a PATCH moving neither writes nothing. Refuses, writing nothing: `role_not_held`,
 * `choices_stale` and `giving_not_allowed`.
 * @summary Withdraw a pupil's own publication and media consent on their pending registration
 */
export const registrierungenPatchEinwilligung = async (
  registrierungId: string,
  fLAccountEinwilligungPayload: FLAccountEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<void>(getRegistrierungenPatchEinwilligungUrl(registrierungId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAccountEinwilligungPayload),
  });
};

export const getRegistrierungenPostConfirmationUrl = () => {
  return `/api/v0/registrierungen/confirmation`;
};

/**
 * Record a pupil's own answer for the registration their link opens, which stays pending until the team decides.
 *
 * Refuses, writing nothing: `link_invalid`, `link_expired`, its club having left the season among its cases,
 * `confirmation_exists`, `confirmation_age` and `media_age`.
 * @summary Confirm one registration and record the pupil's consent
 */
export const registrierungenPostConfirmation = async (
  fLRegistrierungConfirmationPayload: FLRegistrierungConfirmationPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLRegistrierungConfirmationResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<FLRegistrierungConfirmationResponse>(getRegistrierungenPostConfirmationUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungConfirmationPayload),
  });
};

export const getRegistrierungenGetConfirmationViewUrl = () => {
  return `/api/v0/registrierungen/confirmation/view`;
};

/**
 * What the confirmation page renders for the registration this token opens, and nothing of the pupil but the day they answered.
 *
 * A POST, so the token travels in the body. A confirmed or expired link is served in that state, a link whose club has
 * left the season reading expired; only a token no registration holds is refused (`link_invalid`).
 * @summary What one registration confirmation link opens
 */
export const registrierungenGetConfirmationView = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyReadTransport>[1],
): Promise<FLRegistrierungConfirmationViewResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyReadTransport<FLRegistrierungConfirmationViewResponse>(getRegistrierungenGetConfirmationViewUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getRegistrierungenPostInvitationViewUrl = () => {
  return `/api/v0/registrierungen/invitation/view`;
};

/**
 * Answer what this registration link is for: the team, its school, the season, and what the form may offer.
 *
 * A POST because the link value travels in the body and never in a path the edge would log. A paused
 * or ended window is a STATE here rather than a refusal, so such a link reads as closed rather than as
 * invalid; only a link that opens no live invite, or whose team has left the season, is refused.
 * @summary What a registration link opens
 */
export const registrierungenPostInvitationView = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyReadTransport>[1],
): Promise<FLInvitationViewResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyReadTransport<FLInvitationViewResponse>(getRegistrierungenPostInvitationViewUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getRegistrierungenGetOpenRegistrierungenUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/registrierungen/kader/${encodeURIComponent(String(teamId))}/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Every pending registration for this team's season, each marked admissible or not by whether the pupil has confirmed it.
 *
 * Each is marked `kader_full` where admitting it now would meet the squad's cap, by the verdict the admission refuses on.
 * A confirmed row names the stored person its address resolves to, flagged where that person's name or birthdate
 * differs. An unconfirmed row names nobody: its address is unproven.
 * No address, telephone number, birthdate or consent record is served for anybody. Newest first, and no
 * more than `app/api/registrierungen/crud.py :: OPEN_REGISTRIERUNGEN_CAP` of them, the confirmed ones taken before
 * any unconfirmed one, so no flood of rows typed through the team's link and never confirmed hides a row a pupil
 * confirmed; `complete` is false where the cap cut some.
 * @summary A team's pending registrations for one season
 */
export const registrierungenGetOpenRegistrierungen = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLOpenRegistrierungenResponse> => {
  return adminKeyTransport<FLOpenRegistrierungenResponse>(getRegistrierungenGetOpenRegistrierungenUrl(teamId, saisonId), {
    ...options,
    method: "GET",
  });
};

export const getRegistrierungenGetRegistrierungenAdminUrl = (params: RegistrierungenGetRegistrierungenAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/registrierungen/list/admin?${stringifiedParams}` : `/api/v0/registrierungen/list/admin`;
};

/**
 * The Registrierungen page in one read: the season's pending rows, newest first, each named and with its club.
 *
 * The page narrows what the read holds; a declined row waits out its 14 days and asks nothing of an administrator.
 * `confirmed` says whether the pupil answered their own link, `unmailed` whether the row was owed none, its mailbox past
 * `OPEN_LINKS_PER_MAILBOX`. 404 where no season holds that id. Degrades rather than
 * refusing, as `GET /bewerbungen/list/admin` does: the rows are written through a link anybody it reached can use, so a
 * tripwire would hand them the power to 500 this page, and `complete` reports the cut.
 * @summary One Saison's pending Registrierungen for its list
 */
export const registrierungenGetRegistrierungenAdmin = async (
  params: RegistrierungenGetRegistrierungenAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLRegistrierungenAdminListResponse> => {
  return adminKeyTransport<FLRegistrierungenAdminListResponse>(getRegistrierungenGetRegistrierungenAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getRegistrierungenSweepRegistrierungenUrl = (saisonId: string) => {
  return `/api/v0/registrierungen/sweep/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Run the three registration retention clocks over one season, as of today in Europe/Berlin.
 *
 * A declined registration is erased 14 days after the decision. Once the season is `past`, every registration still awaiting a
 * decision is erased whatever the pupil answered, because no admission can be taken for a season that is over; the deadline
 * clock does not run for a `past` season, whose own end takes every row it reads.
 *
 * Otherwise an unconfirmed registration strictly past its deadline is erased with no notice at all, the confirmation mail having
 * named that day. Every removal names this season alone and is made inside a transaction.
 *
 * A registration whose write fails, the database refusing it or anything else, is passed over alone and logged by id: the rest of
 * its clock's page goes, and it stays due, so the next pass meets it again and one failing record holds back no clock and
 * nobody behind it. `failed` sums the rows each of the three clocks passed over.
 *
 * 404 where no season has the id. Idempotent: a run after every due row went writes nothing.
 * @summary Run one season's registration retention clocks
 */
export const registrierungenSweepRegistrierungen = async (
  saisonId: string,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLRegistrierungSweepResponse> => {
  return systemKeyTransport<FLRegistrierungSweepResponse>(getRegistrierungenSweepRegistrierungenUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getRegistrierungenAdmitUrl = (registrierungId: string) => {
  return `/api/v0/registrierungen/${encodeURIComponent(String(registrierungId))}/admit`;
};

/**
 * Admit one confirmed registration: the person it resolves to, or a new one, joins the team's squad, and the registration is erased.
 *
 * The person survives the season, so the admission first looks for them: the stored person holding the
 * registration's address IS that person, and is updated with the registration's name, its birthdate and its freshly
 * confirmed consent record. Where that person's
 * name or birthdate differs, `spieler_id` must name them (the team said it is the same person). With no such
 * person, `spieler_id` is null for a new one. A pending address change of theirs stands, asked over the address
 * this admission proves again.
 *
 * The squad row takes the registration's number, position and Stufe, no role, and a Nachnominierung marker judged on
 * the day the registration was submitted, never today's and never lifted from a retired row; this person's retired
 * row of this season is rewritten rather than a second one written, whichever team it was on. The registration is
 * deleted in the same transaction, so a second press meets no row, and with it every other pending registration of
 * its address this season, whichever team it was for: each would be refused as already in a squad. Nobody is mailed
 * about any of them, and the admission's act counts them.
 *
 * Refuses, in this order: no registration with this id or no seat on its team's season, alike (`role_not_held`), one
 * the team has declined (404), a registration the pupil has not confirmed (`registrierung_unconfirmed`), a Stufe the season does not
 * offer (`registrierung_stufe_not_allowed`), a
 * `spieler_id` that is not the person this registration may be admitted into (`registrierung_person_not_named`), a person
 * already playing in a squad this season (`registrierung_already_in_kader`) and a full squad (`kader_full`). Nothing is
 * written on any of them.
 * @summary Admit a registration into the team's squad
 */
export const registrierungenAdmit = async (
  registrierungId: string,
  fLRegistrierungAdmitPayload: FLRegistrierungAdmitPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLRegistrierungAdmissionResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLRegistrierungAdmissionResponse>(getRegistrierungenAdmitUrl(registrierungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungAdmitPayload),
  });
};

export const getRegistrierungenDeclineUrl = (registrierungId: string) => {
  return `/api/v0/registrierungen/${encodeURIComponent(String(registrierungId))}/decline`;
};

/**
 * Decline one pending registration, confirmed or not: its state and the decision are written, and the pupil's note owed.
 *
 * The decision records a reason from a closed set, never free text:
 * `other_person` where the team answered that the registration is not the person its address belongs to. The
 * row stays until the retention sweep erases it 14 days later. The note is owed in the same transaction, and only
 * where the pupil confirmed their address: an unconfirmed one may be a stranger's, typed by whoever held the link. A
 * confirmation mail still owed is dropped in the same transaction, its link one the confirmation refuses on a declined row.
 *
 * Refuses, in this order: no registration with this id or no seat on its team's season, alike (`role_not_held`), and
 * one the team has declined already (404).
 * @summary Decline a registration
 */
export const registrierungenDecline = async (
  registrierungId: string,
  fLRegistrierungDeclinePayload: FLRegistrierungDeclinePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLRegistrierungDeclineResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLRegistrierungDeclineResponse>(getRegistrierungenDeclineUrl(registrierungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungDeclinePayload),
  });
};

export const getSaisonsPostSaisonUrl = () => {
  return `/api/v0/saisons`;
};

/**
 * Create the next season, always `future`, from its two days, answering the id it minted.
 *
 * The server names it: the year after the newest stored season's, or the league's first where none is stored, so a
 * season is never created out of turn. Its rules carry on from that newest season, or are the league's first season's
 * (`FIRST_SAISON_RULES`), and its two windows start closed, each set in the season's own editor. Refused while a
 * `future` season stands (`create_saison_future_stands`), so a league holds at most one planned season, the loser of
 * two creates at once included (`find_saison_create_refusal`); then by the rules it carries on and by its span against
 * them. Making the season live is a separate step.
 * @summary Create a Saison
 */
export const saisonsPostSaison = async (
  fLPostSaisonPayload: FLPostSaisonPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostSaisonResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPostSaisonResponse>(getSaisonsPostSaisonUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostSaisonPayload),
  });
};

export const getSaisonsGetFrameUrl = () => {
  return `/api/v0/saisons/frame`;
};

/**
 * Every season the public may read, the newest first, and the one the site is on; that one is null for a league that has none.
 * @summary The season pages' frame
 */
export const saisonsGetFrame = async (options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLSaisonFrameResponse> => {
  return baseKeyTransport<FLSaisonFrameResponse>(getSaisonsGetFrameUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetLandingUrl = () => {
  return `/api/v0/saisons/landing`;
};

/**
 * The season the site is on, `before_start`, `running` or `decided`, null for a league that has none.
 *
 * Beside it, the application window open today by the rule the submission refuses on, the day the next one opens by
 * the judgement the form's page serves, whether a season not yet ended holds a window at all, and the league's figures
 * over every season the public reads, counted on every read. The windows and the figures are read beside the season's
 * two steps rather than after them, so they add no step to the read.
 * @summary The landing
 */
export const saisonsGetLanding = async (options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLLandingResponse> => {
  return baseKeyTransport<FLLandingResponse>(getSaisonsGetLandingUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSaisonsAdminUrl = (params?: SaisonsGetSaisonsAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/saisons/list/admin?${stringifiedParams}` : `/api/v0/saisons/list/admin`;
};

/**
 * List every season, the `future` ones every base-tier read withholds included, each with its start, play and decision states.
 *
 * The admin surfaces read here because a season is created `future` and clubs are entered while it
 * still is, so an admin who cannot see one cannot run the league. `begun` is the start every
 * start lock refuses on, the swap's, the replacement's and the rules freeze's; `taken_place` is what
 * fixes the start date (`saison_start_taken_place`); `decided` is the landing's own rule, all four places of the Finale in.
 * `count_teams` counts every club row of the season, one that left included, and `count_spiele` its fixtures.
 * `next_saison_id` is the id the next create mints, and `refusals.create` the code that create would be refused with
 * now, by its own judgement, or null.
 * @summary Every Saison for the admin surfaces
 */
export const saisonsGetSaisonsAdmin = async (
  params?: SaisonsGetSaisonsAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonsAdminListResponse> => {
  return adminKeyTransport<FLSaisonsAdminListResponse>(getSaisonsGetSaisonsAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSaisonUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}`;
};

/**
 * One season the public may read, by its id.
 *
 * 404 where no season carries it or it is a `future` one.
 * @summary One Saison
 */
export const saisonsGetSaison = async (
  saisonId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSaisonsSingleResponse> => {
  return baseKeyTransport<FLSaisonsSingleResponse>(getSaisonsGetSaisonUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsPatchSaisonUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Update a season's dates and rules on the `version` the editor was served, answering the version stored, which its next save sends.
 *
 * `status` is on no payload. Editing the points moves every league table on the NEXT READ, standings being derived. What a
 * started or drawn season has fixed is refused, as is a rule narrowed below what it holds. The start date moves until a
 * fixture of the season has taken place (`saison_start_taken_place`), and later only while no club's exit is stored
 * (`saison_start_austritt_stored`, its `latest` the stored start); the rules freeze reads the STORED start, so a season
 * started too early is unlocked by one save moving its start and a second changing its rules.
 * @summary Update a Saison's dates and rules
 */
export const saisonsPatchSaison = async (
  saisonId: string,
  fLPatchSaisonPayload: FLPatchSaisonPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPatchSaisonResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPatchSaisonResponse>(getSaisonsPatchSaisonUrl(saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSaisonPayload),
  });
};

export const getSaisonsActivateSaisonUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/activate`;
};

/**
 * Make this the active season, moving whichever holds `active` to `past` in one transaction.
 *
 * The only path to `status: "active"`. The outgoing season must be finished, a `past` target is
 * refused, and every matchday of the target carries a date.
 * @summary Make this the active Saison
 */
export const saisonsActivateSaison = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLActivateSaisonResponse> => {
  return adminKeyTransport<FLActivateSaisonResponse>(getSaisonsActivateSaisonUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSaisonsGetSaisonAdminUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/admin`;
};

/**
 * Return what the season editor shows in one read: its season, clubs, shapes and matchdays, its acts' states and its links.
 *
 * The season is served a `future` one included, with its `version`, whether it has started (`begun`), whether a
 * fixture of it has taken place (`taken_place`) and whether it is decided (`decided`), by the landing's own rule.
 *
 * Each club's two flags are what the group swap's `swap_sides_taken_place` and the replacement's
 * `replace_sides_taken_place` read, so a picker closes exactly the pairs and rows those writes refuse; `begun` closes
 * both before either is pressed. `incoming_teams` is every club still in the league holding no row of the season,
 * which is what the replacement admits.
 *
 * `refusals` names, per act, the refusal its write would answer now, by that write's own judgement, so the editor
 * offers an act exactly where the write takes it. `invitations` is the registration links' press planned by the function
 * the press decides each team by, beside each team's live link and the day it was last sent.
 * Read outside a transaction: a write landing between this read and a press is judged by the press. 404 where no
 * season holds that id.
 * @summary One Saison for the admin editor
 */
export const saisonsGetSaisonAdmin = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonAdminResponse> => {
  return adminKeyTransport<FLSaisonAdminResponse>(getSaisonsGetSaisonAdminUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsSwapGruppenUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/gruppen/swap`;
};

/**
 * Exchange the groups of two clubs entered in this season, as one write.
 *
 * Every Gruppenphase fixture fielding either club has that side rewritten in the same transaction,
 * so each group stays a round robin. Neither `tore` nor `austritt` moves.
 * @summary Exchange two teams' groups
 */
export const saisonsSwapGruppen = async (
  saisonId: string,
  fLSwapGruppenPayload: FLSwapGruppenPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSwapGruppenResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLSwapGruppenResponse>(getSaisonsSwapGruppenUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSwapGruppenPayload),
  });
};

export const getSaisonsPostInvitationsDispatchUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/invitations/dispatch`;
};

/**
 * Give every admitted team of this season a fresh registration link and owe it to the team's confirmed seats, one mail each.
 *
 * **Every team mailed gets a fresh invite, and any link that team already held is REVOKED in the same per-team transaction** — the
 * copy in somebody's inbox opens nothing from that moment. The mails are owed in that transaction too, each minting its link when it is
 * handed out; no link is answered. A team this skips is left exactly as it was.
 *
 * Four skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that block
 * has been confirmed by its own person, or its live link was already sent. **The fourth is read off the day the live link was sent,
 * stored on it**, never off the Postausgang, whose row is erased a retention after it settles: pressing twice mails nobody twice, and
 * the team's own press is what mails a club its link again. **The first is read off the junction row's
 * `austritt` record**, so a team out of the season by either route is passed over; minting for one team by hand is not refused, that
 * being a deliberate act rather than a bulk one.
 *
 * Refused where the season has ended (`saison_past`); 404 where no season holds that id; a season holding no team answers zero
 * counts.
 *
 * **An administrator whose access is revoked while the mailing runs is refused `actor_not_admin` at the next team**: every team done before
 * that point holds its fresh link and its mails, and running the mailing again, as an administrator who still holds access, skips those
 * teams and reaches the rest.
 * @summary Mint every admitted team a link
 */
export const saisonsPostInvitationsDispatch = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLInvitationDispatchResponse> => {
  return adminKeyTransport<FLInvitationDispatchResponse>(getSaisonsPostInvitationsDispatchUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSaisonsGetKoRundeUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/ko_runde`;
};

/**
 * Every knockout matchday of one season with its matches in playing order, a side not yet known null beside its `quelle`.
 *
 * Empty before the draw; 404 for a season this tier may not read.
 * @summary One Saison's K.-o.-Runde
 */
export const saisonsGetKoRunde = async (saisonId: string, options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLKoRundeResponse> => {
  return baseKeyTransport<FLKoRundeResponse>(getSaisonsGetKoRundeUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSaisonOverviewUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/overview`;
};

/**
 * The administrator's Übersicht for one season: its open work on four cards, every card served, an empty one included.
 *
 * In order: `due`, each fixture whose clubs owe their answer past its deadline or by today; `ergebnisse`, each fixture
 * whose day has gone by without a result, and each report not adopted as it stands; `dates`, each club's open date
 * proposal, each fixture lacking its date, time, venue, referee or, in the knockout stage, a side's club and source,
 * each referee's own decline while the slot stays empty, and each fault of the bracket or its bookings; `bewerbungen`,
 * each undecided application to play the season. A fixture called off or struck out lacks nothing. Each row carries what its act
 * needs: the fixture with its `version`, each open party's confirmation row, a proposal's row and its date and hour.
 * Answers 404 for a season that does not exist. Writes nothing.
 * @summary One Saison's open work, card by card
 */
export const saisonsGetSaisonOverview = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonOverviewResponse> => {
  return adminKeyTransport<FLSaisonOverviewResponse>(getSaisonsGetSaisonOverviewUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSpielUrl = (saisonId: string, spielId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/spiele/${encodeURIComponent(String(spielId))}`;
};

/**
 * One match as its page and its pop-up show it, each side of a group match with its group and `platz`; 404 outside a readable season.
 *
 * Each side's line-up from the moment its club stores one, the scorers and cards only while the report is adopted
 * and unchanged since, every pupil through the public mask.
 * @summary One Spiel's page
 */
export const saisonsGetSpiel = async (
  saisonId: string,
  spielId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpielPageResponse> => {
  return baseKeyTransport<FLSpielPageResponse>(getSaisonsGetSpielUrl(saisonId, spielId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsDeleteSpielplanUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/spielplan`;
};

/**
 * Return the season to undrawn: matchdays, fixtures and watermark, in one transaction.
 *
 * Every fixture's confirmations go with it.
 *
 * The replace's window bounds it (`spielplan_undraw_outside_its_window`), and a submitted match report refuses it
 * (`spielplan_berichte_submitted`). Undoing the draw is what reopens the shape rules to `PATCH` and the groups to
 * an entry.
 * @summary Undraw this Saison's Spielplan
 */
export const saisonsDeleteSpielplan = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLUndrawSpielplanResponse> => {
  return adminKeyTransport<FLUndrawSpielplanResponse>(getSaisonsDeleteSpielplanUrl(saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getSaisonsGetSpielplanUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/spielplan`;
};

/**
 * Every matchday of one season with its matches, in playing order, and the matchday to open on.
 *
 * The Spielplan and the Spielsuche both show this. 404 for a season this tier may not read.
 * @summary One Saison's Spielplan
 */
export const saisonsGetSpielplan = async (saisonId: string, options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLSpielplanResponse> => {
  return baseKeyTransport<FLSpielplanResponse>(getSaisonsGetSpielplanUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsPostSpielplanUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/spielplan`;
};

/**
 * Draw the whole season at once: every matchday and every fixture, undated, in one transaction.
 *
 * `shape` states the three rules the fixtures come out of, and is stored with them. `replace`
 * deletes both lists first, every fixture's confirmations with them, inside `spielplan_replace_outside_its_window`'s
 * window and on a season holding no submitted match report (`spielplan_berichte_submitted`): nothing writes the
 * removed rows back.
 * @summary Draw this Saison's Spielplan
 */
export const saisonsPostSpielplan = async (
  saisonId: string,
  fLGenerateSpielplanPayload?: FLGenerateSpielplanPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLGenerateSpielplanResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLGenerateSpielplanResponse>(getSaisonsPostSpielplanUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLGenerateSpielplanPayload),
  });
};

export const getSaisonsGetTabelleUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/tabelle`;
};

/**
 * Each group's standing over the group phase with its goals counted on every read, and how many of each group advance.
 *
 * A club that left the season keeps its row; it holds no `platz` where it left before its group was decided, and
 * neither does a club that has played no match, listed after every club that has; 404 for a season this tier may not
 * read.
 * @summary One Saison's Tabelle
 */
export const saisonsGetTabelle = async (saisonId: string, options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLTabelleResponse> => {
  return baseKeyTransport<FLTabelleResponse>(getSaisonsGetTabelleUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetTeamsUrl = (saisonId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/teams`;
};

/**
 * The clubs of one season by name, each under the name and shorthand it plays that season under.
 *
 * 404 for a season this tier may not read.
 * @summary One Saison's teams
 */
export const saisonsGetTeams = async (saisonId: string, options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLSaisonTeamsResponse> => {
  return baseKeyTransport<FLSaisonTeamsResponse>(getSaisonsGetTeamsUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetTeamUrl = (saisonId: string, teamId: string) => {
  return `/api/v0/saisons/${encodeURIComponent(String(saisonId))}/teams/${encodeURIComponent(String(teamId))}`;
};

/**
 * One club in one season: the club, its row of the Tabelle, its matches and its squad.
 *
 * 404 for a season this tier may not read and for a club the season does not hold.
 * @summary One team's page in one Saison
 */
export const saisonsGetTeam = async (
  saisonId: string,
  teamId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLTeamPageResponse> => {
  return baseKeyTransport<FLTeamPageResponse>(getSaisonsGetTeamUrl(saisonId, teamId), {
    ...options,
    method: "GET",
  });
};

export const getSchiedsrichterGetSchiedsrichterUrl = (params?: SchiedsrichterGetSchiedsrichterParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/schiedsrichter?${stringifiedParams}` : `/api/v0/schiedsrichter`;
};

/**
 * An admin-tier read: a referee is a pupil, so their contact and school are private (`READ-CONTACT-001`).
 *
 * The fee is admin-tier as money, not as a pupil's detail (`READ-MONEY-001`). Deactivated ones
 * stay retrievable for a historical match.
 *
 * The ghost is OFF this list whatever the query string asks for: no person stands behind it, so
 * there is nothing an administrator could book it for, edit on it or reactivate it into
 * (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
 * @summary List Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichter = async (
  params?: SchiedsrichterGetSchiedsrichterParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterListResponse> => {
  return adminKeyTransport<FLSchiedsrichterListResponse>(getSchiedsrichterGetSchiedsrichterUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSchiedsrichterPostSchiedsrichterUrl = () => {
  return `/api/v0/schiedsrichter`;
};

/**
 * Create a referee and owe them their confirmation link.
 *
 * `inactive_since` is set to null here and is on no payload. **Entering a referee IS the
 * invitation**: the payload requires an email address, and there is no second press deciding
 * whether this person is asked, because a referee nobody asked is a name nobody consented to
 * publish. The link goes out through the Postausgang, which mints it; the answer names the address and the deadline.
 *
 * Refused where another referee holds the name (`duplicate_key`, naming `name`).
 * @summary Create a Schiedsrichter
 */
export const schiedsrichterPostSchiedsrichter = async (
  fLPostSchiedsrichterPayload: FLPostSchiedsrichterPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostSchiedsrichterResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPostSchiedsrichterResponse>(getSchiedsrichterPostSchiedsrichterUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostSchiedsrichterPayload),
  });
};

export const getSchiedsrichterPatchEinwilligungUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/account/${encodeURIComponent(String(schiedsrichterId))}/einwilligung`;
};

/**
 * Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.
 *
 * Writes those two on this one referee row, each moved choice with its evidence (`evidence.<choice>`), and nothing
 * else: the confirmation day, the day given and the wording they confirmed stand, and no fixture is written. The
 * public fixture list reads the scope off this row, so a withdrawal takes the name off every fixture page at that
 * list's next read. A PATCH moving neither choice writes nothing. A GRANT (`scope` to
 * `kader_public` or `media` to `true`) is taken on a live record alone; a withdrawal on a retired one too.
 *
 * Refuses, in this order: an id that is no confirmed referee record of this address (`role_not_held`); a
 * `evidence_state` other than the record's own, either choice having moved since the page was served
 * (`choices_stale`); a grant on a retired record (`giving_not_allowed`); a choice moving onto a grant under a label
 * other than its current wording's, the page loaded before a rewording (`grant_wording_stale`); `media` moving to
 * `true` where the stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is missing (`media_age`). Each
 * refusal writes nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this row; nothing here can.
 * @summary Change a signed-in referee's own publication and media consent
 */
export const schiedsrichterPatchEinwilligung = async (
  schiedsrichterId: string,
  fLSchiedsrichterAccountEinwilligungPayload: FLSchiedsrichterAccountEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<void>(getSchiedsrichterPatchEinwilligungUrl(schiedsrichterId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSchiedsrichterAccountEinwilligungPayload),
  });
};

export const getSchiedsrichterPostConfirmationUrl = () => {
  return `/api/v0/schiedsrichter/confirmation`;
};

/**
 * Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.
 *
 * The consent carries the publication scope they chose, the media answer beside it, the stamp and, on each choice's
 * evidence, the wording they were shown. It reaches this one collection and writes nothing on any fixture: a referee's
 * publication scope has one home, which the fixture list joins at read time to decide whether to publish the name each
 * fixture stores.
 *
 * Refuses, in this order: a token no referee holds (`link_invalid`), an entry already answered, confirmed or
 * declined (`confirmation_exists`), a link whose deadline has passed (`link_expired`), an age outside `minimum_age` to
 * `maximum_age` (`confirmation_age`, carrying the two as its bounds `min` and `max`), and a media consent from a referee below
 * `media_minimum_age` (`media_age`) -- the last two judged before anything is written, so a mistyped year spends nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this record. Nothing here can:
 * a withheld name would go on being served for as long as that entry lives.
 * @summary Confirm one Schiedsrichter's entry and consent
 */
export const schiedsrichterPostConfirmation = async (
  fLSchiedsrichterConfirmationPayload: FLSchiedsrichterConfirmationPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSchiedsrichterConfirmationResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<FLSchiedsrichterConfirmationResponse>(getSchiedsrichterPostConfirmationUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSchiedsrichterConfirmationPayload),
  });
};

export const getSchiedsrichterPostDeclineUrl = () => {
  return `/api/v0/schiedsrichter/confirmation/decline`;
};

/**
 * Record the referee's objection to the entry their link opens: its day, and nothing else of the person.
 *
 * The entry then goes on the clock its link started, the midnight after the deadline, as the privacy notice says of an
 * unconfirmed or declined one (`POST /schiedsrichter/sweep`). Until then no booking takes it and no
 * re-send or reactivation asks the person again. The objection is journalled.
 *
 * Refuses, in the confirmation's order: a token no referee holds (`link_invalid`), an entry already answered,
 * confirmed or declined (`confirmation_exists`), and a link whose deadline has passed (`link_expired`).
 * @summary Decline one Schiedsrichter's entry
 */
export const schiedsrichterPostDecline = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyTransport<void>(getSchiedsrichterPostDeclineUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getSchiedsrichterGetConfirmationViewUrl = () => {
  return `/api/v0/schiedsrichter/confirmation/view`;
};

/**
 * Answer what this token opens: the link's state and deadline, the age bounds, and the day of the person's own answer.
 *
 * **Nothing else** (`READ-REFEREE-002`): never a name, the school, the contact details, the fee, the birthdate or the
 * entry's id, all of which are behind `READ-CONTACT-001`. The link went to an address an administrator typed and nobody has
 * confirmed, which behind a typo is a stranger's. A POST that reads, so the token travels in a body and never in a second
 * URL.
 *
 * Refuses only a token no referee holds (`link_invalid`): a confirmed or an expired link
 * is SERVED in that state rather than refused, so a reopened link shows what became of it. `answered_at` is the day the
 * state's answer was given, the consent's or the objection's, and null on every state showing none.
 * @summary What one Schiedsrichter confirmation link opens
 */
export const schiedsrichterGetConfirmationView = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyReadTransport>[1],
): Promise<FLSchiedsrichterConfirmationViewResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return baseKeyReadTransport<FLSchiedsrichterConfirmationViewResponse>(getSchiedsrichterGetConfirmationViewUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getSchiedsrichterGetSelfSaisonsUrl = () => {
  return `/api/v0/schiedsrichter/self/saisons`;
};

/**
 * Every season in which a fixture is booked to one of the signed-in address's live, confirmed referee records, the newest first.
 *
 * A planned season is served as any other, and a referee booked nowhere is answered an empty list. Refuses an address
 * holding no live, confirmed referee record (`role_not_held`).
 * @summary The seasons a signed-in referee has fixtures in
 */
export const schiedsrichterGetSelfSaisons = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLOwnSaisonsResponse> => {
  return adminKeyTransport<FLOwnSaisonsResponse>(getSchiedsrichterGetSelfSaisonsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSchiedsrichterGetSelfSpieleUrl = (saisonId: string) => {
  return `/api/v0/schiedsrichter/self/spiele/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Every fixture of this season booked to one of the signed-in address's live, confirmed referee records, one row a fixture.
 *
 * Each with the fixture as it stands, the state of the booking they were asked to confirm and the row an answer names,
 * their own decline's reason, whether the league recorded the answer for them, whether the fixture takes a report now
 * (from its kick-off, or from its day where it holds no time), and when its report was first sent. Nobody's address is
 * served, and no reason an administrator entered. Open work first, a booking to answer or a report owed; then the
 * fixtures to come, each by its day; then the days gone by, the latest first. A season holding no fixture of theirs,
 * or none at all, answers an empty list.
 *
 * Refuses an address holding no live, confirmed referee record (`role_not_held`).
 * @summary A signed-in referee's fixtures of one season, one row a fixture
 */
export const schiedsrichterGetSelfSpiele = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterSpieleResponse> => {
  return adminKeyTransport<FLSchiedsrichterSpieleResponse>(getSchiedsrichterGetSelfSpieleUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSchiedsrichterSweepSchiedsrichterUrl = () => {
  return `/api/v0/schiedsrichter/sweep`;
};

/**
 * Erase every referee entry nobody confirmed, or whose person objected, once the midnight after its link's last day has passed.
 *
 * Erased as an administrator's erasure erases: the entry goes and every fixture naming it names the ghost, as the
 * privacy notice says of an unconfirmed or declined one. A confirmed entry and the ghost hold no deletion date and are
 * never due.
 *
 * A page of entries is erased in one transaction that reads them again, so one confirmed since is left standing; an
 * entry whose erasure fails is logged by its id, passed over and counted in `failed`, and stays due for the next
 * pass. No body: the clock takes no season.
 * @summary Erase the referee entries whose link lapsed unanswered or declined
 */
export const schiedsrichterSweepSchiedsrichter = async (
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSchiedsrichterSweepResponse> => {
  return systemKeyTransport<FLSchiedsrichterSweepResponse>(getSchiedsrichterSweepSchiedsrichterUrl(), {
    ...options,
    method: "POST",
  });
};

export const getSchiedsrichterDeleteSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}`;
};

/**
 * Deactivate a referee. SOFT, for the same reason as venues: a played match names them by id.
 *
 * Refused while an unplayed fixture still books them (`schiedsrichter_still_assigned`), naming the path's id with
 * those fixtures' `spiel_nrs` and their `count` as its bounds.
 * @summary Deactivate a Schiedsrichter (soft delete)
 */
export const schiedsrichterDeleteSchiedsrichter = async (
  schiedsrichterId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSchiedsrichterDeleteSchiedsrichterUrl(schiedsrichterId), {
    ...options,
    method: "DELETE",
  });
};

export const getSchiedsrichterGetSchiedsrichterByIdUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}`;
};

/**
 * Admin-tier as the list is, and for the same two rules (`READ-CONTACT-001`, `READ-MONEY-001`).
 *
 * Deactivated ones included -- a historical match references them by id. The ghost answers 404, as
 * does an id whose referee has been erased: the document is gone
 * (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
 *
 * Answers whether the consent link's deadline has passed today, by the rule its press refuses on, so the editor marks a
 * lapsed link without reading a clock of its own. `delivery` says what became of the last confirmation mail the referee
 * was owed, null where none was.
 * @summary One Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichterById = async (
  schiedsrichterId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterSingleResponse> => {
  return adminKeyTransport<FLSchiedsrichterSingleResponse>(getSchiedsrichterGetSchiedsrichterByIdUrl(schiedsrichterId), {
    ...options,
    method: "GET",
  });
};

export const getSchiedsrichterPatchSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}`;
};

/**
 * Update a referee on the `version` the editor was served, answering the version stored.
 *
 * The editor's next save sends that version. A fixture names the referee by id and reads the name at its own read, so
 * nothing else is written; each fixture keeps the `payment` agreed for it.
 *
 * **A corrected address on an UNCONFIRMED referee retires their link and owes a fresh one** to the
 * new address, named in `confirmation`: the old link was posted to a mailbox nobody reads, and
 * leaving it live is a credential in the wrong inbox.
 *
 * **A CONFIRMED referee's address is refused here** (`schiedsrichter_address_only_per_change`), retired or not: it is who signs in as the
 * person, and moves only through an address change: the address tool, `POST /address_change`, or the person's own account page.
 * A save keeping it lands, a pending change standing.
 *
 * **A RETIRED unconfirmed referee's corrected address is stored and mails nothing**: no consent is
 * collected for a role nobody gives them. Their old link is retired all the same, and the
 * reactivation mints the fresh one.
 *
 * Refused where another referee holds the name (`duplicate_key`, naming `name`), ahead of the address's refusals.
 *
 * The ghost answers 404 here as it does to every read: a name written onto it would appear on the
 * fixtures of every referee already erased.
 * @summary Update a Schiedsrichter
 */
export const schiedsrichterPatchSchiedsrichter = async (
  schiedsrichterId: string,
  fLPatchSchiedsrichterPayload: FLPatchSchiedsrichterPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPatchSchiedsrichterResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPatchSchiedsrichterResponse>(getSchiedsrichterPatchSchiedsrichterUrl(schiedsrichterId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSchiedsrichterPayload),
  });
};

export const getSchiedsrichterInviteSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}/confirmation/invite`;
};

/**
 * Owe this referee a fresh confirmation link, which the Postausgang mints and mails, and answer where it goes.
 *
 * It replaces the whole block, so the previous link stops working at once. The deadline restarts from today.
 *
 * Refused where the referee is retired (`schiedsrichter_retired`), where they have already
 * answered, consenting or objecting (`confirmation_exists`), and where they carry no email address
 * (`schiedsrichter_no_address`). 404 for an id no referee holds, an erased referee's among them, and
 * for the ghost, which every by-id route filters out.
 *
 * **A referee who has already answered is refused rather than sent a second link**: the
 * confirmation refuses every such press, so minting one would replace a live block with a
 * credential that can never be spent.
 * @summary Send a Schiedsrichter a fresh confirmation link
 */
export const schiedsrichterInviteSchiedsrichter = async (
  schiedsrichterId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterMintResponse> => {
  return adminKeyTransport<FLSchiedsrichterMintResponse>(getSchiedsrichterInviteSchiedsrichterUrl(schiedsrichterId), {
    ...options,
    method: "POST",
  });
};

export const getSchiedsrichterReactivateSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}/reactivate`;
};

/**
 * Clear `inactive_since`, putting the referee back into the picker and every default read.
 *
 * **A retired referee who has not answered is owed a fresh link**, named in `confirmation`: a
 * retired referee's save stores a new address and mails nothing, so coming back is what
 * asks them. A row holding no address a link can go to comes back unasked, and so does one whose
 * person has answered.
 *
 * The ghost answers 404 here too: cleared on it, the picker would offer a bookable row with no
 * person behind it.
 * @summary Bring a deactivated Schiedsrichter back
 */
export const schiedsrichterReactivateSchiedsrichter = async (
  schiedsrichterId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterReactivateResponse> => {
  return adminKeyTransport<FLSchiedsrichterReactivateResponse>(getSchiedsrichterReactivateSchiedsrichterUrl(schiedsrichterId), {
    ...options,
    method: "POST",
  });
};

export const getSpielberichteGetSpielberichteUrl = (params?: SpielberichteGetSpielberichteParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spielberichte?${stringifiedParams}` : `/api/v0/spielberichte`;
};

/**
 * Every report of one season holding a block, each with its state against its fixture and what it proposes.
 *
 * What the season editor counts before an undraw or a replace, which a submitted report refuses
 * (`spielplan_berichte_submitted`). Scoped to `saison_id`, the active season when none is named, which answers 404 while no
 * season is active.
 * @summary Every report of a season and the state it reads in
 */
export const spielberichteGetSpielberichte = async (
  params?: SpielberichteGetSpielberichteParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielberichteSaisonResponse> => {
  return adminKeyTransport<FLSpielberichteSaisonResponse>(getSpielberichteGetSpielberichteUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpielberichteGetSpielberichtBerichtUrl = (spielId: string) => {
  return `/api/v0/spielberichte/${encodeURIComponent(String(spielId))}/bericht`;
};

/**
 * What the booked referee's report form reads.
 *
 * The fixture, both clubs' live squads of the season, the pupils the stored report names outside them, and the stored
 * report, its remarks included, or null.
 *
 * `reportable` is whether the referee writes it now: the fixture's kick-off has passed (its day has come, where it
 * holds no time), it is neither called off nor struck out, and its season runs. Served where it is false too, whose
 * page says why it takes no report, with both squads empty: the pupils the stored report names are then all in
 * `named`. Once the fixture's season has ended, `completed` is true and the read is the report alone, both squads
 * empty, which its referee writes no more. Refused `role_not_held` where the address holds no confirmed, live referee
 * record, and `bericht_not_officiated` where the fixture is booked to none of its records; `document_not_found` for a
 * fixture that does not exist.
 * @summary One fixture's report as its referee reads it
 */
export const spielberichteGetSpielberichtBericht = async (
  spielId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielberichtSchiedsrichterResponse> => {
  return adminKeyTransport<FLSpielberichtSchiedsrichterResponse>(getSpielberichteGetSpielberichtBerichtUrl(spielId), {
    ...options,
    method: "GET",
  });
};

export const getSpielberichtePutSpielberichtBerichtUrl = (spielId: string) => {
  return `/api/v0/spielberichte/${encodeURIComponent(String(spielId))}/bericht`;
};

/**
 * Write the whole report of one fixture as its booked referee, replacing what stood.
 *
 * The shoot-out or the event proposed, the scorers, the cards and the remarks; the two goal counts of the proposal are
 * the entries credited to each side, an own goal crediting the other one, and no form sends them. The first write
 * creates it and answers 201; every write changing it clears its adoption in the same update, so a report the
 * administrator adopted reads `differing` again until it is adopted anew, and a write changing nothing writes
 * nothing. Every write stamps the clubs the fixture fields now, so a report a knockout correction re-fielded a side
 * under reads `sides_changed` until it is written again. Writes no fixture: the result is the administrator's to save.
 *
 * `version` is the report document's as the form was served it, null where the form showed no report: a write composed
 * on another state would replace a report its sender never saw. The administrator's adoption raises it too, so a form
 * read before an adoption saves stale once.
 *
 * Refuses, in this order, each writing nothing: an address holding no confirmed, live referee record
 * (`role_not_held`); a fixture that does not exist (`document_not_found`); one booked to none of its records
 * (`bericht_not_officiated`); one whose season has ended, whose report its referee only reads (`saison_past`); a
 * `version` other than the document's now, or than null where none stands (`version_stale`); one undated, or whose
 * kick-off is still to come, its day where it holds no time (`bericht_not_played`); one called off or struck out
 * (`bericht_cancelled`); a shoot-out proposed on a group-phase fixture (`bericht_elfmeter_in_the_gruppe`); and a pupil
 * the write newly names on a side outside that side's live squad of the season, a pupil the report already named on
 * that side staying while the side fields the club it did (`spieler_not_in_kader`). Every refusal but `version_stale`
 * is asked again outside the transaction just before answering, the referee's records included, so a write landing on
 * what was judged before that second asking refuses the report rather than letting it stand, and one landing after it
 * stands beside the report; a write of the report itself landing mid-press conflicts with this one, whose retry meets
 * `version_stale`. Two first writes at once are two forms opened on no report: the later is refused.
 * @summary Write one fixture's report as its referee
 */
export const spielberichtePutSpielberichtBericht = async (
  spielId: string,
  fLSpielberichtPayload: FLSpielberichtPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielberichtSchiedsrichterResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLSpielberichtSchiedsrichterResponse>(getSpielberichtePutSpielberichtBerichtUrl(spielId), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielberichtPayload),
  });
};

export const getSpielbestaetigungenGetSpielbestaetigungenUrl = (params: SpielbestaetigungenGetSpielbestaetigungenParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spielbestaetigungen?${stringifiedParams}` : `/api/v0/spielbestaetigungen`;
};

/**
 * Every confirmation row of the season, or of its one fixture.
 *
 * Newest first, closed rows included. No seat's address is served. Every row still holding its party's question is
 * served; `limit` cuts the others, and `complete` is false where it left the oldest of them out. A season no
 * document has answers no rows rather than 404.
 * @summary A season's fixture confirmations, or one fixture's
 */
export const spielbestaetigungenGetSpielbestaetigungen = async (
  params: SpielbestaetigungenGetSpielbestaetigungenParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielbestaetigungenListResponse> => {
  return adminKeyTransport<FLSpielbestaetigungenListResponse>(getSpielbestaetigungenGetSpielbestaetigungenUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpielbestaetigungenGetSweepSaisonsUrl = () => {
  return `/api/v0/spielbestaetigungen/sweep`;
};

/**
 * Answer every `active` season's id, oldest first.
 *
 * `active` alone: a confirmation serves no purpose once its season is over, and a season that ended with a fixture nobody
 * entered a result for would otherwise be asked about a day long gone. System tier because this is the timer's own
 * bookkeeping, asked by the process running the pass and by no page. Reading it writes nothing.
 * @summary Every season the confirmation pass visits
 */
export const spielbestaetigungenGetSweepSaisons = async (
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSweepSaisonsResponse> => {
  return systemKeyTransport<FLSweepSaisonsResponse>(getSpielbestaetigungenGetSweepSaisonsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielbestaetigungenSweepSpielbestaetigungenUrl = (saisonId: string) => {
  return `/api/v0/spielbestaetigungen/sweep/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Close, mint and remind one season's fixture confirmations, as of today in Europe/Berlin, and answer what it did, counted.
 *
 * Each mail is owed through the Postausgang in the transaction that writes its row.
 *
 * The close shuts every row not yet closed, answered or not, whose fixture moved, was decided, was called off, lost a club
 * to an `austritt` dated on or before its day, or -- a referee's row -- names another referee or none; failing all of
 * those, a row whose fixture has kicked off, or reached its day where it holds no time, closes `spiel_past`, so
 * nobody answers about a match already started. A club's decline closed `discarded` is closed again for each of
 * those but a move and a referee change, in the pass that closes an agreement beside it, and once the slot it was
 * about has kicked off: the public fixture then stops counting it as that club's agreement.
 *
 * A closing owes its party a notice in its own transaction where the party's first request or Einteilung was owed,
 * about a slot not yet kicked off: for a move, „Spiel verlegt“, naming the slot it left and the one the fixture holds now
 * where the party is still one of its sides or its referee and that slot has a day, an hour and both sides; for a
 * referee taken off the fixture -- ahead of a move it shares a close with, and never for the referee's own decline, which closed its row
 * as it was given -- and for a call-off, the slot the row was about; for an `austritt`, the slot too, to a referee alone,
 * each opponent having been told at the exit's own write (`app/api/spielbestaetigungen/crud.py ::
 * owe_the_austritt_notices_in_session`). A club is told at every address of its confirmed seats as they stand now, a
 * referee at the address their record holds; a party nobody is left to tell is told nothing.
 *
 * The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
 * ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
 * its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `discarded`: a
 * decline the administrator discarded is the party's one answer to that Ansetzung. A fixture booked onto the erased
 * referee's ghost gets no referee row, the ghost holding no address. The deadline falls the notice period
 * (`app/shared/schemas/bounds.py :: SPIEL_CONFIRMATION_DEADLINE_DAYS`) before the fixture, or today where that has passed.
 * A club's row is owed its request at every address of the club's confirmed seats, one mail per mailbox carrying no
 * link, since the club answers on its own pages signed in, and the row is stamped as asked; a club holding no confirmed
 * seat is asked once it holds one, while its row is open and in time. A referee row is owed its Einteilung. A
 * party still asked by a fixture that moved to a slot the mint asks today is the mint's, never the close's: in the
 * transaction asking about the new slot, the mint closes the party's row about the slot left `ansetzung_changed`, and
 * the request or Einteilung it owes names the slot left, the one mail telling of the move; a party it owes no request,
 * its answer about the new slot standing or no confirmed seat of its reachable, is owed the move's notice instead. A fixture
 * holding any other unclosed row about an Ansetzung it has left is asked once the close has shut it, the close owing
 * its notice first.
 *
 * The one reminder goes to every address of the club's confirmed seats as they stand now, on each open team row never
 * reminded whose deadline lies the reminder's days away (`app/shared/schemas/bounds.py :: SPIEL_REMINDER_DAYS`) and
 * whose request was owed on an earlier day, and stamps the day; a row whose club holds no confirmed seat that day is
 * reminded of nothing.
 *
 * The line-up reminder goes to every address of a club's confirmed seats as they stand now, for each fixture whose
 * kick-off lies between `app/shared/schemas/bounds.py :: AUFSTELLUNG_REMINDER_DAYS` and `:: AUFSTELLUNG_DUE_DAYS`
 * ahead, each counted back at the kick-off's clock time, and for which the club stores no line-up, neither the
 * fixture decided or called off nor the club out by its
 * day; once per club and fixture, the mail's own keys being its one record (`app/api/spielbestaetigungen/services.py
 * :: aufstellung_reminder_key`), so a fixture first read past the window's start, or moved, is reminded only if no
 * reminder of it went. Each states the moment the line-up is due and is given up at it.
 *
 * Each step takes a bounded share and leaves the rest due. A row whose write fails is passed over alone, logged by id
 * and counted in `failed`; any other failure is raised, every step committed before it standing with its mails.
 *
 * A season that is not `active` is passed by whole -- nothing closed, minted or reminded -- so a mistyped call, or one for
 * a season ended since the listing, mails nobody. 404 where no season has the id.
 * @summary Run one season's fixture confirmation pass
 */
export const spielbestaetigungenSweepSpielbestaetigungen = async (
  saisonId: string,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSpielbestaetigungSweepResponse> => {
  return systemKeyTransport<FLSpielbestaetigungSweepResponse>(getSpielbestaetigungenSweepSpielbestaetigungenUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSpielbestaetigungenAdoptSpielbestaetigungUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/adopt`;
};

/**
 * Move a fixture to the date and hour a club's open decline proposes, through the fixture's own save.
 *
 * Refused for any row but an open club decline proposing a date about the fixture's current Ansetzung, the row a
 * discard closes (`ansetzung_not_adoptable`), and for a proposed day gone by (`ansetzung_vorschlag_past_as_stored`, the
 * stored proposal's 409). The fixture is saved as the administrator's save would carry it on the proposed day and
 * hour, everything else kept, so it meets every rule that save meets and is refused as that save is, by its code and
 * status alone, as the draw answers the season write's refusals: no refusal names a field, the request carrying no
 * body. A code the save names a field by is answered under its twin for that field instead, a 409: the ground or the
 * referee booked beside the proposed slot (`spiel_double_booked_spielort_as_stored`,
 * `spiel_double_booked_schiedsrichter_as_stored`), a side out of the season by then
 * (`eligibility_disqualified_team1_as_stored`, `eligibility_disqualified_team2_as_stored`). The bracket is resolved
 * as that save resolves it. The
 * row is not closed here: the fixture has left the Ansetzung it answers, so its parties' pages read it `invalid` at once and the
 * next confirmation pass closes every party's row `ansetzung_changed`, owing each party „Spiel verlegt“ and asking it
 * about the new slot. IRREVERSIBLE as a save is: moving the fixture back is another save.
 * @summary Adopt a club's proposed date
 */
export const spielbestaetigungenAdoptSpielbestaetigung = async (
  spielbestaetigungId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSpielbestaetigungenAdoptSpielbestaetigungUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
  });
};

export const getSpielbestaetigungenPostSchiedsrichterAnswerUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/answer`;
};

/**
 * Record the signed-in referee's answer about one fixture they are booked on: they accept it, or decline it giving a reason.
 *
 * The first answer binds, as a club's does. A decline also takes the referee off the fixture, writing its referee
 * null and nothing else of it -- no other fixture is resolved again and no club is told -- and closes the row, so
 * booking the same referee again asks them afresh. The reason is stored as typed, for the administrator, and goes at
 * the season's end. Answering is open until the fixture's kick-off, or its day where it holds no time, whatever
 * deadline a club's row of the same fixture carries.
 *
 * Refuses, in this order: an address holding no live, confirmed referee record (`role_not_held`); an id naming no
 * row of an `active` season, or a row naming none of those records (`ansetzung_foreign_row`, one answer for both); a row
 * already answered, by them or by the league for them (`ansetzung_answered`); one closed unanswered
 * (`ansetzung_closed`); a fixture decided, called off or left by a club (`ansetzung_decided`), then one whose date,
 * time, ground or sides moved since the row, or which books another referee or none (`ansetzung_changed`); and a
 * fixture whose kick-off has come (`ansetzung_deadline_past`). An acceptance is judged again outside the transaction just
 * before answering, so a move or a reassignment landing mid-answer refuses it rather than letting it stand.
 *
 * **The caller drops the cached fixture list after a successful answer**: an acceptance can put the referee's name
 * on the public fixture, and a decline takes it off.
 * @summary Accept or decline one of the signed-in referee's own fixture assignments
 */
export const spielbestaetigungenPostSchiedsrichterAnswer = async (
  spielbestaetigungId: string,
  fLSpielbestaetigungSchiedsrichterAnswerPayload: FLSpielbestaetigungSchiedsrichterAnswerPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielbestaetigungSchiedsrichterAnswerResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLSpielbestaetigungSchiedsrichterAnswerResponse>(
    getSpielbestaetigungenPostSchiedsrichterAnswerUrl(spielbestaetigungId),
    {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
      body: JSON.stringify(fLSpielbestaetigungSchiedsrichterAnswerPayload),
    },
  );
};

export const getSpielbestaetigungenPostTeamAnswerUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/answer/team`;
};

/**
 * Record one club's answer about one Ansetzung, from whichever of its confirmed seats presses first, and the seat it came from.
 *
 * The first press binds: a second seat pressing at once conflicts with it, and its retry finds the row answered
 * (`ansetzung_answered`). Writes no fixture: a proposal is the administrator's to act on. The seat recorded is the
 * signed-in person's own on the row's team, the first in order where they hold two.
 *
 * Refuses, in this order: an id naming no team's row, or the row of a team the signed-in person holds no seat on in
 * its season (`ansetzung_foreign_row`, one answer for both); a row already answered, closed since or not (`ansetzung_answered`); one closed
 * unanswered (`ansetzung_closed`); a fixture decided, called off or left by a club (`ansetzung_decided`), then one
 * whose date, time, ground or sides moved since the row was asked (`ansetzung_changed`); an answer after the
 * deadline's day (`ansetzung_deadline_past`); a proposal dated before today (`ansetzung_vorschlag_past`); one naming
 * the day and hour the fixture already holds (`ansetzung_vorschlag_unchanged`, on both boxes); and a proposal the
 * administrator's own save of that date would be refused: on or after a club's exit (`eligibility_disqualified`),
 * outside the matchday (`spiel_outside_spieltag`), or within four hours of the ground's or the referee's other
 * fixture (`spiel_double_booked`). The reason is stored as typed. Every refusal after the seat's is asked again outside
 * the transaction just before answering, so a write landing mid-answer on what was judged refuses the answer rather
 * than letting it stand.
 * @summary Confirm a fixture's Ansetzung as the team's seat holder, or decline it proposing another date
 */
export const spielbestaetigungenPostTeamAnswer = async (
  spielbestaetigungId: string,
  fLSpielbestaetigungTeamAnswerPayload: FLSpielbestaetigungTeamAnswerPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielbestaetigungAnswerResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLSpielbestaetigungAnswerResponse>(getSpielbestaetigungenPostTeamAnswerUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielbestaetigungTeamAnswerPayload),
  });
};

export const getSpielbestaetigungenDiscardSpielbestaetigungUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/discard`;
};

/**
 * Close a club's open decline that proposes another date, so the proposal stops asking the administrator to act.
 *
 * IRREVERSIBLE: the decline stays as the club gave it, and the row is closed `discarded`, which is that club's one
 * answer to this Ansetzung: the confirmation pass never asks it about this Ansetzung again, and the public fixture
 * counts it as the club's agreement, the league having kept the date, until a pass closes it again as it closes an
 * agreement beside it. Where its kick-off is still to come, the club is owed a notice that the date stands, at every
 * address its season row's seats hold now, in the same transaction. Refused for any other row -- open, agreed,
 * declined without a proposal, a referee's, closed, or about an Ansetzung the fixture has left, the fixture moving
 * while this request runs included (`ansetzung_not_discardable`): the confirmation pass closes that row and tells its club of
 * the move.
 * @summary Discard a club's proposed date
 */
export const spielbestaetigungenDiscardSpielbestaetigung = async (
  spielbestaetigungId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSpielbestaetigungenDiscardSpielbestaetigungUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
  });
};

export const getSpielbestaetigungenEnterSpielbestaetigungUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/enter`;
};

/**
 * Record that the party of an open confirmation agreed to its Ansetzung elsewhere than by its own answer, signed in.
 *
 * The administrator's reason says how. IRREVERSIBLE: the answer is the league's record of how a date was agreed, and
 * nothing rewrites it. It names nobody: no seat and no person is recorded, and the reason takes any text and goes at
 * the season's end. Refused for a row
 * already answered, by a seat or by an administrator, or closed (`ansetzung_not_enterable`), including one a seat answers
 * while this request runs: of the two answers exactly one is stored. A row about an Ansetzung the fixture has since
 * left is settled as asked, and the next confirmation pass closes it.
 * @summary Record a party's Zusage on its behalf
 */
export const spielbestaetigungenEnterSpielbestaetigung = async (
  spielbestaetigungId: string,
  fLSpielbestaetigungEnterPayload: FLSpielbestaetigungEnterPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<void>(getSpielbestaetigungenEnterSpielbestaetigungUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielbestaetigungEnterPayload),
  });
};

export const getSpieleGetSpieleSpielplanUrl = (params: SpieleGetSpieleSpielplanParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spiele/spielplan?${stringifiedParams}` : `/api/v0/spiele/spielplan`;
};

/**
 * Every matchday and knockout round of one season, a planned one included, its matches in the admin shape, in order.
 *
 * Each round holds its matches by number, and the rounds come in the order they are played. The matchday to open on
 * is the Spielplan's own: the first holding a match still to be played, else the last; a finished season opens on its
 * last. `document_not_found` for a season id naming no season. Writes nothing.
 * @summary One Saison's Spiele by matchday, for the admin Spiele list
 */
export const spieleGetSpieleSpielplan = async (
  params: SpieleGetSpieleSpielplanParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieleSpielplanAdminResponse> => {
  return adminKeyTransport<FLSpieleSpielplanAdminResponse>(getSpieleGetSpieleSpielplanUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpieleGetSpielUrl = (spielId: string) => {
  return `/api/v0/spiele/${encodeURIComponent(String(spielId))}`;
};

/**
 * Return one match by its id, answering 404 for a match of a season this tier may not read.
 * @summary One Spiel
 */
export const spieleGetSpiel = async (spielId: string, options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLSpieleSingleResponse> => {
  return baseKeyTransport<FLSpieleSingleResponse>(getSpieleGetSpielUrl(spielId), {
    ...options,
    method: "GET",
  });
};

export const getSpielePatchSpielUrl = (spielId: string, params?: SpielePatchSpielParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/v0/spiele/${encodeURIComponent(String(spielId))}?${stringifiedParams}`
    : `/api/v0/spiele/${encodeURIComponent(String(spielId))}`;
};

/**
 * Save one Spiel wholesale and resolve the season's bracket, answering every fixture the save moved beyond it.
 *
 * The fixture stores no name: every read joins it. With `adopts_bericht` the save also stamps the fixture's Spielbericht
 * adopted, where it still stands at that version about the clubs the save leaves; a miss refuses nothing. A
 * `dry_run` answers the same report and writes nothing, and names in `recipients` every party the confirmation pass
 * would mail about the fixture once it is saved so: told of its move, of the referee taken off it, or of its call-off,
 * by the pass's own rules. A `past` season's fixture is refused (`saison_past`), the `dry_run` included. The save
 * deletes only the later results its body's `voided_results` names, each by its value as its `dry_run` answered it,
 * and is refused whole where it would delete any other set (`voided_results_stale`), judged in its own transaction:
 * a result entered or changed after the question was asked is never deleted unasked.
 * @summary Update a Spiel
 */
export const spielePatchSpiel = async (
  spielId: string,
  fLPatchSpielDataPayload: FLPatchSpielDataPayload,
  params?: SpielePatchSpielParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLPatchSpielDataResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyDryRunTransport<FLPatchSpielDataResponse>(getSpielePatchSpielUrl(spielId, params), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSpielDataPayload),
  });
};

export const getSpieleGetSpielAdminUrl = (spielId: string) => {
  return `/api/v0/spiele/${encodeURIComponent(String(spielId))}/admin`;
};

/**
 * The match editor's one read: the fixture in the admin shape, money and `version` included, and its season's status.
 *
 * Beside it every live venue and referee to book, the fixture's own where it has retired, each referee saying whether
 * they confirmed their entry; on a knockout fixture every club of its season, each saying whether it stands on
 * another fixture of the matchday and whether a save fielding it here by hand would pass the write's rules, null on a
 * group fixture; the fixture's report as its Spielbericht section shows it, its goals, its proposal and the state it
 * reads in, null where none stands; the fixture's confirmation rows as the confirmations' read serves them; and per
 * side how many pupils the stored line-up of the club fielded there names and how many of them start, null where that
 * club has stored none. `document_not_found` for an id no fixture holds.
 * @summary One Spiel and all the match editor offers and shows beside it
 */
export const spieleGetSpielAdmin = async (
  spielId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieleAdminSingleResponse> => {
  return adminKeyTransport<FLSpieleAdminSingleResponse>(getSpieleGetSpielAdminUrl(spielId), {
    ...options,
    method: "GET",
  });
};

export const getSpielerPatchEinwilligungUrl = () => {
  return `/api/v0/spieler/account/einwilligung`;
};

/**
 * Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.
 *
 * Writes those two on this one record, each moved choice with its evidence (`evidence.<choice>`), and nothing else:
 * the confirmation day, the day given and the wording they confirmed stand, and no other document is written. A
 * PATCH moving neither choice writes nothing.
 *
 * Refuses, in this order: an address holding no confirmed pupil record (`role_not_held`); a `evidence_state`
 * other than the record's own, either choice having moved since the page was served (`choices_stale`); a choice
 * moving onto a grant under a label other than its
 * current wording's, the page loaded before a rewording (`grant_wording_stale`); `media` moving to `true` where
 * the stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is missing (`media_age`). Each
 * refusal writes nothing.
 *
 * **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
 * name is served, and nothing here can.
 * @summary Change a signed-in pupil's own publication and media consent
 */
export const spielerPatchEinwilligung = async (
  fLAccountEinwilligungPayload: FLAccountEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<void>(getSpielerPatchEinwilligungUrl(), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAccountEinwilligungPayload),
  });
};

export const getSpielerGetKaderUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/spieler/kader/${encodeURIComponent(String(teamId))}/${encodeURIComponent(String(saisonId))}`;
};

/**
 * The squad of one team in one season, for a person holding any contact seat on it.
 *
 * Every row, ausgetragen ones included and marked by `inactive_since`; each surname whole, and no
 * e-mail address or telephone number of anybody. `nummer_double` marks a live row whose number
 * another live row of the squad wears, compared as stored. `allowed_stufen` is what the season's
 * rules offer an edit. Refused `role_not_held` where the signed-in person holds no seat on this
 * team in this season, a seat on a `past` season holding none.
 * @summary Read a team's squad as its seat holder
 */
export const spielerGetKader = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKaderResponse> => {
  return adminKeyTransport<FLKaderResponse>(getSpielerGetKaderUrl(teamId, saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSpielerDeleteKaderRowUrl = (teamId: string, saisonId: string, spielerId: string) => {
  return `/api/v0/spieler/kader/${encodeURIComponent(String(teamId))}/${encodeURIComponent(String(saisonId))}/${encodeURIComponent(String(spielerId))}`;
};

/**
 * Take a player out of this team's squad for the season, as any contact seat of the team may. SOFT: the row stays.
 *
 * Stamps the row's `inactive_since`; the person stays in the league, and only an administrator
 * brings the row back. 404 where this team holds no live row for the player in this season,
 * another team's pupil and an ausgetragen row alike. Refused `role_not_held` without a seat.
 * @summary Take a Spieler out of the squad as its team's seat holder (retire)
 */
export const spielerDeleteKaderRow = async (
  teamId: string,
  saisonId: string,
  spielerId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKaderRow> => {
  return adminKeyTransport<FLKaderRow>(getSpielerDeleteKaderRowUrl(teamId, saisonId, spielerId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielerPatchKaderRowUrl = (teamId: string, saisonId: string, spielerId: string) => {
  return `/api/v0/spieler/kader/${encodeURIComponent(String(teamId))}/${encodeURIComponent(String(saisonId))}/${encodeURIComponent(String(spielerId))}`;
};

/**
 * Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.
 *
 * The team and the Nachnominierung flag stay the stored row's. 404 where this team holds no live
 * row for the player in this season: another team's pupil and an ausgetragen row answer alike, and
 * nothing is written. Refused `role_not_held` without a seat, `kader_stufe_not_allowed` for a `stufe` the
 * season's `allowed_stufen` does not offer unless the row already holds it, and `kader_rolle_taken`
 * for a `rolle` another live row of the squad holds. A shared `nummer` is permitted.
 * @summary Update a squad entry as its team's seat holder
 */
export const spielerPatchKaderRow = async (
  teamId: string,
  saisonId: string,
  spielerId: string,
  fLPatchKaderRowPayload: FLPatchKaderRowPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKaderRow> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLKaderRow>(getSpielerPatchKaderRowUrl(teamId, saisonId, spielerId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchKaderRowPayload),
  });
};

export const getSpielerGetSpielerAdminUrl = (params: SpielerGetSpielerAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spieler/list/admin?${stringifiedParams}` : `/api/v0/spieler/list/admin`;
};

/**
 * The Spieler page in one read: every squad row of the season, live and ausgetragen alike, each named and with its club.
 *
 * Read whole, as every list but the Protokoll is, the page narrowing what it holds. `nummer_double` marks a live row
 * whose number another live row of its own squad wears, compared as stored. 404 where no season holds that id.
 * @summary One Saison's squad rows for its list
 */
export const spielerGetSpielerAdmin = async (
  params: SpielerGetSpielerAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerAdminListResponse> => {
  return adminKeyTransport<FLSpielerAdminListResponse>(getSpielerGetSpielerAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpielerGetSelfSaisonsUrl = () => {
  return `/api/v0/spieler/self/saisons`;
};

/**
 * Every season the signed-in pupil holds a squad row in, a deregistered one included, the newest first, each with its span.
 *
 * A planned season is served as any other. Refuses an address holding no confirmed pupil record (`role_not_held`).
 * @summary The seasons a signed-in pupil holds a squad row in
 */
export const spielerGetSelfSaisons = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLOwnSaisonsResponse> => {
  return adminKeyTransport<FLOwnSaisonsResponse>(getSpielerGetSelfSaisonsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielerGetSelfSaisonUrl = (saisonId: string) => {
  return `/api/v0/spieler/self/${encodeURIComponent(String(saisonId))}`;
};

/**
 * What the signed-in pupil's own page shows of one season, in one read.
 *
 * Their squad row of this season with the name its club plays the season under, null where they hold none; and
 * that club's fixtures in the order the draw numbered them, each with
 * whether the club's stored line-up starts them (`starts` true), benches them (false) or does not name them, or
 * none is stored (null).
 *
 * Refuses an address holding no confirmed pupil record (`role_not_held`).
 * @summary A signed-in pupil's own season: their squad row and their team's fixtures
 */
export const spielerGetSelfSaison = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerSaisonSelfResponse> => {
  return adminKeyTransport<FLSpielerSaisonSelfResponse>(getSpielerGetSelfSaisonUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSpielerGetSpielerByIdUrl = (spielerId: string) => {
  return `/api/v0/spieler/${encodeURIComponent(String(spielerId))}`;
};

/**
 * One player's id, forename and surname initial, both names `null` where the pupil's consent does not publish them.
 * @summary One Spieler
 */
export const spielerGetSpielerById = async (
  spielerId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpielerSingleResponse> => {
  return baseKeyTransport<FLSpielerSingleResponse>(getSpielerGetSpielerByIdUrl(spielerId), {
    ...options,
    method: "GET",
  });
};

export const getSpielerDeleteSaisonSpielerUrl = (spielerId: string, saisonId: string) => {
  return `/api/v0/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Take a player out of a season's squad. SOFT: the row stays.
 *
 * The row records that this player wore this number in this squad, which stays true after they
 * leave. `GET /spieler/list/admin` is where an admin reads it back, marked by `inactive_since`.
 * @summary Remove a Spieler from a squad
 */
export const spielerDeleteSaisonSpieler = async (
  spielerId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSpielerDeleteSaisonSpielerUrl(spielerId, saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielerGetSpielerSaisonUrl = (spielerId: string, saisonId: string) => {
  return `/api/v0/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}/admin`;
};

/**
 * Return what the Spieler editor shows in one read: the person, their squad row of the season, and what its boxes offer.
 *
 * `version` is what the one save sends. `allowed_stufen` is what the season's rules offer, `taken_rollen` each role
 * another live row of the squad holds. Read outside a transaction: a write landing under this read is judged by its own
 * write. 404 where no person, no season or no squad row of the person in that season holds those ids: the page stands
 * under a season, and a person out of its squad is no row of that season's list.
 * @summary What the Spieler editor shows, in one read
 */
export const spielerGetSpielerSaison = async (
  spielerId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerSaisonAdminResponse> => {
  return adminKeyTransport<FLSpielerSaisonAdminResponse>(getSpielerGetSpielerSaisonUrl(spielerId, saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSpielerPatchSpielerSaisonUrl = (spielerId: string, saisonId: string) => {
  return `/api/v0/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}/admin`;
};

/**
 * Save the Spieler editor's one version: the person's own facts and their squad row of the season.
 *
 * The team stays the stored row's: no player moves between teams. Refused `version_stale` once the person or the row has
 * moved since the editor read them, whichever it was; `kader_stufe_not_allowed` for a `stufe` the season's rules do not
 * offer unless the row already holds it; `kader_rolle_taken` for a `rolle` another live row of the squad holds. A shared
 * `nummer` is permitted (`docs/domain.md`'s what the model permits on purpose). 404 where the person holds no row of the
 * season. No fan-out: unlike a team or a venue, a person is embedded in no other document.
 * @summary Save the Spieler editor: the person and their squad row of the season, in one transaction
 */
export const spielerPatchSpielerSaison = async (
  spielerId: string,
  saisonId: string,
  fLPatchSpielerSaisonPayload: FLPatchSpielerSaisonPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPatchSpielerSaisonResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPatchSpielerSaisonResponse>(getSpielerPatchSpielerSaisonUrl(spielerId, saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSpielerSaisonPayload),
  });
};

export const getSpielerReactivateSaisonSpielerUrl = (spielerId: string, saisonId: string) => {
  return `/api/v0/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}/reactivate`;
};

/**
 * Clear a squad row's `inactive_since`, with the number and position it had.
 *
 * Refused where the squad has filled up, a nominee's row standing outside that cap, where its club
 * left, or where the `rolle` the row carries has been given to somebody else since (`kader_rolle_taken`).
 * @summary Put a Spieler back in a squad they left
 */
export const spielerReactivateSaisonSpieler = async (
  spielerId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSpielerReactivateSaisonSpielerUrl(spielerId, saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSpielorteGetSpielorteUrl = (params?: SpielorteGetSpielorteParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spielorte?${stringifiedParams}` : `/api/v0/spielorte`;
};

/**
 * An admin-tier read: the rent is money (`READ-MONEY-001`) and the address parts serve no public page (`READ-ADDRESS-001`).
 *
 * Deactivated venues stay retrievable for a historical match. `maps_link` is a Maps search string, not a URL.
 * @summary List Spielorte
 */
export const spielorteGetSpielorte = async (
  params?: SpielorteGetSpielorteParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielorteListResponse> => {
  return adminKeyTransport<FLSpielorteListResponse>(getSpielorteGetSpielorteUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpielortePostSpielortUrl = () => {
  return `/api/v0/spielorte`;
};

/**
 * Create a venue. `maps_link` is built server-side from the name and address and must not be submitted.
 *
 * Refused where another venue holds the name (`duplicate_key`, naming `name`).
 * @summary Create a Spielort
 */
export const spielortePostSpielort = async (
  fLPostSpielortPayload: FLPostSpielortPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLCreatedResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLCreatedResponse>(getSpielortePostSpielortUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostSpielortPayload),
  });
};

export const getSpielorteDeleteSpielortUrl = (spielortId: string) => {
  return `/api/v0/spielorte/${encodeURIComponent(String(spielortId))}`;
};

/**
 * Deactivate a venue. SOFT: it stamps `inactive_since`, and the document stays.
 *
 * A played match names the venue by id, so a hard delete would orphan every historical match that used it. Refused
 * while an unplayed fixture is still booked here (`spielort_still_booked`).
 * @summary Deactivate a Spielort (soft delete)
 */
export const spielorteDeleteSpielort = async (spielortId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getSpielorteDeleteSpielortUrl(spielortId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielorteGetSpielortUrl = (spielortId: string) => {
  return `/api/v0/spielorte/${encodeURIComponent(String(spielortId))}`;
};

/**
 * The venue editor's one read: the record, its `version` with it, which the editor's save sends back.
 *
 * Admin-tier as the list is, and for the same two rules (`READ-MONEY-001`, `READ-ADDRESS-001`). Retired venues included:
 * the editor reactivates one, and a historical match's venue is the case worth answering.
 * @summary One Spielort
 */
export const spielorteGetSpielort = async (
  spielortId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielorteSingleResponse> => {
  return adminKeyTransport<FLSpielorteSingleResponse>(getSpielorteGetSpielortUrl(spielortId), {
    ...options,
    method: "GET",
  });
};

export const getSpielortePatchSpielortUrl = (spielortId: string) => {
  return `/api/v0/spielorte/${encodeURIComponent(String(spielortId))}`;
};

/**
 * Update a venue on the `version` the editor was served, answering the version stored, which its next save sends.
 *
 * A fixture names the venue by id and reads its name and `maps_link` at its own read, so nothing else is written; each
 * fixture keeps the `mietpreis` agreed for it. Refused where another venue holds the name (`duplicate_key`, naming
 * `name`).
 * @summary Update a Spielort
 */
export const spielortePatchSpielort = async (
  spielortId: string,
  fLPatchSpielortPayload: FLPatchSpielortPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPatchSpielortResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPatchSpielortResponse>(getSpielortePatchSpielortUrl(spielortId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSpielortPayload),
  });
};

export const getSpielorteReactivateSpielortUrl = (spielortId: string) => {
  return `/api/v0/spielorte/${encodeURIComponent(String(spielortId))}/reactivate`;
};

/**
 * Clear `inactive_since`, putting the venue back into the picker and every default read.
 * @summary Bring a deactivated Spielort back
 */
export const spielorteReactivateSpielort = async (spielortId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getSpielorteReactivateSpielortUrl(spielortId), {
    ...options,
    method: "POST",
  });
};

export const getSpieltageGetSpieltageAdminUrl = (params?: SpieltageGetSpieltageAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spieltage/list/admin?${stringifiedParams}` : `/api/v0/spieltage/list/admin`;
};

/**
 * List a season's matchdays for the admin surfaces, a `future` season's included.
 *
 * No season gate: a season's matchdays are drawn while it is planned, and dating them is what this
 * list is for.
 * @summary Spieltage for the admin surfaces
 */
export const spieltageGetSpieltageAdmin = async (
  params?: SpieltageGetSpieltageAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieltageListResponse> => {
  return adminKeyTransport<FLSpieltageListResponse>(getSpieltageGetSpieltageAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpieltageGetSpieltagUrl = (spieltagId: string) => {
  return `/api/v0/spieltage/${encodeURIComponent(String(spieltagId))}`;
};

/**
 * One matchday by its id, its match count derived from its own season's rules.
 *
 * 404 for a matchday of a season this tier may not read.
 * @summary One Spieltag
 */
export const spieltageGetSpieltag = async (
  spieltagId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpieltageSingleResponse> => {
  return baseKeyTransport<FLSpieltageSingleResponse>(getSpieltageGetSpieltagUrl(spieltagId), {
    ...options,
    method: "GET",
  });
};

export const getSpieltagePatchSpieltagUrl = (spieltagId: string) => {
  return `/api/v0/spieltage/${encodeURIComponent(String(spieltagId))}`;
};

/**
 * Move a matchday's span, answering the matchday's `version` after the save.
 *
 * No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. The span is held
 * to its season's, to the days its own fixtures stand on, and its `start` to the order its phase is dated in. A
 * `past` season's matchday is refused (`saison_past`), as its fixtures' saves are: a finished season's record is
 * closed.
 * @summary Re-date a Spieltag
 */
export const spieltagePatchSpieltag = async (
  spieltagId: string,
  fLPatchSpieltagPayload: FLPatchSpieltagPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieltagWriteResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLSpieltagWriteResponse>(getSpieltagePatchSpieltagUrl(spieltagId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSpieltagPayload),
  });
};

export const getSpieltageGetSpieltagAdminUrl = (spieltagId: string) => {
  return `/api/v0/spieltage/${encodeURIComponent(String(spieltagId))}/admin`;
};

/**
 * Return one matchday by its id for the admin editor, a `future` season's included.
 *
 * The shape of `GET /spieltage/{spieltag_id}`, without its season gate, plus `count_spieltage_in_phase`, how many
 * matchdays its phase holds: the editor opens a matchday to date it, and that happens before its season is ever
 * activated. Beside it its season's `status`, read as the re-dating judges it, so the editor opens read-only on
 * exactly the season the write refuses (`saison_past`).
 * @summary One Spieltag for the admin editor
 */
export const spieltageGetSpieltagAdmin = async (
  spieltagId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieltagAdminResponse> => {
  return adminKeyTransport<FLSpieltagAdminResponse>(getSpieltageGetSpieltagAdminUrl(spieltagId), {
    ...options,
    method: "GET",
  });
};

export const getSystemCheckIsLiveUrl = () => {
  return `/api/v0/system/is_live`;
};

/**
 * Liveness: is this process serving requests?
 *
 * Unauthenticated, and it does not touch the database: it must not fail for reasons a restart
 * cannot fix.
 * @summary Liveness probe
 */
export const systemCheckIsLive = async (options?: Parameters<typeof unkeyedTransport>[1]): Promise<CheckIsLiveResponse> => {
  return unkeyedTransport<CheckIsLiveResponse>(getSystemCheckIsLiveUrl(), {
    ...options,
    method: "GET",
  });
};

export const getTeamsGetTeamsAdminUrl = (params: TeamsGetTeamsAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/teams/list/admin?${stringifiedParams}` : `/api/v0/teams/list/admin`;
};

/**
 * The Teams page in one read: the season's clubs, a `future` season's included, and what entering another offers.
 *
 * No base-tier season gate: a club is entered while its season is still planned. Each row counts its seats, its state
 * the type of an exit and the day its club left the league. `state=retired` reads past the season's rows to every
 * retired club, which is the way back to one. `entry` is every club still in the league holding no row of the season,
 * each group with whether it is full, `closed` where the season is not `future`, which the entry refuses, and `taken`
 * the colours the season's rows hold. 404 where no season holds that id.
 * @summary One season's Teams list and what its create dialog offers
 */
export const teamsGetTeamsAdmin = async (
  params: TeamsGetTeamsAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLTeamsAdminListResponse> => {
  return adminKeyTransport<FLTeamsAdminListResponse>(getTeamsGetTeamsAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getTeamsPostTeamEntryUrl = (saisonId: string) => {
  return `/api/v0/teams/saisons/${encodeURIComponent(String(saisonId))}/entry`;
};

/**
 * Enter a club into a `future` season in a group and a colour, founding it first where it is new.
 *
 * A new club's `shorthand` is unique across every club, retired ones included: a taken one is refused `duplicate_key`,
 * naming `shorthand`. A retired club is refused `team_retired`, a club the season already holds
 * `bewerbung_picked_team_already_entered`, a colour another row holds `trikot_farbe_taken`, naming `trikot_farbe`, and the
 * season and the group as an entry is.
 * @summary Enter a club into a season, one the league holds or a new one
 */
export const teamsPostTeamEntry = async (
  saisonId: string,
  fLPostTeamEntryPayload: FLPostTeamEntryPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostTeamEntryResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPostTeamEntryResponse>(getTeamsPostTeamEntryUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostTeamEntryPayload),
  });
};

export const getTeamsDeleteTeamUrl = (teamId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}`;
};

/**
 * Retire a club from the league. SOFT: `inactive_since` is stamped and the document stays.
 *
 * Refused while the club is entered in an `active` or `future` season. Its junction rows are left
 * alone: the seasons it played still happened.
 * @summary Retire a team (soft delete)
 */
export const teamsDeleteTeam = async (teamId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getTeamsDeleteTeamUrl(teamId), {
    ...options,
    method: "DELETE",
  });
};

export const getTeamsGetTeamUrl = (teamId: string, params?: TeamsGetTeamParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/v0/teams/${encodeURIComponent(String(teamId))}?${stringifiedParams}`
    : `/api/v0/teams/${encodeURIComponent(String(teamId))}`;
};

/**
 * One team with its group and its figures in the season the query names, the season the site is on where it names none.
 *
 * 404 where the team, its row in that season or the season is one this tier may not read.
 * @summary One team
 */
export const teamsGetTeam = async (
  teamId: string,
  params?: TeamsGetTeamParams,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLTeamsSingleResponse> => {
  return baseKeyTransport<FLTeamsSingleResponse>(getTeamsGetTeamUrl(teamId, params), {
    ...options,
    method: "GET",
  });
};

export const getTeamsReactivateTeamUrl = (teamId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/reactivate`;
};

/**
 * Clear `inactive_since`, restoring a retired club to reads that hide retired ones.
 * @summary Bring a retired team back
 */
export const teamsReactivateTeam = async (teamId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getTeamsReactivateTeamUrl(teamId), {
    ...options,
    method: "POST",
  });
};

export const getTeamsPatchEinwilligungUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/account/einwilligung`;
};

/**
 * Set the signed-in person's two consents on every seat they hold on this team's season row: WhatsApp and media.
 *
 * One answer for all of them: a person holding two of the row's slots answers once, each choice moving only where it
 * differs from the row as the page served it, so seats answered apart keep their answers to a choice not changed. No
 * other slot of the row and no other row is written, each choice moving with its own evidence and leaving the
 * other standing; a press moving no seat writes nothing. A GRANT (`scope` to `kontakt_data_whatsapp` or `media`
 * to `true`) is taken on a row of an `active` or `future` season its team has not left; a withdrawal on any row the
 * person confirmed a seat on, a past season's included.
 *
 * Refuses, in this order: a row on which the address holds no confirmed seat (`role_not_held`); a
 * `evidence_state` other than the held seats' own, either choice having moved since the page was served
 * (`choices_stale`); a grant where the row grants no panel (`giving_not_allowed`); a choice moving onto a grant
 * under a label other than its current wording's, the page loaded before a rewording (`grant_wording_stale`);
 * `media` moving to `true` where a held seat's stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is
 * missing (`media_age`). Each refusal writes nothing.
 * @summary Change a seat holder's own WhatsApp and media consent on one team's season
 */
export const teamsPatchEinwilligung = async (
  teamId: string,
  saisonId: string,
  fLSeatEinwilligungPayload: FLSeatEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<void>(getTeamsPatchEinwilligungUrl(teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSeatEinwilligungPayload),
  });
};

export const getTeamsGetTeamSaisonAdminUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/admin`;
};

/**
 * Return what the team editor shows in one read: the club, its row of the season, and what each act of the page meets.
 *
 * `version` is what the one save sends. `membership` serves the row with its seats' links, null for
 * a club holding no row of the season, a retired one reached through the list's filter; `link` is null with it.
 * `gruppen` is each group the season offers with whether it is full, `gruppe_locked` whether a group move is refused
 * `entry_gruppe_locked`, `taken_trikot_farben` the colours another row holds, and `retire_blocked_by` the season
 * `retire_blocked` refuses over, by each write's own judgement.
 * `link` is the live registration link, the window's judgement of it, and why the season's press would pass the team
 * over. Read outside a transaction: a write landing under this read is judged by its own write. 404 where no club or no
 * season holds that id.
 * @summary One team in one season for the admin editor
 */
export const teamsGetTeamSaisonAdmin = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLTeamSaisonAdminResponse> => {
  return adminKeyTransport<FLTeamSaisonAdminResponse>(getTeamsGetTeamSaisonAdminUrl(teamId, saisonId), {
    ...options,
    method: "GET",
  });
};

export const getTeamsPatchTeamSaisonUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/admin`;
};

/**
 * Save the team editor's one version: the club, the rename's fan-out, and the group and colour of this season's row.
 *
 * Refused `version_stale` once the club or the row has moved since the editor read them, whichever it was. Judged per
 * part: a `past` season keeps the club's fields open and refuses `saison_past` only where the group or the colour
 * changes, since a finished season's table and podium are read off its rows. A shorthand another club holds, a retired one
 * included, is refused `duplicate_key`, naming `shorthand`. A group move is refused as `entry_gruppe_locked` and
 * `entry_gruppe_full` refuse it, and a colour the save moves onto one another row holds `trikot_farbe_taken`, naming
 * `trikot_farbe`. 404 where the club holds no row of the season.
 * @summary Save the team editor: the club and its row of the season, in one transaction
 */
export const teamsPatchTeamSaison = async (
  teamId: string,
  saisonId: string,
  fLPatchTeamSaisonPayload: FLPatchTeamSaisonPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPatchTeamSaisonResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLPatchTeamSaisonResponse>(getTeamsPatchTeamSaisonUrl(teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchTeamSaisonPayload),
  });
};

export const getTeamsPutAustrittUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/austritt`;
};

/**
 * Record how a team left the season, once: an exit is never lifted and never replaced.
 *
 * Refused `version_stale` on a row whose exit stands, whatever the write carries, the page having been read before it;
 * `saison_past` on a finished season; and `austritt_before_saison_start` until the season's start date, its `earliest`
 * the start: before it, the replacement takes a club out. 404 where the team holds no row of the season.
 * @summary Record a team's exit from a season
 */
export const teamsPutAustritt = async (
  teamId: string,
  saisonId: string,
  fLAustrittPayload: FLAustrittPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<void>(getTeamsPutAustrittUrl(teamId, saisonId), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAustrittPayload),
  });
};

export const getTeamsDeleteInvitationUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/invitation`;
};

/**
 * Stamp this team's live registration link revoked, so it opens nothing from here on.
 *
 * The row stays: a delivery event about a message carrying that link still has somewhere to land, and a reissue's history is what says
 * which link a bounce was about. 404 where the team holds no live link for the season; a link of a season that has ended stays revocable.
 * @summary Revoke this team's live registration link for a season
 */
export const teamsDeleteInvitation = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLInvitationWriteResponse> => {
  return adminKeyTransport<FLInvitationWriteResponse>(getTeamsDeleteInvitationUrl(teamId, saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getTeamsPostInvitationUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/invitation`;
};

/**
 * Mint the link a team's players register through, revoking whatever link that team held for this season.
 *
 * **The raw link value is in this answer and in no other, ever**: the row stores an unkeyed SHA-256 of it, so a link nobody copied out of
 * this response is lost and the repair is another mint. Mailing the team's link is a separate press
 * (`POST /teams/{team_id}/saisons/{saison_id}/invitation/dispatch`), whose mails mint links of their own beside this one.
 *
 * The reissue is part of the same transaction, so the previous link stops opening anything the moment this answers, and the team is left
 * holding exactly one live invitation. The link carries no date: it expires with the season's registration window, which is judged afresh
 * every time somebody opens it, so a window moved after the mint moves this link with it.
 *
 * Refused where the season holds no junction row for this team (`invitation_team_not_entered`) and where the season has ended
 * (`saison_past`); a `future` season mints, the links being prepared before the window opens. 404 where no season holds that id.
 *
 * A row whose exit stands is refused `version_stale`, the page offering this press having been read before the exit: its team's link
 * opens nothing, whoever holds it.
 * @summary Mint this team's registration link for a season
 */
export const teamsPostInvitation = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLInvitationMintResponse> => {
  return adminKeyTransport<FLInvitationMintResponse>(getTeamsPostInvitationUrl(teamId, saisonId), {
    ...options,
    method: "POST",
  });
};

export const getTeamsPostInvitationDispatchUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/invitation/dispatch`;
};

/**
 * Owe this team's live registration link to every seat of its season row whose own person has confirmed it, one mail each.
 *
 * The write mints nothing and revokes nothing: each mail mints a link of its own when it is handed out, so a link copied off the mint
 * stays valid beside the mailed ones. `mailed` counts who is owed it, one per stored address, and is 0 where nobody has confirmed a
 * seat, which owes nothing. Where it owes anyone, the row's `sent_at` becomes today, the day the season editor shows. Pressed
 * twice on one day, the second owes nothing again; a later day's press mails the seats afresh. A barred address is stopped when its mail
 * is handed out.
 *
 * Refused where the season has ended (`saison_past`), as the mint and the season's press are: its link opens nothing for good. A
 * window shut for now is no refusal, the link opening once the season takes registrations, and past the window's end it opens on
 * as a Nachnominierung. 404 where `invitation_id` is not this team's live invite for the season, a link replaced or withdrawn since
 * the caller read it among them, and where the season holds no row for the team. A row whose exit stands is refused `version_stale`,
 * as the mint refuses it.
 * @summary Mail this team's live registration link to its confirmed contact seats
 */
export const teamsPostInvitationDispatch = async (
  teamId: string,
  saisonId: string,
  fLInvitationMailPayload: FLInvitationMailPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLInvitationMailResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLInvitationMailResponse>(getTeamsPostInvitationDispatchUrl(teamId, saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLInvitationMailPayload),
  });
};

export const getTeamsPutKontaktSeatUrl = (teamId: string, saisonId: string, seat: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/kontakte/${encodeURIComponent(String(seat))}`;
};

/**
 * „Sitz bearbeiten“: write the person into one seat, judged by the seat's state, on the row's `version`.
 *
 * The same person, the address and name folded, keeps the seat's record and link, so a corrected number mails nobody and
 * `email` answers null. Anyone else takes the seat unconfirmed, a confirmed person giving way, and is owed a fresh link
 * in this write's own transaction, the answer naming the address; an emptied seat is filled the same way. The seat's
 * last holder answers the team's match confirmations no more. A `past` season's seats and a departed team's
 * stay correctable, and such a link takes the person's Widerspruch alone.
 *
 * Where the Trainer holds a second seat, a write on either seat writes both, under one link. `trainer_is_also` is read
 * on the Trainer's seat alone: sent, it replaces the claim, and the seat it names takes this person; null ends the
 * claim, and the seat it named keeps its person. Left out, the claim stands.
 *
 * Refused `version_stale` on a row moved since the read, and `kontakt_email_taken` and `kontakt_phone_taken` where another
 * seat's person holds the address or the number. 404 for a team and season holding no row, and for a path naming no seat.
 * @summary Write the person one contact seat holds
 */
export const teamsPutKontaktSeat = async (
  teamId: string,
  saisonId: string,
  seat: string,
  fLKontaktSeatPayload: FLKontaktSeatPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKontaktSeatResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLKontaktSeatResponse>(getTeamsPutKontaktSeatUrl(teamId, saisonId, seat), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLKontaktSeatPayload),
  });
};

export const getTeamsInviteKontaktUrl = (teamId: string, saisonId: string, seat: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/kontakte/${encodeURIComponent(String(seat))}/confirmation/invite`;
};

/**
 * Owe one contact seat a fresh confirmation link, mailed through the Postausgang in this write's own transaction.
 *
 * It replaces the seat's link WHOLE, and its pair's where the Trainer holds both and has not confirmed the other:
 * the previous link stops opening anything from this write on, and the deadline restarts from today. The answer names
 * the address the mail is owed to, never the link.
 *
 * Refused where the season has ended or the team has left it (`kontakt_row_without_saison`), and where the seat holds nobody or its
 * person has already confirmed it (`kontakt_seat_without_confirmation`).
 * 404 for a team and season holding no row, and for a path naming no seat.
 * @summary Send one contact seat a fresh confirmation link
 */
export const teamsInviteKontakt = async (
  teamId: string,
  saisonId: string,
  seat: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKontaktInviteResponse> => {
  return adminKeyTransport<FLKontaktInviteResponse>(getTeamsInviteKontaktUrl(teamId, saisonId, seat), {
    ...options,
    method: "POST",
  });
};

export const getTeamsReplaceSaisonTeamUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/replace`;
};

/**
 * Hand this season's junction row, and every fixture on it, to another club.
 *
 * Its `team_id`, identity copy and every fixture side move, its `austritt`, colour, contacts and
 * their links are cleared, and the outgoing club's live squad rows are retired, in ONE transaction:
 * the schedule survives.
 * @summary Replace a club in a season, keeping its schedule
 */
export const teamsReplaceSaisonTeam = async (
  teamId: string,
  saisonId: string,
  fLReplaceSaisonTeamPayload: FLReplaceSaisonTeamPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLReplaceSaisonTeamResponse> => {
  const getHeaders = (h?: NonNullable<RequestInit["headers"]>): Record<string, string | readonly string[]> => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Symbol.iterator in h) {
      return Object.fromEntries(Array.from(h as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string]));
    }
    const headers: Record<string, string | readonly string[]> = {};
    for (const [name, value] of Object.entries<string | readonly string[] | undefined>(h)) {
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  };
  return adminKeyTransport<FLReplaceSaisonTeamResponse>(getTeamsReplaceSaisonTeamUrl(teamId, saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLReplaceSaisonTeamPayload),
  });
};

export const getTeamsGetTeamOverviewUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/self/overview`;
};

/**
 * Everything a team's Übersicht shows, in one read, for a person holding any contact seat on the team in this season.
 *
 * The team's name, code, full name and colour, and the seats the signed-in person holds on it. The dates the league
 * asked the team to confirm that still hold work: unanswered (`valid`, or `vorschlag` with the other club's proposed
 * date and hour), unanswered past its deadline (`expired`), or declined with the team's own proposal and reason until
 * the league adopts or discards it (`declined`); an agreed date is not listed. Each by its day and hour. The coming
 * fixtures holding a day and an hour, neither decided nor called off, for which the team has stored no line-up and may
 * still enter one, each with its marks, soonest first. The registrations awaiting the team's decision, newest first,
 * each with the pupil's own position and Stufe, under the cap the team's Registrierungen page reads them by, and
 * `registrierungen_complete` false where it cut some. And the team's three seats, each with its holder's name and whether that
 * person confirmed it.
 *
 * No address, telephone number, birthdate or consent record of anybody is served. Refused `role_not_held` where the
 * signed-in person holds no seat on this team in this season.
 * @summary A team's Übersicht in one season
 */
export const teamsGetTeamOverview = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLTeamOverviewResponse> => {
  return adminKeyTransport<FLTeamOverviewResponse>(getTeamsGetTeamOverviewUrl(teamId, saisonId), {
    ...options,
    method: "GET",
  });
};

export const getTeamsGetTeamSpieleUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/self/spiele`;
};

/**
 * Every fixture of the team in this season in the order the draw numbered them, for a person holding any contact seat on it.
 *
 * Each as the public reads serve a fixture, with its matchday's `position` and its phase's count of matchdays, the
 * state of the date the league asked the team to confirm, and its line-up's marks: whether one is stored, the phase
 * the clock puts it in, and the instants it is due and locks at. `termin` is null where no row asks the team about
 * the fixture as it stands, and `aufstellung` for a fixture holding no day or no hour.
 *
 * Refused `role_not_held` where the signed-in person holds no seat on this team in this season.
 * @summary A team's fixtures in one season, with what is open on each
 */
export const teamsGetTeamSpiele = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLTeamSpieleResponse> => {
  return adminKeyTransport<FLTeamSpieleResponse>(getTeamsGetTeamSpieleUrl(teamId, saisonId), {
    ...options,
    method: "GET",
  });
};
