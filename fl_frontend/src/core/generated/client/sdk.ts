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
  CheckIsReadyResponse,
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
  FLSpielberichtPayload,
  FLSpielberichtSchiedsrichterResponse,
  FLSpielbestaetigungAnswerResponse,
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
  SchiedsrichterGetSchiedsrichterParams,
  SpieleGetSpieleSpielplanParams,
  SpielePatchSpielParams,
  SpielerGetSpielerAdminParams,
  SpielorteGetSpielorteParams,
  TeamsGetTeamParams,
  TeamsGetTeamsAdminParams,
} from "./types.ts";

export const getAccountDeleteAddressChangeUrl = () => {
  return `/api/v0/account/address_change`;
};

/**
 * Stop the change pending on the signed-in address at any step, its new address going; a holder's change in its wait tells every holder.
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
 * The change pending on the signed-in address, null where none is.
 *
 * The pending address is served whole only where the person typed it, and masked where an administrator started the change.
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
 * Start a change of the address the person signs in on: the address on file is mailed a link, and its confirmation mails the new one.
 *
 * Everything the address holds moves once the new address confirms, after a wait where it holds a grant; declining
 * either link ends the change, and a live change of the address is replaced.
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
 * Every confirmed consent record the signed-in address holds, pending applications and registrations as withdraw-only.
 *
 * An address holding nothing is answered empty, never refused, and retired and past records are served too, so a
 * withdrawal stays open wherever a consent stands.
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
 * The newest 50 acts the filters keep, starting after `cursor` where one is given.
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
 * Every running change this administrator may act on, newest first, with its two addresses and the step it waits on.
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
 * Start a change of the typed address for a person who says they cannot sign in.
 *
 * The new mailbox is mailed a link and the address on file a stop link, and nothing moves until a waiting period after
 * the new mailbox confirms, the old address working until then.
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
 * The new address, folded, of the live change a new-mailbox link token or a change id names.
 *
 * A token or id naming no live change is answered null rather than refused, so a lapsed or answered link costs no error.
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
 * The new mailbox's confirmation moves everything the address holds unless the change waits, as `effective` and
 * `effective_from` say; the address on file's confirmation of the person's own change only mails the new mailbox its link.
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
 * Stop the change the address on file was mailed about, its new address going, at any time until the change ends.
 *
 * The person's own change offers this link no stop until its address on file confirmed it.
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
 * What this token opens: the new mailbox's link, the link the address on file was mailed, or how either's change ended.
 *
 * Each side is served in the state its press would meet, and an ended change's links answer for as long as its record
 * is kept.
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
 * End a share of the changes whose step lapsed, and make each due one take effect, or end it where its judgement now refuses it.
 *
 * A pass is a run of calls, each handing the next the `after` the last answered, ending at the call answering `after`
 * null; `remaining` is no stopping condition.
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
 * The ended changes still owing to carry a sign-in account to their new address, oldest first and a page at a time.
 *
 * The caller reports the ones it moved to `POST /address_change/sweep/moves/done`, and the next call lists the rest again.
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
 * Discard the change this id names, the address on file staying.
 *
 * A holder's change in its wait tells every holder, and nobody else is mailed.
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
 * Mail the new mailbox a fresh link for the change this id names, its deadline restarting now.
 *
 * The previous link stops working once the fresh one is handed out, and only a change waiting on the new mailbox has a
 * link to re-send.
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
 * Save the whole line-up of one club for one fixture at any time, the hour before kick-off included.
 *
 * An entry naming nobody stands for a pupil erased after the match was played, and a save keeps it by sending it back.
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
 * A finished season grants no seat, so its line-ups are an administrator's to read.
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
 * A line-up being due or overdue refuses nothing, and `version` is the document's as the screen was served it, null
 * where the screen showed no line-up.
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
 * Every ban, newest first, with the address, why, on which day and the last season it covers.
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
 * Ban an address: it cannot sign in, and no mail leaves for it but the ban's own notice, sent where `notify` is set.
 *
 * The ban runs a fixed number of seasons past the running one, and it and its reason outlive the person's erasure.
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
 * Lift a ban before it lapses, deleting its row for good.
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
 * Store one school's application to play one season, and mail each contact person their confirmation link, one per person.
 *
 * A second press with an `Idempotency-Key` already stored answers the application that key holds and stores nothing.
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
 * Record one person's consent or Widerspruch for the seat their link opens, and for a second seat they hold.
 *
 * A Widerspruch empties the slot, and on an application it tells the Ansprechperson who still stands, in a notice that
 * is the deletion notice too.
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
 * A confirmed, declined or expired link is served in that state; only a token no seat holds is refused.
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
 * A season's application window, and while it runs the clubs a school may apply as and the colours taken.
 *
 * A closed or paused window and a season recording none are served too, and each club is served as its name alone.
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
 * The season's applications, newest first, holding nothing of a person, and what an acceptance would meet there.
 *
 * A long list is cut, as `complete` says, but every application with a confirmed seat is served past the cut.
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
 * Run one season's retention clocks as of today, each reminder and deletion notice owed in the write it belongs to.
 *
 * A row that cannot be written is passed over, counted in `failed`, and met again by the next pass.
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
 * One application, each seat's state judged today and `duplicate` taken over every open application of the season.
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
 * Accept an application once every contact person confirmed their seat, entering its club into the season and creating it for a new school.
 *
 * It cannot be undone, as an entered club leaves only by an `austritt`, and every person of the application is mailed
 * the acceptance.
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
 * Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application; a grant is refused.
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
 * Decline an application with the reason given, mailed verbatim to each person the application mailed.
 *
 * What the school submitted stays as it was, the record the decision was taken against.
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
 * Void one seat's link and mail its person a fresh one, that seat's deadline and reminder starting again from today.
 *
 * Where one person holds two seats both are replaced and one link answers both, and the answer names the address and
 * seats as the write found them.
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
 * Write a person into one seat, whatever its state, and mail them a fresh link; an acceptance waits on their answer.
 *
 * Where one person holds two seats both are written, the last holder's link opens nothing afterwards, and the seat's
 * deadline starts again from today.
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
 * Every grant by address: its tier, when it holds, and when a handover to it completes.
 *
 * A future `effective_from` is an addition still waiting, and `owner_from` a handover still waiting.
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
 * Add an address as `administration`, holding once its wait has passed; only the owner adds one, and no request grants `owner`.
 *
 * Every holder in effect and the address named are told, with the date it holds from.
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
 * Remove a grant for good, its address losing access on its next request, or withdraw an addition still waiting.
 *
 * Only the owner removes one, the owner's own row leaving only by a handover; every holder in effect and the address named are told.
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
 * Stop a waiting handover, the role staying with the owner; only the owner stops one, and every holder in effect is told.
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
 * Start handing the owner role to an administrator in effect, completing once its wait has passed; the owner stays the owner until then.
 *
 * Only the owner starts one, and every holder in effect is told the date it completes on.
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
 * Erase every record the signed-in address holds, at once and as one write; the owner is refused until a handover.
 *
 * A played match keeps its report, its line-ups and its booking, each naming nobody in the person's place, and the
 * sign-in account is the caller's to delete once this has answered.
 * @summary Erase every record the signed-in address holds
 */
export const identityPostAccountErasure = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getIdentityPostAccountErasureUrl(), {
    ...options,
    method: "POST",
  });
};

export const getIdentityGetAccountErasureViewUrl = () => {
  return `/api/v0/identity/account/erasure/view`;
};

/**
 * What `POST /identity/account/erasure` would remove or empty for the signed-in address, by kind and by name, and nothing else.
 *
 * Another address's pending change naming this one is counted and not named once its link has reached this mailbox,
 * since its records are not this address's until it takes effect.
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
 * Erase every record an address holds, on a request that person made by mail, at once and as one write, as their own erasure does.
 *
 * Nothing about the person's own state refuses it, and the sign-in account is the caller's to delete once this has answered.
 * @summary Erase every record an address holds, on that person's request
 */
export const identityPostErasure = async (
  fLErasurePayload: FLErasurePayload,
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
  return adminKeyTransport<void>(getIdentityPostErasureUrl(), {
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
 * A pass is a run of calls, each handing the next the `after` the last answered, and it ends at the call answering
 * `after` null; `remaining` counts the pupils still due, the failed among them, so it is no stopping condition.
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
 * Count what `POST /identity/erasure` would remove or empty for this address, by kind, naming nothing and storing nothing.
 *
 * It is refused as that erasure is, and leaves out of `address_change` a grant holder's change this administrator may not see.
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
 * Record what the mail provider reported about one message on its mail's row, where the row's state may follow into it.
 *
 * A redelivered or out-of-order event changes nothing, and a delivery of a mail about an application reopens the
 * closed chase of every seat holding its address.
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
 * Claim a page of the mails owed now, the sign-in library's first, and hand each out with the link minted for it.
 *
 * The caller sends each under the idempotency key its `attempt` names and reports every outcome with `lease` before the
 * lease lapses, after which the next claim hands the mail out again.
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
 * Settle the named mail by its send's outcome where the named claim still holds it, counting a mail it does not hold in `ignored`.
 *
 * `held` reports a deployment that sends no mail, `abandon` a refusal every send would meet (any 4xx but a 429), and
 * `retry` a 429, a 5xx or a send that never reached the provider, which hands the mail back unless it is a sign-in
 * mail or past its deadline.
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
 * Owe one mail the sign-in library sends, such as a code, a passkey notice or the deletion link, to the address named.
 *
 * `secret` is stored as it arrives and dropped once the mail is settled; `valid_until` is both the last moment a send
 * may happen and when the row is deleted.
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
 * A press repeating a stored `Idempotency-Key` answers the registration the first one stored, whatever its body says,
 * and owes no second mail.
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
 * A grant is refused, and a request moving neither choice writes nothing.
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
 * What the registration this confirmation link opens shows, and nothing of the pupil but the day they answered.
 *
 * A confirmed or expired link is served in that state, and a link whose club has left the season reads expired.
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
 * A paused or ended window is a state here, so such a link reads as closed rather than as invalid.
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
 * Every pending registration of this team's season, newest first, each marked by whether its pupil confirmed it.
 *
 * A confirmed row names the stored person its address resolves to, flagged where their name or birthdate differs,
 * `kader_full` marks a row whose admission would meet the squad's cap, and no address, telephone number, birthdate or
 * consent record is served for anybody.
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
 * One season's pending registrations, newest first, each with its club and whether its pupil confirmed it.
 *
 * `unmailed` marks a row owed no mail, its mailbox already holding the most open links, and `complete` says whether
 * the read's cap cut the list.
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
 * Erase one season's due registrations, as of today in Europe/Berlin.
 *
 * A declined one goes once its wait after the decision has run out, an unconfirmed one past its deadline, and every one
 * still undecided once the season is `past`; one whose erasure fails is counted in `failed` and met again next pass.
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
 * Admit one confirmed registration: the person holding its address, or a new one, joins the team's squad.
 *
 * `spieler_id` names that person where their name or birthdate differs and is null where nobody holds the address;
 * the registration and every other pending one of its address this season are erased, and nobody is mailed.
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
 * Decline one pending registration, confirmed or not, for a reason from a closed set or none.
 *
 * A pupil who confirmed their address is mailed the decision; an unconfirmed address may be a stranger's, and is
 * mailed nothing.
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
 * Its id follows the newest stored season's and its rules carry on from it, its two windows start closed, and a league
 * holds at most one planned season.
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
 * Beside it, the application windows and the league's figures over every season the public reads, counted on every read.
 * @summary The landing
 */
export const saisonsGetLanding = async (options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLLandingResponse> => {
  return baseKeyTransport<FLLandingResponse>(getSaisonsGetLandingUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSaisonsAdminUrl = () => {
  return `/api/v0/saisons/list/admin`;
};

/**
 * Every season, the `future` ones included, each with its start, play and decision states and its counts.
 *
 * `next_saison_id` is the id the next create mints, and `refusals.create` the code that create would be refused with
 * now, or null.
 * @summary Every Saison for the admin surfaces
 */
export const saisonsGetSaisonsAdmin = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLSaisonsAdminListResponse> => {
  return adminKeyTransport<FLSaisonsAdminListResponse>(getSaisonsGetSaisonsAdminUrl(), {
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
 * Save a season's dates and rules on the `version` it was read at, answering the version stored.
 *
 * What a started or drawn season has fixed is refused, as is a rule narrowed below what it holds; the start date is
 * fixed once a fixture has taken place, and moves later only while no club's exit is stored.
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
 * Make this the active season, moving whichever holds `active` to `past`.
 *
 * The outgoing season must be finished, and every matchday of the target dated.
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
 * What the season editor shows in one read: its season, clubs, shapes and matchdays, its acts' states and its links.
 *
 * The season is served a `future` one included, and every flag and every refusal is judged as the write it stands for
 * judges it, so an act is offered exactly where its write takes it.
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
 * Every group fixture fielding either club has that side rewritten with it, so each group stays a round robin; neither
 * `tore` nor `austritt` moves.
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
 * Give every admitted team of this season a fresh registration link, revoking any it held, mailed to its confirmed seats.
 *
 * A team that has left the season, holds no confirmed seat or was already sent its live link is skipped and left as it
 * was, so pressing twice mails nobody twice.
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
 * The administrator's Übersicht for one season: its open work on the cards `due`, `ergebnisse`, `dates` and `bewerbungen`.
 *
 * Every card is served, an empty one included, and each row carries what its act needs, the fixture with its `version`
 * among it.
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
 * Return the season to undrawn: its matchdays and fixtures, their confirmations, reports and line-ups, and the draw's day.
 *
 * Undoing the draw reopens the shape rules to an edit and the groups to an entry.
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
 * 404 for a season this tier may not read.
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
 * Draw the whole season at once, every matchday and every fixture undated, from the stated `shape` or the season's rules.
 *
 * A stated `shape` is stored in the rules, and `replace` first deletes what a planned season holds, its fixtures'
 * confirmations, reports and line-ups with it; nothing writes the removed rows back.
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
 * Every referee in name order, retired ones included where `include_inactive` asks, since a played match still names them.
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
 * Create a referee and owe them their confirmation link, answering the address and the deadline it goes to.
 *
 * Entering a referee is the invitation, with no second press deciding whether they are asked, since a referee nobody
 * asked is a name nobody consented to publish.
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
 * The public fixture list reads the scope off this row, so the caller drops its cached copy after a successful answer.
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
 * The caller drops the cached fixture list after a successful answer, or a withheld name goes on being served for as
 * long as that entry lives.
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
 * The entry is erased at the midnight after its link's deadline, and until then no booking takes it and nobody asks
 * the person again.
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
 * What this token opens: the link's state and deadline, the age bounds and the day of the person's own answer.
 *
 * A confirmed or an expired link is served in that state rather than refused, so a reopened link shows what became of it.
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
 * Every fixture of this season booked to one of the signed-in address's live, confirmed referee records, open work first.
 *
 * Nobody's address is served, and no reason an administrator entered.
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
 * Each goes as a person's own erasure takes a referee entry, and one whose erasure fails is counted in `failed` and
 * stays due for the next pass.
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
 * Deactivate a referee, who stays on record because a played match names them by id.
 *
 * Refused while a fixture still to be played books them.
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
 * One referee, a retired one included, with whether their consent link has lapsed today and what became of their last confirmation mail.
 *
 * An erased referee's id answers 404.
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
 * A corrected address on an unconfirmed referee retires their link and owes a fresh one, named in `confirmation`, and a
 * confirmed referee's address moves only through an address change.
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
 * The previous link stops working at once and the deadline restarts from today; a referee who has already answered is
 * refused, since the new link could never be spent.
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
 * Bring a retired referee back into the picker and every default read.
 *
 * One who has not answered is owed a fresh link, named in `confirmation`, since a retired referee's save mails nothing.
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

export const getSpielberichteGetSpielberichtBerichtUrl = (spielId: string) => {
  return `/api/v0/spielberichte/${encodeURIComponent(String(spielId))}/bericht`;
};

/**
 * What the booked referee's report form reads: the fixture, both clubs' live squads, and the stored report or null.
 *
 * Where `reportable` is false or `completed` true, both squads are empty and every pupil the report names is in `named`.
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
 * Write the whole report of one fixture as its booked referee, replacing what stood, and never the fixture's result.
 *
 * A write changing the report clears its adoption, and `version` is the report document's as the form was served it,
 * null where the form showed no report.
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

export const getSpielbestaetigungenGetSweepSaisonsUrl = () => {
  return `/api/v0/spielbestaetigungen/sweep`;
};

/**
 * Every `active` season's id, oldest first: a confirmation serves no purpose once its season is over.
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
 * Close, mint and remind one season's fixture confirmations as of today, owing each mail with its row, and answer what it did, counted.
 *
 * Each step takes a bounded share and leaves the rest due, and a season that is not `active` is passed by whole.
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
 * Move a fixture to the date and hour a club's open decline proposes, through the fixture's own save and refused as it is.
 *
 * The next confirmation pass closes every party's row about the slot left, tells each of the move and asks about the
 * new slot.
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
 * Record the signed-in referee's first answer about a fixture they are booked on, until its kick-off: accept, or decline giving a reason.
 *
 * A decline takes them off the fixture, and the caller drops the cached fixture list after a successful answer, since
 * either answer can move the referee's name on the public fixture.
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
 * It writes no fixture: a decline's proposal is the administrator's to act on, and is refused wherever the
 * administrator's own save of that date would be.
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
 * Close a club's open decline proposing another date, which then stands as that club's one answer to this Ansetzung.
 *
 * The public fixture counts it as the club's agreement, and the club is told that the date stands.
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
 * Record that the party of an open confirmation agreed to its Ansetzung elsewhere than signed in, the reason saying how.
 *
 * The answer is the league's record of how a date was agreed and is never rewritten; it names nobody, and its reason
 * goes at the season's end.
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
 * Every matchday and knockout round of one season, a planned one included, its matches in the admin shape, in play order.
 *
 * `current_spieltag_id` is the matchday to open on: the first holding a match still to be played, else the last.
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
 * A `dry_run` writes nothing and answers the same report, with the parties the confirmation pass would mail and the
 * later results the save would delete, which the save's `voided_results` must name back.
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
 * Beside it come the venues and referees to book, the clubs a knockout fixture may field, and the fixture's report,
 * confirmation rows and line-up counts.
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
 * Each moved choice is written with its evidence, and the caller drops its cached squad lists after a success, since
 * the scope decides whether a name is served.
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
 * The squad of one team in one season for a person holding a contact seat on it, ausgetragen rows included.
 *
 * Each surname is whole, and no address or telephone number of anybody is served.
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
 * Take a player out of this team's squad for the season, as any contact seat of the team may, the row staying.
 *
 * The person stays in the league, and only an administrator brings the row back.
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
 * The team and the Nachnominierung flag stay the stored row's, and a shared `nummer` is permitted.
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
 * Every squad row of the season, live and ausgetragen alike, each named and with its club.
 *
 * `nummer_double` marks a live row whose number another live row of its own squad wears, compared as stored.
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
 * Every season the signed-in pupil holds a squad row in, the newest first, each with its span.
 *
 * A deregistered row's season and a planned season are served as any other.
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
 * The signed-in pupil's squad row of one season, null where they hold none, and their club's fixtures in the draw's order.
 *
 * Each fixture's `starts` is true where the club's stored line-up starts them, false where it benches them, and null
 * where it does not name them or none is stored.
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
 * Take a player out of a season's squad, the row staying, marked by `inactive_since`.
 *
 * The row records that this player wore this number in this squad, which stays true after they leave.
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
 * What the Spieler editor shows: the person, their squad row of the season, and what its boxes may offer.
 *
 * `version` is what the one save sends, and `taken_rollen` each role another live row of the squad holds.
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
 * Save the person's own facts and their squad row of the season together, the team staying the stored row's.
 *
 * A shared `nummer` is permitted.
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
 * Clear a squad row's `inactive_since`, the row returning with the number, position and role it had.
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
 * Every venue in name order, the retired ones too where `include_inactive` asks for them.
 *
 * `maps_link` is a Maps search string, not a URL.
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
 * Create a venue, its `maps_link` derived from the name and the address.
 *
 * A name another venue holds, a retired one included, is refused.
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
 * Retire a venue, which stays readable for every match played there.
 *
 * Refused while an unplayed fixture is booked at it.
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
 * One venue, a retired one included, with the `version` its save sends back.
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
 * Save a venue on the `version` it was read at, answering the version stored.
 *
 * Every fixture at the venue shows its new name and `maps_link`, and keeps the `mietpreis` agreed for it.
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
 * Return a retired venue to every default read.
 * @summary Bring a deactivated Spielort back
 */
export const spielorteReactivateSpielort = async (spielortId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getSpielorteReactivateSpielortUrl(spielortId), {
    ...options,
    method: "POST",
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
 * Move a matchday's span, answering its `version` after the save.
 *
 * The span stays inside its season and around its own dated fixtures, and its `start` keeps the order its phase is
 * dated in.
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
 * One matchday by its id, a `future` season's included, with how many matchdays its phase holds.
 *
 * Beside it stands its season's `status`, so a `past` season's matchday, which no re-dating moves, can be shown as
 * final.
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

export const getSystemCheckIsReadyUrl = () => {
  return `/api/v0/system/is_ready`;
};

/**
 * Readiness: whether this process reaches its database, 503 where a ping does not return within the request's deadline.
 *
 * Unauthenticated, for a monitor outside.
 * @summary Readiness probe
 */
export const systemCheckIsReady = async (options?: Parameters<typeof unkeyedTransport>[1]): Promise<CheckIsReadyResponse> => {
  return unkeyedTransport<CheckIsReadyResponse>(getSystemCheckIsReadyUrl(), {
    ...options,
    method: "GET",
  });
};

export const getTeamsGetTeamsAdminUrl = (params: TeamsGetTeamsAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/teams/list/admin?${stringifiedParams}` : `/api/v0/teams/list/admin`;
};

/**
 * One season's clubs, a `future` season's included, each with its seats and state, and what entering another offers.
 *
 * `state=retired` reads past the season's rows to every retired club, which is the way back to one, and `entry.closed`
 * is true where the season, not being `future`, takes no entry.
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
 * A club's `shorthand` is unique across every club, retired ones included, and a colour across the season's rows.
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
 * Retire a club from the league, its rows of the seasons it played left as they are.
 *
 * Refused while the club is entered in an `active` or `future` season.
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
 * Each choice moves only where it differs from the row as the page served it, so seats answered apart keep their
 * answers to a choice not changed.
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
 * What the team editor shows in one read: the club, its row of the season, and what each act of the page would meet.
 *
 * `version` is what the one save sends, each flag is judged as its write judges it, and `membership` and `link` are
 * null for a club holding no row of the season.
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
 * Save the team editor's one version: the club, its name on its unfinished seasons' rows, and this season's group and colour.
 *
 * A `past` season keeps the club's fields open and fixes the row's group and colour, and a group move and a colour
 * are judged as an entry's.
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
 * An exit is taken from the season's start date on, before which the replacement takes a club out, and never on a
 * finished season.
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
 * The row stays, so a delivery event about a mail carrying the link still has somewhere to land.
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
 * The raw link is in this answer and in no other, the row storing only its hash, and it opens for as long as the season's
 * registration window does, judged afresh at each opening.
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
 * Owe this team's live registration link to every seat whose own person has confirmed it, one mail each, `mailed` counting them.
 *
 * Each mail mints a link of its own at its hand-out, so a copied link stays valid beside them, and a second press on
 * one day owes nothing again.
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
 * Write the person one seat holds on the row's `version`, a newly seated person owed a fresh link whose address `email` names.
 *
 * The same person, address and name folded, keeps the seat's record and link, and where the Trainer holds a second seat
 * a write on either seat writes both under one link.
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
 * Owe one contact seat a fresh confirmation link, and its pair where the Trainer holds both and has not confirmed it.
 *
 * The previous link opens nothing from this write on, the deadline restarts from today, and the answer names the
 * address the mail is owed to, never the link.
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
 * Hand this season's row, and every fixture on it, to another club, keeping the schedule.
 *
 * The row's exit, colour, contacts and their links are cleared, and the outgoing club's live squad rows retired.
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
 * Everything a team's Übersicht shows in one read, for a person holding any contact seat on the team in this season.
 *
 * No address, telephone number, birthdate or consent record of anybody is served.
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
 * Each carries the state of the date the league asked the team to confirm and its line-up's marks, `spielbestaetigung` null where
 * no row asks the team about the fixture as it stands.
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
