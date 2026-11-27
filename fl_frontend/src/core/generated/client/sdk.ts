import {
  adminKeyDryRunTransport,
  adminKeyReadTransport,
  adminKeyTransport,
  baseKeyReadTransport,
  baseKeyTransport,
  serializeQuery,
  systemKeyPassTransport,
  systemKeyReadTransport,
  systemKeyTransport,
} from "@/core/transport";

import type {
  AccountPostAddressChangeParams,
  AddressChangePostAddressChangeAdminParams,
  BanListPostBanListEntryParams,
  BewerbungenGetBewerbungenAdminParams,
  BewerbungenPostKontaktSeatParams,
  FLAcceptBewerbungPayload,
  FLAccountAddressChangePayload,
  FLAccountAddressChangeResponse,
  FLAccountEinwilligungenResponse,
  FLAccountEinwilligungPayload,
  FLAccountErasureViewResponse,
  FLActionLogByOptionsResponse,
  FLActionLogFilterPayload,
  FLActionLogListResponse,
  FLAddressChangeAddressPayload,
  FLAddressChangeAddressResponse,
  FLAddressChangeAdminListResponse,
  FLAddressChangeAdminPayload,
  FLAddressChangeAnswerPayload,
  FLAddressChangeAnswerResponse,
  FLAddressChangeMovesDonePayload,
  FLAddressChangeMovesResponse,
  FLAddressChangeSweepResponse,
  FLAddressChangeViewEnded,
  FLAddressChangeViewNew,
  FLAddressChangeViewPrevious,
  FLAufstellungPayload,
  FLAufstellungResponse,
  FLAustrittPayload,
  FLBanListResponse,
  FLBewerbungEinwilligungDeclined,
  FLBewerbungEinwilligungGiven,
  FLBewerbungEinwilligungViewAnswered,
  FLBewerbungEinwilligungViewExpired,
  FLBewerbungEinwilligungViewSaisonPast,
  FLBewerbungEinwilligungViewValid,
  FLBewerbungenAdminListResponse,
  FLBewerbungFormResponse,
  FLBewerbungKontaktSeatPayload,
  FLBewerbungKontaktSeatResponse,
  FLBewerbungSingleResponse,
  FLBewerbungSweepResponse,
  FLCreatedResponse,
  FLDeclineBewerbungPayload,
  FLEinwilligungWithdrawalPayload,
  FLEinwilligungWithdrawalReport,
  FLErasureAddressPayload,
  FLErasurePayload,
  FLErasureSweepResponse,
  FLErasureViewResponse,
  FLGenerateSpielplanPayload,
  FLGrantHandoverPassResponse,
  FLGrantRemovedResponse,
  FLGrantsListResponse,
  FLInvitationMailPayload,
  FLInvitationMailResponse,
  FLInvitationMintResponse,
  FLInvitationsMailResponse,
  FLInvitationViewResponse,
  FLKaderResponse,
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
  FLPatchSchiedsrichterPayload,
  FLPatchSchiedsrichterResponse,
  FLPatchSpielDataPayload,
  FLPatchSpielDataResponse,
  FLPatchSpielerSaisonPayload,
  FLPatchSpielortPayload,
  FLPatchSpieltagPayload,
  FLPatchTeamSaisonPayload,
  FLPostBanListEntryPayload,
  FLPostBewerbungPayload,
  FLPostGrantPayload,
  FLPostRegistrierungPayload,
  FLPostSaisonPayload,
  FLPostSaisonResponse,
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
  FLPostSpielortPayload,
  FLPostTeamEntryPayload,
  FLReferencesPayload,
  FLReferencesResponse,
  FLRegistrierungAdmitPayload,
  FLRegistrierungConfirmationPayload,
  FLRegistrierungConfirmationViewConfirmed,
  FLRegistrierungConfirmationViewExpired,
  FLRegistrierungConfirmationViewValid,
  FLRegistrierungDeclinePayload,
  FLRegistrierungSweepResponse,
  FLReplaceSaisonTeamPayload,
  FLSaisonAdminResponse,
  FLSaisonFrameResponse,
  FLSaisonOverviewResponse,
  FLSaisonRetentionResponse,
  FLSaisonsAdminListResponse,
  FLSaisonTeamsResponse,
  FLSchiedsrichterAccountEinwilligungPayload,
  FLSchiedsrichterConfirmationPayload,
  FLSchiedsrichterConfirmationViewConfirmed,
  FLSchiedsrichterConfirmationViewExpired,
  FLSchiedsrichterConfirmationViewValid,
  FLSchiedsrichterListResponse,
  FLSchiedsrichterReactivateResponse,
  FLSchiedsrichterSingleResponse,
  FLSchiedsrichterSpieleResponse,
  FLSchiedsrichterSweepResponse,
  FLSeatEinwilligungPayload,
  FLSignInResponse,
  FLSpielberichtPayload,
  FLSpielberichtSchiedsrichterResponse,
  FLSpielbestaetigungEnterPayload,
  FLSpielbestaetigungSchiedsrichterAnswerPayload,
  FLSpielbestaetigungSweepResponse,
  FLSpielbestaetigungTeamAnswerPayload,
  FLSpieleAdminSingleResponse,
  FLSpielerAdminListResponse,
  FLSpielerSaisonAdminResponse,
  FLSpielerSaisonSelfResponse,
  FLSpieleSpielplanAdminResponse,
  FLSpielorteListResponse,
  FLSpielorteSingleResponse,
  FLSpielPageResponse,
  FLSpielplanResponse,
  FLSpieltagAdminResponse,
  FLSubjectPayload,
  FLSubjectResponse,
  FLSwapGruppenPayload,
  FLSweepSaisonsResponse,
  FLTabelleResponse,
  FLTeamOverviewResponse,
  FLTeamPageResponse,
  FLTeamsAdminListResponse,
  FLTeamSaisonAdminResponse,
  FLTeamSpieleResponse,
  FLTokenPayload,
  FLVersionResponse,
  GrantsPostGrantParams,
  GrantsPostHandoverParams,
  IdentityPostWithdrawalParams,
  SaisonsGetSweepSaisonsParams,
  SchiedsrichterPatchSchiedsrichterParams,
  SchiedsrichterPostSchiedsrichterParams,
  SpieleGetSpieleSpielplanParams,
  SpielePatchSpielParams,
  SpielerGetSpielerAdminParams,
  TeamsGetTeamsAdminParams,
  TeamsPutKontaktSeatParams,
} from "./types.ts";

const getHeaders = (...sources: (RequestInit["headers"] | Record<string, string | undefined>)[]) => {
  const seen = new Set<string>();
  const layers: [string, string | readonly string[]][][] = [];
  for (const source of sources.reverse()) {
    if (!source) continue;
    const entries =
      source instanceof Headers
        ? source.entries()
        : Symbol.iterator in source
          ? Array.from(source as Iterable<Iterable<string>>, (entry) => Array.from(entry) as [string, string])
          : Object.entries<string | readonly string[] | undefined>(source);
    const layer: [string, string | readonly string[]][] = [];
    for (const [name, value] of entries) {
      if (value !== undefined && !seen.has(name.toLowerCase())) layer.push([name, value]);
    }
    for (const [name] of layer) seen.add(name.toLowerCase());
    layers.push(layer);
  }
  return Object.fromEntries(layers.reverse().flat()) as Extract<RequestInit["headers"], Record<string, unknown>>;
};

export const getAccountDeleteAddressChangeUrl = () => {
  return `/api/account/address_change`;
};

/**
 * Stop the change pending on the signed-in address at any step, its new address going; a holder's change in its wait tells every holder.
 * @summary Stop the address change pending on the signed-in person
 */
export const accountDeleteAddressChange = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getAccountDeleteAddressChangeUrl(), {
    ...options,
    method: "DELETE",
  });
};

export const getAccountGetAddressChangeUrl = () => {
  return `/api/account/address_change`;
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

export const getAccountPostAddressChangeUrl = (params?: AccountPostAddressChangeParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/account/address_change?${stringifiedParams}` : `/api/account/address_change`;
};

/**
 * Start a change of the address the person signs in on: the address on file is mailed a link, and its confirmation mails the new one.
 *
 * Everything the address holds moves once the new address confirms, after a wait where it holds a grant; declining
 * either link ends the change, and a live change of the address is replaced. A `dry_run` is refused as the start would
 * be, and writes nothing where it would land.
 * @summary Start a change of the signed-in person's address
 */
export const accountPostAddressChange = async (
  fLAccountAddressChangePayload: FLAccountAddressChangePayload,
  params?: AccountPostAddressChangeParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<void> => {
  return adminKeyDryRunTransport<void>(getAccountPostAddressChangeUrl(params), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAccountAddressChangePayload),
  });
};

export const getAccountGetEinwilligungenUrl = () => {
  return `/api/account/einwilligungen`;
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

export const getActionLogGetActionLogByOptionsUrl = () => {
  return `/api/action_log/by_options`;
};

/**
 * Every value `by` holds across the whole log, the who filter's options.
 * @summary List who acted in the log
 */
export const actionLogGetActionLogByOptions = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLActionLogByOptionsResponse> => {
  return adminKeyTransport<FLActionLogByOptionsResponse>(getActionLogGetActionLogByOptionsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getActionLogGetActionLogUrl = () => {
  return `/api/action_log/view`;
};

/**
 * The newest 50 acts the filters keep, starting after `cursor` where one is given.
 * @summary List recorded acts
 */
export const actionLogGetActionLog = async (
  fLActionLogFilterPayload: FLActionLogFilterPayload,
  options?: Parameters<typeof adminKeyReadTransport>[1],
): Promise<FLActionLogListResponse> => {
  return adminKeyReadTransport<FLActionLogListResponse>(getActionLogGetActionLogUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLActionLogFilterPayload),
  });
};

export const getAddressChangeGetAddressChangesUrl = () => {
  return `/api/address_change`;
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

export const getAddressChangePostAddressChangeAdminUrl = (params?: AddressChangePostAddressChangeAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/address_change?${stringifiedParams}` : `/api/address_change`;
};

/**
 * Start a change of the typed address for a person who says they cannot sign in.
 *
 * The new mailbox is mailed a link and the address on file a stop link, and nothing moves until a waiting period after
 * the new mailbox confirms, the old address working until then. A `dry_run` is refused as the start would be, and
 * writes nothing.
 * @summary Start an address change for a person who says they cannot sign in
 */
export const addressChangePostAddressChangeAdmin = async (
  fLAddressChangeAdminPayload: FLAddressChangeAdminPayload,
  params?: AddressChangePostAddressChangeAdminParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<void> => {
  return adminKeyDryRunTransport<void>(getAddressChangePostAddressChangeAdminUrl(params), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAddressChangeAdminPayload),
  });
};

export const getAddressChangeGetAddressChangeAddressUrl = () => {
  return `/api/address_change/address`;
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
  return systemKeyReadTransport<FLAddressChangeAddressResponse>(getAddressChangeGetAddressChangeAddressUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAddressChangeAddressPayload),
  });
};

export const getAddressChangePostAddressChangeAnswerUrl = () => {
  return `/api/address_change/confirmation`;
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
  return baseKeyTransport<FLAddressChangeAnswerResponse>(getAddressChangePostAddressChangeAnswerUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAddressChangeAnswerPayload),
  });
};

export const getAddressChangePostAddressChangeStopUrl = () => {
  return `/api/address_change/confirmation/stop`;
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
): Promise<void> => {
  return baseKeyTransport<void>(getAddressChangePostAddressChangeStopUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getAddressChangeGetAddressChangeViewUrl = () => {
  return `/api/address_change/confirmation/view`;
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
): Promise<FLAddressChangeViewNew | FLAddressChangeViewPrevious | FLAddressChangeViewEnded> => {
  return baseKeyReadTransport<FLAddressChangeViewNew | FLAddressChangeViewPrevious | FLAddressChangeViewEnded>(
    getAddressChangeGetAddressChangeViewUrl(),
    {
      ...options,
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
      body: JSON.stringify(fLTokenPayload),
    },
  );
};

export const getAddressChangeSweepAddressChangeUrl = () => {
  return `/api/address_change/sweep`;
};

/**
 * End the changes whose step lapsed, and make each due one take effect, or end it where its judgement now refuses it.
 *
 * Each due change is saved on its own, the lapsed ones together; a change whose saving fails is counted in `failed` and
 * stays due for the next pass.
 * @summary End the lapsed address changes, and make the due ones take effect
 */
export const addressChangeSweepAddressChange = async (
  options?: Parameters<typeof systemKeyPassTransport>[1],
): Promise<FLAddressChangeSweepResponse> => {
  return systemKeyPassTransport<FLAddressChangeSweepResponse>(getAddressChangeSweepAddressChangeUrl(), {
    ...options,
    method: "POST",
  });
};

export const getAddressChangeGetAddressChangeMovesUrl = () => {
  return `/api/address_change/sweep/moves`;
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
  return `/api/address_change/sweep/moves/done`;
};

/**
 * Take the owed carry off each named change; an id owing none is left alone.
 * @summary Take the carries done off their changes
 */
export const addressChangePostAddressChangeMovesDone = async (
  fLAddressChangeMovesDonePayload: FLAddressChangeMovesDonePayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<void> => {
  return systemKeyTransport<void>(getAddressChangePostAddressChangeMovesDoneUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAddressChangeMovesDonePayload),
  });
};

export const getAddressChangeDeleteAddressChangeUrl = (addressChangeId: string) => {
  return `/api/address_change/${encodeURIComponent(String(addressChangeId))}`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getAddressChangeDeleteAddressChangeUrl(addressChangeId), {
    ...options,
    method: "DELETE",
  });
};

export const getAddressChangeResendConfirmationUrl = (addressChangeId: string) => {
  return `/api/address_change/${encodeURIComponent(String(addressChangeId))}/confirmation/resend`;
};

/**
 * Mail the new mailbox a fresh link for the change this id names, its deadline restarting now.
 *
 * The previous link stops working once the fresh one is handed out, and only a change waiting on the new mailbox has a
 * link to re-send.
 * @summary Send a pending address a fresh link
 */
export const addressChangeResendConfirmation = async (
  addressChangeId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getAddressChangeResendConfirmationUrl(addressChangeId), {
    ...options,
    method: "POST",
  });
};

export const getAufstellungenGetAufstellungSelfUrl = (spielId: string, teamId: string) => {
  return `/api/aufstellungen/spiele/${encodeURIComponent(String(spielId))}/teams/${encodeURIComponent(String(teamId))}`;
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
  return `/api/aufstellungen/spiele/${encodeURIComponent(String(spielId))}/teams/${encodeURIComponent(String(teamId))}`;
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
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getAufstellungenPutAufstellungSelfUrl(spielId, teamId), {
    ...options,
    method: "PUT",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAufstellungPayload),
  });
};

export const getAufstellungenGetAufstellungUrl = (spielId: string, teamId: string) => {
  return `/api/aufstellungen/spiele/${encodeURIComponent(String(spielId))}/teams/${encodeURIComponent(String(teamId))}/admin`;
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
  return `/api/aufstellungen/spiele/${encodeURIComponent(String(spielId))}/teams/${encodeURIComponent(String(teamId))}/admin`;
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
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getAufstellungenPutAufstellungUrl(spielId, teamId), {
    ...options,
    method: "PUT",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAufstellungPayload),
  });
};

export const getBanListGetBanListEntriesUrl = () => {
  return `/api/ban_list`;
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

export const getBanListPostBanListEntryUrl = (params?: BanListPostBanListEntryParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/ban_list?${stringifiedParams}` : `/api/ban_list`;
};

/**
 * Ban an address: it cannot sign in, and no mail leaves for it but the ban's own notice, sent where `notify` is set.
 *
 * The ban runs a fixed number of seasons past the running one, and it and its reason outlive the person's erasure. A
 * `dry_run` is refused as the ban would be, and answers 204 and writes nothing where it would land.
 * @summary Ban an email address
 */
export const banListPostBanListEntry = async (
  fLPostBanListEntryPayload: FLPostBanListEntryPayload,
  params?: BanListPostBanListEntryParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLCreatedResponse | void> => {
  return adminKeyDryRunTransport<FLCreatedResponse | void>(getBanListPostBanListEntryUrl(params), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostBanListEntryPayload),
  });
};

export const getBanListDeleteBanListEntryUrl = (banListEntryId: string) => {
  return `/api/ban_list/${encodeURIComponent(String(banListEntryId))}`;
};

/**
 * Lift a ban before it lapses, deleting its row for good.
 * @summary Lift a ban
 */
export const banListDeleteBanListEntry = async (banListEntryId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getBanListDeleteBanListEntryUrl(banListEntryId), {
    ...options,
    method: "DELETE",
  });
};

export const getBewerbungenGetBewerbungenAdminUrl = (params: BewerbungenGetBewerbungenAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/bewerbungen?${stringifiedParams}` : `/api/bewerbungen`;
};

/**
 * The season's applications, newest first, holding nothing of a person, and what an acceptance would meet there.
 *
 * A long list is cut, but every application with a confirmed seat is served past the cut.
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

export const getBewerbungenPostBewerbungUrl = () => {
  return `/api/bewerbungen`;
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
  return baseKeyTransport<FLCreatedResponse>(getBewerbungenPostBewerbungUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostBewerbungPayload),
  });
};

export const getBewerbungenPostConfirmationUrl = () => {
  return `/api/bewerbungen/confirmation`;
};

/**
 * Record one person's consent or Widerspruch for the seat their link opens, and for a second seat they hold.
 *
 * A Widerspruch empties the seat and writes the Protokoll's row, and on an application it tells the Ansprechperson who
 * still stands, in a notice that is the deletion notice too.
 * @summary Confirm or decline one seat of a Bewerbung or of a team's season row
 */
export const bewerbungenPostConfirmation = async (
  fLBewerbungEinwilligungGivenFLBewerbungEinwilligungDeclined: FLBewerbungEinwilligungGiven | FLBewerbungEinwilligungDeclined,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<void> => {
  return baseKeyTransport<void>(getBewerbungenPostConfirmationUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLBewerbungEinwilligungGivenFLBewerbungEinwilligungDeclined),
  });
};

export const getBewerbungenGetConfirmationViewUrl = () => {
  return `/api/bewerbungen/confirmation/view`;
};

/**
 * What the confirmation page renders for the seat this token opens, and nothing of the person.
 *
 * A confirmed, declined or expired link is served in that state; only a token no seat holds is refused.
 * @summary What one confirmation link opens
 */
export const bewerbungenGetConfirmationView = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyReadTransport>[1],
): Promise<
  | FLBewerbungEinwilligungViewValid
  | FLBewerbungEinwilligungViewSaisonPast
  | FLBewerbungEinwilligungViewAnswered
  | FLBewerbungEinwilligungViewExpired
> => {
  return baseKeyReadTransport<
    | FLBewerbungEinwilligungViewValid
    | FLBewerbungEinwilligungViewSaisonPast
    | FLBewerbungEinwilligungViewAnswered
    | FLBewerbungEinwilligungViewExpired
  >(getBewerbungenGetConfirmationViewUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getBewerbungenGetFormUrl = (saisonId: string) => {
  return `/api/bewerbungen/saisons/${encodeURIComponent(String(saisonId))}/form`;
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

export const getBewerbungenSweepSaisonUrl = (saisonId: string) => {
  return `/api/bewerbungen/saisons/${encodeURIComponent(String(saisonId))}/sweep`;
};

/**
 * Run one season's application clocks as of today, each reminder and deletion notice owed in the write it belongs to.
 *
 * A row that cannot be written is passed over, counted in `failed`, and met again by the next pass, as is a clock
 * written in one go whose write fails; what each clock erased is recorded in the action log.
 * @summary Run one season's application clocks
 */
export const bewerbungenSweepSaison = async (
  saisonId: string,
  options?: Parameters<typeof systemKeyPassTransport>[1],
): Promise<FLBewerbungSweepResponse> => {
  return systemKeyPassTransport<FLBewerbungSweepResponse>(getBewerbungenSweepSaisonUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getBewerbungenGetBewerbungUrl = (bewerbungId: string) => {
  return `/api/bewerbungen/${encodeURIComponent(String(bewerbungId))}`;
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
  return `/api/bewerbungen/${encodeURIComponent(String(bewerbungId))}/accept`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getBewerbungenAcceptBewerbungUrl(bewerbungId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAcceptBewerbungPayload),
  });
};

export const getBewerbungenDeclineBewerbungUrl = (bewerbungId: string) => {
  return `/api/bewerbungen/${encodeURIComponent(String(bewerbungId))}/decline`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getBewerbungenDeclineBewerbungUrl(bewerbungId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLDeclineBewerbungPayload),
  });
};

export const getBewerbungenPatchEinwilligungUrl = (bewerbungId: string) => {
  return `/api/bewerbungen/${encodeURIComponent(String(bewerbungId))}/einwilligung`;
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
  return adminKeyTransport<void>(getBewerbungenPatchEinwilligungUrl(bewerbungId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSeatEinwilligungPayload),
  });
};

export const getBewerbungenPostKontaktSeatUrl = (bewerbungId: string, seat: string, params?: BewerbungenPostKontaktSeatParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/bewerbungen/${encodeURIComponent(String(bewerbungId))}/kontakte/${encodeURIComponent(String(seat))}?${stringifiedParams}`
    : `/api/bewerbungen/${encodeURIComponent(String(bewerbungId))}/kontakte/${encodeURIComponent(String(seat))}`;
};

/**
 * Write a person into one seat, whatever its state, and mail them a fresh link; an acceptance waits on their answer.
 *
 * Where one person holds two seats both are written, the last holder's link opens nothing afterwards, and the seat's
 * deadline starts again from today. A finished season's application takes no write, as it takes no fresh link. A
 * `dry_run` is refused as the write would be, and answers 204 and writes nothing where it would land.
 * @summary Write the person one contact seat holds and mail them a fresh link
 */
export const bewerbungenPostKontaktSeat = async (
  bewerbungId: string,
  seat: string,
  fLBewerbungKontaktSeatPayload: FLBewerbungKontaktSeatPayload,
  params?: BewerbungenPostKontaktSeatParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLBewerbungKontaktSeatResponse | void> => {
  return adminKeyDryRunTransport<FLBewerbungKontaktSeatResponse | void>(getBewerbungenPostKontaktSeatUrl(bewerbungId, seat, params), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLBewerbungKontaktSeatPayload),
  });
};

export const getBewerbungenResendKontaktConfirmationUrl = (bewerbungId: string, seat: string) => {
  return `/api/bewerbungen/${encodeURIComponent(String(bewerbungId))}/kontakte/${encodeURIComponent(String(seat))}/confirmation/resend`;
};

/**
 * Void one seat's link and mail its person a fresh one, that seat's deadline and reminder starting again from today.
 *
 * Where one person holds two seats both are replaced and one link answers both. A finished season's application takes
 * no fresh link.
 * @summary Re-send one seat's confirmation link
 */
export const bewerbungenResendKontaktConfirmation = async (
  bewerbungId: string,
  seat: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getBewerbungenResendKontaktConfirmationUrl(bewerbungId, seat), {
    ...options,
    method: "POST",
  });
};

export const getGrantsGetGrantsUrl = () => {
  return `/api/grants`;
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

export const getGrantsPostGrantUrl = (params?: GrantsPostGrantParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/grants?${stringifiedParams}` : `/api/grants`;
};

/**
 * Add an address as `administration`, holding once its wait has passed; only the owner adds one, and no request grants `owner`.
 *
 * Every holder in effect and the address named are told, with the date it holds from. A `dry_run` is refused as the
 * addition would be, and answers 204 and writes nothing where it would land.
 * @summary Add an administrator
 */
export const grantsPostGrant = async (
  fLPostGrantPayload: FLPostGrantPayload,
  params?: GrantsPostGrantParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLCreatedResponse | void> => {
  return adminKeyDryRunTransport<FLCreatedResponse | void>(getGrantsPostGrantUrl(params), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostGrantPayload),
  });
};

export const getGrantsPostHandoverPassUrl = () => {
  return `/api/grants/handover`;
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
  return `/api/grants/${encodeURIComponent(String(grantId))}`;
};

/**
 * Remove a grant for good, its address losing access on its next request, or withdraw an addition still waiting.
 *
 * Only the owner removes one, the owner's own row leaving only by a handover; every holder in effect and the address named are told.
 * @summary Remove an administrator, or withdraw a waiting addition
 */
export const grantsDeleteGrant = async (
  grantId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLGrantRemovedResponse> => {
  return adminKeyTransport<FLGrantRemovedResponse>(getGrantsDeleteGrantUrl(grantId), {
    ...options,
    method: "DELETE",
  });
};

export const getGrantsDeleteHandoverUrl = (grantId: string) => {
  return `/api/grants/${encodeURIComponent(String(grantId))}/handover`;
};

/**
 * Stop a waiting handover, the role staying with the owner; only the owner stops one, and every holder in effect is told.
 * @summary Stop a waiting handover
 */
export const grantsDeleteHandover = async (grantId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getGrantsDeleteHandoverUrl(grantId), {
    ...options,
    method: "DELETE",
  });
};

export const getGrantsPostHandoverUrl = (grantId: string, params?: GrantsPostHandoverParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/grants/${encodeURIComponent(String(grantId))}/handover?${stringifiedParams}`
    : `/api/grants/${encodeURIComponent(String(grantId))}/handover`;
};

/**
 * Start handing the owner role to an administrator in effect, completing once its wait has passed; the owner stays the owner until then.
 *
 * Only the owner starts one, and every holder in effect is told the date it completes on. A `dry_run` is refused as
 * the handover would be, and writes nothing.
 * @summary Hand the owner role over to an administrator
 */
export const grantsPostHandover = async (
  grantId: string,
  params?: GrantsPostHandoverParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<void> => {
  return adminKeyDryRunTransport<void>(getGrantsPostHandoverUrl(grantId, params), {
    ...options,
    method: "POST",
  });
};

export const getIdentityPostErasureUrl = () => {
  return `/api/identity/erasure`;
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
  return adminKeyTransport<void>(getIdentityPostErasureUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLErasurePayload),
  });
};

export const getIdentitySweepErasureUrl = () => {
  return `/api/identity/erasure/sweep`;
};

/**
 * Delete the pupils whose last squad season is over by a whole season, one at a time, and answer what went.
 *
 * A pupil whose erasure fails is counted in `failed` and stays due, and those the call's deadline leaves are the next pass's.
 * @summary Delete the pupils the season-after rule makes due
 */
export const identitySweepErasure = async (options?: Parameters<typeof systemKeyPassTransport>[1]): Promise<FLErasureSweepResponse> => {
  return systemKeyPassTransport<FLErasureSweepResponse>(getIdentitySweepErasureUrl(), {
    ...options,
    method: "POST",
  });
};

export const getIdentityGetErasureViewUrl = () => {
  return `/api/identity/erasure/view`;
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
  return adminKeyReadTransport<FLErasureViewResponse>(getIdentityGetErasureViewUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLErasureAddressPayload),
  });
};

export const getIdentityGetReferencesUrl = () => {
  return `/api/identity/references`;
};

/**
 * Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in.
 * @summary Say which of these sign-in addresses no record references
 */
export const identityGetReferences = async (
  fLReferencesPayload: FLReferencesPayload,
  options?: Parameters<typeof systemKeyReadTransport>[1],
): Promise<FLReferencesResponse> => {
  return systemKeyReadTransport<FLReferencesResponse>(getIdentityGetReferencesUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLReferencesPayload),
  });
};

export const getIdentityPostAccountErasureUrl = () => {
  return `/api/identity/self/erasure`;
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
  return `/api/identity/self/erasure/view`;
};

/**
 * What `POST /identity/self/erasure` would remove or empty for the signed-in address, by kind and by name, and nothing else.
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

export const getIdentityGetSignInUrl = () => {
  return `/api/identity/sign_in`;
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
  return systemKeyReadTransport<FLSignInResponse>(getIdentityGetSignInUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSubjectPayload),
  });
};

export const getIdentityGetSubjectUrl = () => {
  return `/api/identity/subject`;
};

/**
 * Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its grant.
 *
 * The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with empty lists and no pupil
 * rather than a 404.
 * @summary Say which league records one mailbox holds
 */
export const identityGetSubject = async (
  fLSubjectPayload: FLSubjectPayload,
  options?: Parameters<typeof systemKeyReadTransport>[1],
): Promise<FLSubjectResponse> => {
  return systemKeyReadTransport<FLSubjectResponse>(getIdentityGetSubjectUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSubjectPayload),
  });
};

export const getIdentityPostWithdrawalUrl = (params?: IdentityPostWithdrawalParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/identity/withdrawal?${stringifiedParams}` : `/api/identity/withdrawal`;
};

/**
 * Withhold each named choice on every record the address holds that grants it, answering per kind what it ended.
 *
 * A choice already withheld is left out of the answer and written nothing, nothing is ever granted, and a `dry_run`
 * writes nothing and answers the same report.
 * @summary Enter a withdrawal of the consents an address holds, on that person's request by mail
 */
export const identityPostWithdrawal = async (
  fLEinwilligungWithdrawalPayload: FLEinwilligungWithdrawalPayload,
  params?: IdentityPostWithdrawalParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLEinwilligungWithdrawalReport> => {
  return adminKeyDryRunTransport<FLEinwilligungWithdrawalReport>(getIdentityPostWithdrawalUrl(params), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLEinwilligungWithdrawalPayload),
  });
};

export const getOutboxPostEventUrl = () => {
  return `/api/outbox/event`;
};

/**
 * Record what the mail provider reported about one message on its mail's row, where the row's state may follow into it.
 *
 * A redelivered or out-of-order event changes nothing.
 * @summary Record one delivery event on its mail's row
 */
export const outboxPostEvent = async (
  fLOutboxEventPayload: FLOutboxEventPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLOutboxEventResponse> => {
  return systemKeyTransport<FLOutboxEventResponse>(getOutboxPostEventUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLOutboxEventPayload),
  });
};

export const getOutboxPostHandoutUrl = () => {
  return `/api/outbox/handout`;
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
  return `/api/outbox/result`;
};

/**
 * Settle the named mail by its send's outcome where the named claim still holds it, counting a mail it does not hold in `ignored`.
 *
 * `held` reports a deployment that sends no mail, `abandon` a refusal every send would meet (any 4xx but a 429), and
 * `retry` a 429, a 5xx or a send that never reached the provider, which hands the mail back unless it is a sign-in
 * code, a deletion link or past its deadline.
 * @summary Settle one mail a claim handed out
 */
export const outboxPostResult = async (
  fLOutboxResultPayload: FLOutboxResultPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLOutboxResultResponse> => {
  return systemKeyTransport<FLOutboxResultResponse>(getOutboxPostResultUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLOutboxResultPayload),
  });
};

export const getOutboxPostSignInUrl = () => {
  return `/api/outbox/sign_in`;
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
  return systemKeyTransport<void>(getOutboxPostSignInUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLOutboxSignInPayload),
  });
};

export const getRegistrierungenPostRegistrierungUrl = () => {
  return `/api/registrierungen`;
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
): Promise<FLCreatedResponse> => {
  return baseKeyTransport<FLCreatedResponse>(getRegistrierungenPostRegistrierungUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostRegistrierungPayload),
  });
};

export const getRegistrierungenPostConfirmationUrl = () => {
  return `/api/registrierungen/confirmation`;
};

/**
 * Record a pupil's own answer for the registration their link opens, which stays pending until the team decides.
 * @summary Confirm one registration and record the pupil's consent
 */
export const registrierungenPostConfirmation = async (
  fLRegistrierungConfirmationPayload: FLRegistrierungConfirmationPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<void> => {
  return baseKeyTransport<void>(getRegistrierungenPostConfirmationUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLRegistrierungConfirmationPayload),
  });
};

export const getRegistrierungenGetConfirmationViewUrl = () => {
  return `/api/registrierungen/confirmation/view`;
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
): Promise<FLRegistrierungConfirmationViewValid | FLRegistrierungConfirmationViewConfirmed | FLRegistrierungConfirmationViewExpired> => {
  return baseKeyReadTransport<
    FLRegistrierungConfirmationViewValid | FLRegistrierungConfirmationViewConfirmed | FLRegistrierungConfirmationViewExpired
  >(getRegistrierungenGetConfirmationViewUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getRegistrierungenPostInvitationViewUrl = () => {
  return `/api/registrierungen/invitation/view`;
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
  return baseKeyReadTransport<FLInvitationViewResponse>(getRegistrierungenPostInvitationViewUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getRegistrierungenSweepRegistrierungenUrl = (saisonId: string) => {
  return `/api/registrierungen/saisons/${encodeURIComponent(String(saisonId))}/sweep`;
};

/**
 * Erase one season's due registrations, as of today in Europe/Berlin.
 *
 * A declined one goes once its wait after the decision has run out, an unconfirmed one past its deadline, and every one
 * still undecided once the season is `past`. A clock whose erasure fails is counted once in `failed` and met again next
 * pass; what each clock erased is recorded in the action log.
 * @summary Run one season's registration retention clocks
 */
export const registrierungenSweepRegistrierungen = async (
  saisonId: string,
  options?: Parameters<typeof systemKeyPassTransport>[1],
): Promise<FLRegistrierungSweepResponse> => {
  return systemKeyPassTransport<FLRegistrierungSweepResponse>(getRegistrierungenSweepRegistrierungenUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getRegistrierungenGetOpenRegistrierungenUrl = (teamId: string, saisonId: string) => {
  return `/api/registrierungen/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}`;
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

export const getRegistrierungenAdmitUrl = (registrierungId: string) => {
  return `/api/registrierungen/${encodeURIComponent(String(registrierungId))}/admit`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getRegistrierungenAdmitUrl(registrierungId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLRegistrierungAdmitPayload),
  });
};

export const getRegistrierungenDeclineUrl = (registrierungId: string) => {
  return `/api/registrierungen/${encodeURIComponent(String(registrierungId))}/decline`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getRegistrierungenDeclineUrl(registrierungId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLRegistrierungDeclinePayload),
  });
};

export const getRegistrierungenPatchEinwilligungUrl = (registrierungId: string) => {
  return `/api/registrierungen/${encodeURIComponent(String(registrierungId))}/einwilligung`;
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
  return adminKeyTransport<void>(getRegistrierungenPatchEinwilligungUrl(registrierungId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAccountEinwilligungPayload),
  });
};

export const getSaisonsGetSaisonsAdminUrl = () => {
  return `/api/saisons`;
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

export const getSaisonsPostSaisonUrl = () => {
  return `/api/saisons`;
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
  return adminKeyTransport<FLPostSaisonResponse>(getSaisonsPostSaisonUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostSaisonPayload),
  });
};

export const getSaisonsGetFrameUrl = () => {
  return `/api/saisons/frame`;
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
  return `/api/saisons/landing`;
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

export const getSaisonsGetSweepSaisonsUrl = (params?: SaisonsGetSweepSaisonsParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/saisons/sweep?${stringifiedParams}` : `/api/saisons/sweep`;
};

/**
 * Every season's id, or every one of `status` where one is given, oldest first, for the caller to sweep one at a time.
 * @summary List the seasons an hourly pass visits
 */
export const saisonsGetSweepSaisons = async (
  params?: SaisonsGetSweepSaisonsParams,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSweepSaisonsResponse> => {
  return systemKeyTransport<FLSweepSaisonsResponse>(getSaisonsGetSweepSaisonsUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSaisonAdminUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}`;
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

export const getSaisonsPatchSaisonUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}`;
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
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getSaisonsPatchSaisonUrl(saisonId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchSaisonPayload),
  });
};

export const getSaisonsActivateSaisonUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/activate`;
};

/**
 * Make this the active season, moving whichever holds `active` to `past`.
 *
 * The outgoing season must be finished, and every matchday of the target dated.
 * @summary Make this the active Saison
 */
export const saisonsActivateSaison = async (saisonId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getSaisonsActivateSaisonUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSaisonsSwapGruppenUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/gruppen/swap`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getSaisonsSwapGruppenUrl(saisonId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSwapGruppenPayload),
  });
};

export const getSaisonsPostInvitationsMailUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/invitations/mail`;
};

/**
 * Give every admitted team of this season a fresh registration link, revoking any it held, mailed to its confirmed seats.
 *
 * A team that has left the season, holds no confirmed seat or was already sent its live link is skipped and left as it
 * was, so pressing twice mails nobody twice.
 * @summary Mint every admitted team a link
 */
export const saisonsPostInvitationsMail = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLInvitationsMailResponse> => {
  return adminKeyTransport<FLInvitationsMailResponse>(getSaisonsPostInvitationsMailUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSaisonsGetKoRundeUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/ko_runde`;
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
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/overview`;
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
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/spiele/${encodeURIComponent(String(spielId))}`;
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
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/spielplan`;
};

/**
 * Return the season to undrawn: its matchdays and fixtures, their confirmations, reports and line-ups, and the draw's day.
 *
 * Undoing the draw reopens the shape rules to an edit and the groups to an entry.
 * @summary Undraw this Saison's Spielplan
 */
export const saisonsDeleteSpielplan = async (saisonId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<void> => {
  return adminKeyTransport<void>(getSaisonsDeleteSpielplanUrl(saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getSaisonsGetSpielplanUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/spielplan`;
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
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/spielplan`;
};

/**
 * Draw the whole season at once, every matchday and every fixture undated, from the season's rules.
 *
 * `replace` first deletes what a planned season holds, its fixtures' confirmations, reports and line-ups with it;
 * nothing writes the removed rows back.
 * @summary Draw this Saison's Spielplan
 */
export const saisonsPostSpielplan = async (
  saisonId: string,
  fLGenerateSpielplanPayload?: FLGenerateSpielplanPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSaisonsPostSpielplanUrl(saisonId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLGenerateSpielplanPayload),
  });
};

export const getSaisonsSweepSaisonRetentionUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/sweep`;
};

/**
 * Clear one season's contact blocks once a later season has ended, and each seat past its own day unconfirmed before.
 *
 * Once a later season has ended, the season's fixture answers and match reports keep the league's record alone. A row
 * that cannot be written is passed over, counted in `failed`, and met again by the next pass, as is a clock written in
 * one go whose write fails; what each clock cleared is recorded in the action log.
 * @summary Run one season's retention clocks over its season rows, fixture answers and match reports
 */
export const saisonsSweepSaisonRetention = async (
  saisonId: string,
  options?: Parameters<typeof systemKeyPassTransport>[1],
): Promise<FLSaisonRetentionResponse> => {
  return systemKeyPassTransport<FLSaisonRetentionResponse>(getSaisonsSweepSaisonRetentionUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSaisonsGetTabelleUrl = (saisonId: string) => {
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/tabelle`;
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
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/teams`;
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
  return `/api/saisons/${encodeURIComponent(String(saisonId))}/teams/${encodeURIComponent(String(teamId))}`;
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

export const getSchiedsrichterGetSchiedsrichterUrl = () => {
  return `/api/schiedsrichter`;
};

/**
 * Every referee in name order, retired ones included, each with where their entry stands today.
 *
 * The list is the one way into a retired referee's page, and a played match still names them.
 * @summary List Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichter = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterListResponse> => {
  return adminKeyTransport<FLSchiedsrichterListResponse>(getSchiedsrichterGetSchiedsrichterUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSchiedsrichterPostSchiedsrichterUrl = (params?: SchiedsrichterPostSchiedsrichterParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/schiedsrichter?${stringifiedParams}` : `/api/schiedsrichter`;
};

/**
 * Create a referee and owe them their confirmation link, answering the address it goes to.
 *
 * Entering a referee is the invitation, with no second press deciding whether they are asked, since a referee nobody
 * asked is a name nobody consented to publish. A `dry_run` is refused as the create would be, and answers 204 and
 * writes nothing where it would land.
 * @summary Create a Schiedsrichter
 */
export const schiedsrichterPostSchiedsrichter = async (
  fLPostSchiedsrichterPayload: FLPostSchiedsrichterPayload,
  params?: SchiedsrichterPostSchiedsrichterParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLPostSchiedsrichterResponse | void> => {
  return adminKeyDryRunTransport<FLPostSchiedsrichterResponse | void>(getSchiedsrichterPostSchiedsrichterUrl(params), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostSchiedsrichterPayload),
  });
};

export const getSchiedsrichterPostConfirmationUrl = () => {
  return `/api/schiedsrichter/confirmation`;
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
): Promise<void> => {
  return baseKeyTransport<void>(getSchiedsrichterPostConfirmationUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSchiedsrichterConfirmationPayload),
  });
};

export const getSchiedsrichterPostDeclineUrl = () => {
  return `/api/schiedsrichter/confirmation/decline`;
};

/**
 * Erase the entry the referee's link opens, on their objection, as a contact seat's objection empties the seat.
 *
 * The entry goes as the hourly pass erases one: its coming bookings removed, a played fixture's kept naming nobody.
 * @summary Decline one Schiedsrichter's entry
 */
export const schiedsrichterPostDecline = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<void> => {
  return baseKeyTransport<void>(getSchiedsrichterPostDeclineUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getSchiedsrichterGetConfirmationViewUrl = () => {
  return `/api/schiedsrichter/confirmation/view`;
};

/**
 * What this token opens: the link's state, a standing link's deadline and age bounds, and a confirmed one's day.
 *
 * A confirmed or an expired link is served in that state rather than refused, so a reopened link shows what became of it;
 * an objection erased the entry, so its link opens nothing.
 * @summary What one Schiedsrichter confirmation link opens
 */
export const schiedsrichterGetConfirmationView = async (
  fLTokenPayload: FLTokenPayload,
  options?: Parameters<typeof baseKeyReadTransport>[1],
): Promise<FLSchiedsrichterConfirmationViewValid | FLSchiedsrichterConfirmationViewConfirmed | FLSchiedsrichterConfirmationViewExpired> => {
  return baseKeyReadTransport<
    FLSchiedsrichterConfirmationViewValid | FLSchiedsrichterConfirmationViewConfirmed | FLSchiedsrichterConfirmationViewExpired
  >(getSchiedsrichterGetConfirmationViewUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLTokenPayload),
  });
};

export const getSchiedsrichterGetSelfSaisonsUrl = () => {
  return `/api/schiedsrichter/self/saisons`;
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
  return `/api/schiedsrichter/self/saisons/${encodeURIComponent(String(saisonId))}/spiele`;
};

/**
 * Every fixture of this season booked to the signed-in address's live, confirmed referee records, in the order the draw numbered them.
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
  return `/api/schiedsrichter/sweep`;
};

/**
 * Erase every referee entry nobody confirmed once the midnight after its link's last day has passed.
 *
 * Each goes as a person's own erasure takes a referee entry, one at a time, and one whose erasure fails is counted in
 * `failed` and stays due for the next pass, as do those the call's deadline leaves.
 * @summary Erase the referee entries whose link lapsed unanswered
 */
export const schiedsrichterSweepSchiedsrichter = async (
  options?: Parameters<typeof systemKeyPassTransport>[1],
): Promise<FLSchiedsrichterSweepResponse> => {
  return systemKeyPassTransport<FLSchiedsrichterSweepResponse>(getSchiedsrichterSweepSchiedsrichterUrl(), {
    ...options,
    method: "POST",
  });
};

export const getSchiedsrichterDeleteSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}`;
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
  return `/api/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}`;
};

/**
 * One referee, a retired one included, with where their entry stands today and what became of their last confirmation mail.
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

export const getSchiedsrichterPatchSchiedsrichterUrl = (schiedsrichterId: string, params?: SchiedsrichterPatchSchiedsrichterParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}?${stringifiedParams}`
    : `/api/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}`;
};

/**
 * Update a referee on the `version` the editor was served, answering the version stored.
 *
 * A corrected address on an unconfirmed referee retires their link and owes a fresh one, named in `confirmation`, and a
 * confirmed referee's address moves only through an address change. A `dry_run` is refused as the update would be, and
 * answers 204 and writes nothing where it would land.
 * @summary Update a Schiedsrichter
 */
export const schiedsrichterPatchSchiedsrichter = async (
  schiedsrichterId: string,
  fLPatchSchiedsrichterPayload: FLPatchSchiedsrichterPayload,
  params?: SchiedsrichterPatchSchiedsrichterParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLPatchSchiedsrichterResponse | void> => {
  return adminKeyDryRunTransport<FLPatchSchiedsrichterResponse | void>(getSchiedsrichterPatchSchiedsrichterUrl(schiedsrichterId, params), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchSchiedsrichterPayload),
  });
};

export const getSchiedsrichterResendConfirmationUrl = (schiedsrichterId: string) => {
  return `/api/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}/confirmation/resend`;
};

/**
 * Owe this referee a fresh confirmation link, which the Postausgang mints and mails, to the address they hold.
 *
 * The previous link stops working at once and the deadline restarts from today; a referee who has already answered is
 * refused, since the new link could never be spent.
 * @summary Send a Schiedsrichter a fresh confirmation link
 */
export const schiedsrichterResendConfirmation = async (
  schiedsrichterId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSchiedsrichterResendConfirmationUrl(schiedsrichterId), {
    ...options,
    method: "POST",
  });
};

export const getSchiedsrichterPatchEinwilligungUrl = (schiedsrichterId: string) => {
  return `/api/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}/einwilligung`;
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
  return adminKeyTransport<void>(getSchiedsrichterPatchEinwilligungUrl(schiedsrichterId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSchiedsrichterAccountEinwilligungPayload),
  });
};

export const getSchiedsrichterReactivateSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/schiedsrichter/${encodeURIComponent(String(schiedsrichterId))}/reactivate`;
};

/**
 * Bring a retired referee back into the picker and every default read, answering where a fresh link goes.
 *
 * One who has not answered is owed a fresh link, named in `confirmation`, since a retired referee's save mails nothing;
 * one who has answered, holds no address a link can go to, or is back already, is owed none.
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
  return `/api/spielberichte/spiele/${encodeURIComponent(String(spielId))}`;
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
  return `/api/spielberichte/spiele/${encodeURIComponent(String(spielId))}`;
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
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getSpielberichtePutSpielberichtBerichtUrl(spielId), {
    ...options,
    method: "PUT",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSpielberichtPayload),
  });
};

export const getSpielbestaetigungenSweepSpielbestaetigungenUrl = (saisonId: string) => {
  return `/api/spielbestaetigungen/saisons/${encodeURIComponent(String(saisonId))}/sweep`;
};

/**
 * Close, mint and remind one season's fixture confirmations as of today, owing each mail with its row, and answer what it did, counted.
 *
 * Each step saves one row or fixture at a time, one that fails passed over and counted in `failed`, and those the call's
 * deadline leaves stay due for the next pass. A season that is not `active` is passed by whole.
 * @summary Run one season's fixture confirmation pass
 */
export const spielbestaetigungenSweepSpielbestaetigungen = async (
  saisonId: string,
  options?: Parameters<typeof systemKeyPassTransport>[1],
): Promise<FLSpielbestaetigungSweepResponse> => {
  return systemKeyPassTransport<FLSpielbestaetigungSweepResponse>(getSpielbestaetigungenSweepSpielbestaetigungenUrl(saisonId), {
    ...options,
    method: "POST",
  });
};

export const getSpielbestaetigungenAdoptSpielbestaetigungUrl = (spielbestaetigungId: string) => {
  return `/api/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/adopt`;
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
  return `/api/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/answer`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getSpielbestaetigungenPostSchiedsrichterAnswerUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSpielbestaetigungSchiedsrichterAnswerPayload),
  });
};

export const getSpielbestaetigungenPostTeamAnswerUrl = (spielbestaetigungId: string) => {
  return `/api/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/answer/team`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getSpielbestaetigungenPostTeamAnswerUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSpielbestaetigungTeamAnswerPayload),
  });
};

export const getSpielbestaetigungenDiscardSpielbestaetigungUrl = (spielbestaetigungId: string) => {
  return `/api/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/discard`;
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
  return `/api/spielbestaetigungen/${encodeURIComponent(String(spielbestaetigungId))}/enter`;
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
  return adminKeyTransport<void>(getSpielbestaetigungenEnterSpielbestaetigungUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSpielbestaetigungEnterPayload),
  });
};

export const getSpieleGetSpieleSpielplanUrl = (params: SpieleGetSpieleSpielplanParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/spiele?${stringifiedParams}` : `/api/spiele`;
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

export const getSpieleGetSpielAdminUrl = (spielId: string) => {
  return `/api/spiele/${encodeURIComponent(String(spielId))}`;
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

export const getSpielePatchSpielUrl = (spielId: string, params?: SpielePatchSpielParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/spiele/${encodeURIComponent(String(spielId))}?${stringifiedParams}`
    : `/api/spiele/${encodeURIComponent(String(spielId))}`;
};

/**
 * Save one Spiel wholesale and resolve the season's bracket, answering every fixture the save moved beyond it.
 *
 * A save storing what stands, where the bracket's resolution would move nothing either, writes no fixture and raises
 * no `version`: with `adopts_bericht` it stamps the Spielbericht alone, and it is refused where that stamp matches
 * nothing. A `dry_run` writes nothing and answers the same report, with the parties the confirmation pass would mail and the
 * later results the save would delete, which the save's `voided_ergebnisse` must name back.
 * @summary Update a Spiel
 */
export const spielePatchSpiel = async (
  spielId: string,
  fLPatchSpielDataPayload: FLPatchSpielDataPayload,
  params?: SpielePatchSpielParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLPatchSpielDataResponse> => {
  return adminKeyDryRunTransport<FLPatchSpielDataResponse>(getSpielePatchSpielUrl(spielId, params), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchSpielDataPayload),
  });
};

export const getSpielerGetSpielerAdminUrl = (params: SpielerGetSpielerAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/spieler?${stringifiedParams}` : `/api/spieler`;
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

export const getSpielerPatchEinwilligungUrl = () => {
  return `/api/spieler/self/einwilligung`;
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
  return adminKeyTransport<void>(getSpielerPatchEinwilligungUrl(), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAccountEinwilligungPayload),
  });
};

export const getSpielerGetSelfSaisonsUrl = () => {
  return `/api/spieler/self/saisons`;
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
  return `/api/spieler/self/saisons/${encodeURIComponent(String(saisonId))}`;
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

export const getSpielerGetKaderUrl = (teamId: string, saisonId: string) => {
  return `/api/spieler/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}`;
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

export const getSpielerDeleteSaisonSpielerUrl = (spielerId: string, saisonId: string) => {
  return `/api/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Take a player out of a season's squad, the row staying, marked by `inactive_since`.
 *
 * The row records that this player wore this number in this squad, which stays true after they leave. A finished
 * season's squad is its record and is refused.
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
  return `/api/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}`;
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
  return `/api/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}`;
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
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getSpielerPatchSpielerSaisonUrl(spielerId, saisonId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchSpielerSaisonPayload),
  });
};

export const getSpielerReactivateSaisonSpielerUrl = (spielerId: string, saisonId: string) => {
  return `/api/spieler/${encodeURIComponent(String(spielerId))}/saisons/${encodeURIComponent(String(saisonId))}/reactivate`;
};

/**
 * Clear a squad row's `inactive_since`, the row returning with the number, position and role it had.
 *
 * A finished season's squad is its record and is refused.
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

export const getSpielerDeleteKaderRowUrl = (spielerId: string, teamId: string, saisonId: string) => {
  return `/api/spieler/${encodeURIComponent(String(spielerId))}/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Take a player out of this team's squad for the season, as any contact seat of the team may, the row staying.
 *
 * The person stays in the league, and only an administrator brings the row back.
 * @summary Take a Spieler out of the squad as its team's seat holder (retire)
 */
export const spielerDeleteKaderRow = async (
  spielerId: string,
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSpielerDeleteKaderRowUrl(spielerId, teamId, saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielerPatchKaderRowUrl = (spielerId: string, teamId: string, saisonId: string) => {
  return `/api/spieler/${encodeURIComponent(String(spielerId))}/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}`;
};

/**
 * Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.
 *
 * The team and the Nachnominierung flag stay the stored row's, and a shared `nummer` is permitted.
 * @summary Update a squad entry as its team's seat holder
 */
export const spielerPatchKaderRow = async (
  spielerId: string,
  teamId: string,
  saisonId: string,
  fLPatchKaderRowPayload: FLPatchKaderRowPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getSpielerPatchKaderRowUrl(spielerId, teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchKaderRowPayload),
  });
};

export const getSpielorteGetSpielorteUrl = () => {
  return `/api/spielorte`;
};

/**
 * Every venue in name order, the retired ones included, each with its `inactive_since`.
 * @summary List Spielorte
 */
export const spielorteGetSpielorte = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLSpielorteListResponse> => {
  return adminKeyTransport<FLSpielorteListResponse>(getSpielorteGetSpielorteUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielortePostSpielortUrl = () => {
  return `/api/spielorte`;
};

/**
 * Create a venue, its `maps_query` derived from the name and the address.
 *
 * A name another venue holds, a retired one included, is refused.
 * @summary Create a Spielort
 */
export const spielortePostSpielort = async (
  fLPostSpielortPayload: FLPostSpielortPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLCreatedResponse> => {
  return adminKeyTransport<FLCreatedResponse>(getSpielortePostSpielortUrl(), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostSpielortPayload),
  });
};

export const getSpielorteDeleteSpielortUrl = (spielortId: string) => {
  return `/api/spielorte/${encodeURIComponent(String(spielortId))}`;
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
  return `/api/spielorte/${encodeURIComponent(String(spielortId))}`;
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
  return `/api/spielorte/${encodeURIComponent(String(spielortId))}`;
};

/**
 * Save a venue on the `version` it was read at, answering the version stored.
 *
 * Every fixture at the venue shows its new name and `maps_query`, and keeps the `mietpreis` agreed for it.
 * @summary Update a Spielort
 */
export const spielortePatchSpielort = async (
  spielortId: string,
  fLPatchSpielortPayload: FLPatchSpielortPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getSpielortePatchSpielortUrl(spielortId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchSpielortPayload),
  });
};

export const getSpielorteReactivateSpielortUrl = (spielortId: string) => {
  return `/api/spielorte/${encodeURIComponent(String(spielortId))}/reactivate`;
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

export const getSpieltageGetSpieltagAdminUrl = (spieltagId: string) => {
  return `/api/spieltage/${encodeURIComponent(String(spieltagId))}`;
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

export const getSpieltagePatchSpieltagUrl = (spieltagId: string) => {
  return `/api/spieltage/${encodeURIComponent(String(spieltagId))}`;
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
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getSpieltagePatchSpieltagUrl(spieltagId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchSpieltagPayload),
  });
};

export const getTeamsGetTeamsAdminUrl = (params: TeamsGetTeamsAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/teams?${stringifiedParams}` : `/api/teams`;
};

/**
 * One season's clubs, a `future` season's included, each with its state, and what entering another offers.
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
  return `/api/teams/saisons/${encodeURIComponent(String(saisonId))}/entry`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getTeamsPostTeamEntryUrl(saisonId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPostTeamEntryPayload),
  });
};

export const getTeamsDeleteTeamUrl = (teamId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}`;
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

export const getTeamsReactivateTeamUrl = (teamId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/reactivate`;
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

export const getTeamsGetTeamSaisonAdminUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}`;
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
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}`;
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
): Promise<FLVersionResponse> => {
  return adminKeyTransport<FLVersionResponse>(getTeamsPatchTeamSaisonUrl(teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLPatchTeamSaisonPayload),
  });
};

export const getTeamsPutAustrittUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/austritt`;
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
  return adminKeyTransport<void>(getTeamsPutAustrittUrl(teamId, saisonId), {
    ...options,
    method: "PUT",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLAustrittPayload),
  });
};

export const getTeamsPatchEinwilligungUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/einwilligung`;
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
  return adminKeyTransport<void>(getTeamsPatchEinwilligungUrl(teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLSeatEinwilligungPayload),
  });
};

export const getTeamsDeleteInvitationUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/invitation`;
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
): Promise<void> => {
  return adminKeyTransport<void>(getTeamsDeleteInvitationUrl(teamId, saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getTeamsPostInvitationUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/invitation`;
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

export const getTeamsPostInvitationMailUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/invitation/mail`;
};

/**
 * Owe this team's live registration link to every seat whose own person has confirmed it, one mail each, `mailed` counting them.
 *
 * Each mail mints a link of its own at its hand-out, so a copied link stays valid beside them, and a second press on
 * one day owes nothing again.
 * @summary Mail this team's live registration link to its confirmed contact seats
 */
export const teamsPostInvitationMail = async (
  teamId: string,
  saisonId: string,
  fLInvitationMailPayload: FLInvitationMailPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLInvitationMailResponse> => {
  return adminKeyTransport<FLInvitationMailResponse>(getTeamsPostInvitationMailUrl(teamId, saisonId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLInvitationMailPayload),
  });
};

export const getTeamsPutKontaktSeatUrl = (teamId: string, saisonId: string, seat: string, params?: TeamsPutKontaktSeatParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/kontakte/${encodeURIComponent(String(seat))}?${stringifiedParams}`
    : `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/kontakte/${encodeURIComponent(String(seat))}`;
};

/**
 * Write the person one seat holds on the row's `version`, a newly seated person owed a fresh link whose address `email` names.
 *
 * The same person, address and name folded, keeps the seat's record and link, and where the Trainer holds a second seat
 * a write on either seat writes both under one link. A `dry_run` is refused as the write would be, and answers 204 and
 * writes nothing where it would land.
 * @summary Write the person one contact seat holds
 */
export const teamsPutKontaktSeat = async (
  teamId: string,
  saisonId: string,
  seat: string,
  fLKontaktSeatPayload: FLKontaktSeatPayload,
  params?: TeamsPutKontaktSeatParams,
  options?: Parameters<typeof adminKeyDryRunTransport>[1],
): Promise<FLKontaktSeatResponse | void> => {
  return adminKeyDryRunTransport<FLKontaktSeatResponse | void>(getTeamsPutKontaktSeatUrl(teamId, saisonId, seat, params), {
    ...options,
    method: "PUT",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLKontaktSeatPayload),
  });
};

export const getTeamsResendKontaktConfirmationUrl = (teamId: string, saisonId: string, seat: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/kontakte/${encodeURIComponent(String(seat))}/confirmation/resend`;
};

/**
 * Owe one contact seat a fresh confirmation link, and its pair where the Trainer holds both and has not confirmed it.
 *
 * The previous link opens nothing from this write on, and the deadline restarts from today.
 * @summary Send one contact seat a fresh confirmation link
 */
export const teamsResendKontaktConfirmation = async (
  teamId: string,
  saisonId: string,
  seat: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getTeamsResendKontaktConfirmationUrl(teamId, saisonId, seat), {
    ...options,
    method: "POST",
  });
};

export const getTeamsGetTeamOverviewUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/overview`;
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

export const getTeamsReplaceSaisonTeamUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/replace`;
};

/**
 * Hand this season's row, and every fixture on it, to another club, keeping the schedule.
 *
 * The row's colour, contacts and their links are cleared, and the outgoing club's live squad rows retired.
 * @summary Replace a club in a season, keeping its schedule
 */
export const teamsReplaceSaisonTeam = async (
  teamId: string,
  saisonId: string,
  fLReplaceSaisonTeamPayload: FLReplaceSaisonTeamPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<void> => {
  return adminKeyTransport<void>(getTeamsReplaceSaisonTeamUrl(teamId, saisonId), {
    ...options,
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json" }, options?.headers),
    body: JSON.stringify(fLReplaceSaisonTeamPayload),
  });
};

export const getTeamsGetTeamSpieleUrl = (teamId: string, saisonId: string) => {
  return `/api/teams/${encodeURIComponent(String(teamId))}/saisons/${encodeURIComponent(String(saisonId))}/spiele`;
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
