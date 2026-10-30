import "server-only";

import { adminKeyTransport, baseKeyTransport, serializeQuery, systemKeyTransport, unkeyedTransport } from "@/core/transport";

import type {
  AdresswechselSweepAdresswechselParams,
  AktionenGetAktionenParams,
  BewerbungenGetBewerbungenParams,
  CheckIsLiveResponse,
  FLAblehnenBewerbungPayload,
  FLAblehnenBewerbungResponse,
  FLAbmeldungResponse,
  FLActivateSaisonResponse,
  FLAdresswechselAdressePayload,
  FLAdresswechselAdresseResponse,
  FLAdresswechselAnsichtPayload,
  FLAdresswechselAnsichtResponse,
  FLAdresswechselAntwortPayload,
  FLAdresswechselAntwortResponse,
  FLAdresswechselGenehmigungResponse,
  FLAdresswechselIdResponse,
  FLAdresswechselPostausgangResponse,
  FLAdresswechselStoppPayload,
  FLAdresswechselStoppResponse,
  FLAdresswechselSweepResponse,
  FLAdresswechselVerwaltungAnsichtPayload,
  FLAdresswechselVerwaltungAnsichtResponse,
  FLAdresswechselVerwaltungMintResponse,
  FLAdresswechselVerwaltungPayload,
  FLAdresswechselZugestelltPayload,
  FLAdresswechselZugestelltResponse,
  FLAktionenListResponse,
  FLAktionSingleResponse,
  FLAnmeldungResponse,
  FLAnnehmenBewerbungPayload,
  FLAnnehmenBewerbungResponse,
  FLBerechtigungAbgleichResponse,
  FLBerechtigungAngekuendigtPayload,
  FLBerechtigungAngekuendigtResponse,
  FLBerechtigungAntragAbgelehntResponse,
  FLBerechtigungAntragGenehmigtResponse,
  FLBerechtigungenListResponse,
  FLBerechtigungStufeResponse,
  FLBerechtigungWriteResponse,
  FLBewerbungEinwilligungAnsichtPayload,
  FLBewerbungEinwilligungAnsichtResponse,
  FLBewerbungEinwilligungAntwortPayload,
  FLBewerbungEinwilligungAntwortResponse,
  FLBewerbungEinwilligungErneutResponse,
  FLBewerbungenListResponse,
  FLBewerbungFensterResponse,
  FLBewerbungKeinFensterResponse,
  FLBewerbungKontaktEmailPayload,
  FLBewerbungKontaktEmailResponse,
  FLBewerbungKontaktSitzPayload,
  FLBewerbungKontaktSitzResponse,
  FLBewerbungKuerzelResponse,
  FLBewerbungPersonEinwilligungPayload,
  FLBewerbungPersonEinwilligungResponse,
  FLBewerbungSchulenResponse,
  FLBewerbungSingleResponse,
  FLBewerbungSweepAngekuendigtPayload,
  FLBewerbungSweepAngekuendigtResponse,
  FLBewerbungSweepLoeschenPayload,
  FLBewerbungSweepLoeschenResponse,
  FLBewerbungSweepResponse,
  FLBewerbungSweepSaisonsResponse,
  FLBewerbungTrikotFarbenResponse,
  FLBewerbungZustellungAngenommenPayload,
  FLBewerbungZustellungEreignisPayload,
  FLBewerbungZustellungResponse,
  FLEinladungAnsichtPayload,
  FLEinladungAnsichtResponse,
  FLEinladungMintResponse,
  FLEinladungResponse,
  FLEinladungVersandPayload,
  FLEinladungVersandResponse,
  FLEinladungVersandVorschauResponse,
  FLEinladungWriteResponse,
  FLEinwilligungFassungResponse,
  FLEinwilligungSeitenResponse,
  FLErasureAdressePayload,
  FLErasureAnsichtResponse,
  FLErasurePayload,
  FLErasureResponse,
  FLGenerateSpielplanPayload,
  FLGenerateSpielplanResponse,
  FLGesperrtPayload,
  FLGesperrtResponse,
  FLKaderResponse,
  FLKaderZeileResponse,
  FLKontaktEinladenResponse,
  FLKontoAdresswechselFreigabePayload,
  FLKontoAdresswechselFreigabeResponse,
  FLKontoAdresswechselMintResponse,
  FLKontoAdresswechselPayload,
  FLKontoAdresswechselResponse,
  FLKontoEinwilligungenResponse,
  FLLoeschungLaufResponse,
  FLLoeschungVorschauResponse,
  FLOffeneRegistrierungenResponse,
  FLPatchBerechtigungPayload,
  FLPatchKaderZeilePayload,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPatchSaisonSpielerPayload,
  FLPatchSaisonTeamKontaktePayload,
  FLPatchSaisonTeamKontakteResponse,
  FLPatchSaisonTeamPayload,
  FLPatchSchiedsrichterPayload,
  FLPatchSchiedsrichterResponse,
  FLPatchSpielDataPayload,
  FLPatchSpielDataResponse,
  FLPatchSpielerPayload,
  FLPatchSpielortPayload,
  FLPatchSpielortResponse,
  FLPatchSpieltagPayload,
  FLPatchTeamPayload,
  FLPatchTeamResponse,
  FLPostBerechtigungPayload,
  FLPostBerechtigungResponse,
  FLPostBewerbungPayload,
  FLPostBewerbungResponse,
  FLPostRegistrierungPayload,
  FLPostRegistrierungResponse,
  FLPostSaisonPayload,
  FLPostSaisonResponse,
  FLPostSaisonSpielerPayload,
  FLPostSaisonTeamPayload,
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
  FLPostSperrlistePayload,
  FLPostSperrlisteResponse,
  FLPostSpielortPayload,
  FLPostSpielortResponse,
  FLPostTeamPayload,
  FLPostTeamResponse,
  FLReferenzenPayload,
  FLReferenzenResponse,
  FLRegistrierungAblehnenPayload,
  FLRegistrierungAblehnungResponse,
  FLRegistrierungAufnahmeResponse,
  FLRegistrierungAufnehmenPayload,
  FLRegistrierungBestaetigungAnsichtPayload,
  FLRegistrierungBestaetigungAnsichtResponse,
  FLRegistrierungBestaetigungPayload,
  FLRegistrierungBestaetigungResponse,
  FLRegistrierungenListResponse,
  FLRegistrierungSelbstEinwilligungPayload,
  FLRegistrierungSelbstEinwilligungResponse,
  FLRegistrierungSweepResponse,
  FLReplaceSaisonTeamPayload,
  FLReplaceSaisonTeamResponse,
  FLSaisonsListResponse,
  FLSaisonSpielerResponse,
  FLSaisonsSingleResponse,
  FLSaisonTeamEinwilligungAntwortResponse,
  FLSaisonTeamPersonEinwilligungPayload,
  FLSaisonTeamPersonEinwilligungResponse,
  FLSaisonTeamResponse,
  FLSchiedsrichterBestaetigungAnsichtPayload,
  FLSchiedsrichterBestaetigungAnsichtResponse,
  FLSchiedsrichterBestaetigungPayload,
  FLSchiedsrichterBestaetigungResponse,
  FLSchiedsrichterListResponse,
  FLSchiedsrichterMintResponse,
  FLSchiedsrichterReactivateResponse,
  FLSchiedsrichterSelbstEinwilligungPayload,
  FLSchiedsrichterSelbstEinwilligungResponse,
  FLSchiedsrichterSelbstResponse,
  FLSchiedsrichterSingleResponse,
  FLSchiedsrichterWriteResponse,
  FLSelbstErasureAnsichtResponse,
  FLSperrlisteListResponse,
  FLSperrlisteWriteResponse,
  FLSpielberichtAdminResponse,
  FLSpielberichtePersonResponse,
  FLSpielberichteSaisonResponse,
  FLSpielberichtPayload,
  FLSpielberichtSchiedsrichterResponse,
  FLSpielbestaetigungAnsichtPayload,
  FLSpielbestaetigungAnsichtResponse,
  FLSpielbestaetigungAntwortPayload,
  FLSpielbestaetigungAntwortResponse,
  FLSpielbestaetigungEintragenPayload,
  FLSpielbestaetigungEintragenResponse,
  FLSpielbestaetigungenListResponse,
  FLSpielbestaetigungenSelbstResponse,
  FLSpielbestaetigungSchiedsrichterAntwortPayload,
  FLSpielbestaetigungSchiedsrichterAntwortResponse,
  FLSpielbestaetigungSweepAngefragtPayload,
  FLSpielbestaetigungSweepAngefragtResponse,
  FLSpielbestaetigungSweepMitgeteiltPayload,
  FLSpielbestaetigungSweepMitgeteiltResponse,
  FLSpielbestaetigungSweepResponse,
  FLSpielbestaetigungSweepSaisonsResponse,
  FLSpielbestaetigungVerwerfenResponse,
  FLSpieleActionRequiredResponse,
  FLSpieleAdminListResponse,
  FLSpieleAdminSingleResponse,
  FLSpieleListResponse,
  FLSpielerAdminSingleResponse,
  FLSpielerListResponse,
  FLSpielerMembershipsResponse,
  FLSpielerNachnominierungResponse,
  FLSpielerSelbstEinwilligungPayload,
  FLSpielerSelbstEinwilligungResponse,
  FLSpielerSelbstResponse,
  FLSpielerSingleResponse,
  FLSpieleSingleResponse,
  FLSpielorteListResponse,
  FLSpielorteSingleResponse,
  FLSpielortWriteResponse,
  FLSpieltageListResponse,
  FLSpieltageSingleResponse,
  FLSpieltagWriteResponse,
  FLSubjektPayload,
  FLSubjektResponse,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
  FLTeamsGroupedResponse,
  FLTeamSitzeResponse,
  FLTeamsListResponse,
  FLTeamsMembershipsResponse,
  FLTeamsSingleResponse,
  FLTeamWriteResponse,
  FLUndrawSpielplanResponse,
  FLZustellungAbgewiesenPayload,
  FLZustellungAngenommenPayload,
  FLZustellungEreignisPayload,
  FLZustellungResponse,
  IdentitaetPostLoeschungLaufParams,
  RegistrierungenGetOffeneRegistrierungenParams,
  RegistrierungenGetRegistrierungenParams,
  SaisonsGetSaisonsForAdminParams,
  SaisonsGetSaisonsParams,
  SaisonsPreviewEinladungenVersandParams,
  SchiedsrichterGetSchiedsrichterParams,
  SpielberichteGetSpielberichtAdminParams,
  SpielberichteGetSpielberichteParams,
  SpielbestaetigungenGetSpielbestaetigungenParams,
  SpieleGetSpieleActionRequiredParams,
  SpieleGetSpieleForAdminParams,
  SpieleGetSpieleParams,
  SpielePatchSpielDataParams,
  SpielerGetSpielerParams,
  SpielorteGetSpielorteParams,
  SpieltageGetSpieltageForAdminParams,
  SpieltageGetSpieltageParams,
  TeamsGetTeamParams,
  TeamsGetTeamsForAdminParams,
  TeamsGetTeamsParams,
} from "./types.ts";

export const getSystemRootUrl = () => {
  return `/`;
};

/**
 * Confirm the service is answering. The versioned API is under `/api/v0`; `/system/is_live` is the probe.
 * @summary Root
 */
export const systemRoot = async (options?: Parameters<typeof unkeyedTransport>[1]): Promise<unknown> => {
  return unkeyedTransport<unknown>(getSystemRootUrl(), {
    ...options,
    method: "GET",
  });
};

export const getAdresswechselPostAdresswechselVerwaltungUrl = () => {
  return `/api/v0/adresswechsel`;
};

/**
 * Start a change of the typed address for a person who says they cannot sign in, answering its raw links once, for the caller to mail.
 *
 * **Nothing moves here.** Without a `grund` the change asks the address on file first: the caller mails it the request
 * with its stop link, and nothing goes to the new mailbox until that address approves on its account page. With a
 * `grund`, recording how the administrator established who asks, the caller mails the new mailbox its link and the
 * address on file a notice with its stop link; the change then takes effect `ADRESSWECHSEL_WARTEZEIT_TAGE` after the new
 * mailbox confirms. Where the address holds a grant, the change also waits on another administrator's approval, never
 * this one's: `genehmiger_anzahl` counts who could give it, and the grants' outbox tells them (`POST /berechtigungen/abgleich`).
 * The address's live change ends replaced.
 *
 * Refused the administrator's own address (`REQ-PURGE-003`), a grant holder's without an owner's power
 * (`REQ-PURGE-005`), the address on file typed again (`REQ-ADRESSWECHSEL-007`), a new address the ban list holds
 * (`-009`), an address holding nothing a change moves (`-010`), a new address another pupil signs in on where the
 * change moves a pupil (`-006`), a new address any entry names, confirmed or not (`-018`), a grant nobody could approve
 * (`-011`), and a reason naming a person of the records the change would move (`-008`).
 * @summary Start an address change for a person who says they cannot sign in
 */
export const adresswechselPostAdresswechselVerwaltung = async (
  fLAdresswechselVerwaltungPayload: FLAdresswechselVerwaltungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAdresswechselVerwaltungMintResponse> => {
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
  return adminKeyTransport<FLAdresswechselVerwaltungMintResponse>(getAdresswechselPostAdresswechselVerwaltungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAdresswechselVerwaltungPayload),
  });
};

export const getAdresswechselGetAdresswechselVerwaltungAnsichtUrl = () => {
  return `/api/v0/adresswechsel/ansicht`;
};

/**
 * Answer what the typed address holds that a change moves, by kind, and its live change whole, the new address and reason included.
 *
 * ADMIN TIER, the address tool's read, keyed by the address the administrator types or by a change a page links to;
 * never a hash. `moeglich` where the address holds anything a change moves, a grant included. Stores nothing.
 *
 * Refused as the erasure's reveal is: the administrator's own address (`REQ-PURGE-003`), and an address holding a live
 * grant unless the administrator holds an owner's power (`REQ-PURGE-005`). A change id answers 404 where no change is
 * kept, and `REQ-ADRESSWECHSEL-002` where it ended.
 * @summary Show what an address holds that a change moves, and its live change
 */
export const adresswechselGetAdresswechselVerwaltungAnsicht = async (
  fLAdresswechselVerwaltungAnsichtPayload: FLAdresswechselVerwaltungAnsichtPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAdresswechselVerwaltungAnsichtResponse> => {
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
  return adminKeyTransport<FLAdresswechselVerwaltungAnsichtResponse>(getAdresswechselGetAdresswechselVerwaltungAnsichtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAdresswechselVerwaltungAnsichtPayload),
  });
};

export const getAdresswechselPostAdresswechselAntwortUrl = () => {
  return `/api/v0/adresswechsel/bestaetigung`;
};

/**
 * Record whether the mailbox this link was sent to is the person's: `bestaetigt` confirms it, `abgelehnt` ends the change.
 *
 * **A confirmation moves the person, not a record.** Unless the change waits -- on a waiting time an administrator's
 * start with a reason asked, or on another administrator's approval of the grant it moves -- it takes effect in this
 * transaction: every pupil row, confirmed referee row, confirmed contact seat, registration and grant the address on
 * file holds moves to the new one, asking no consent and writing none, and `wirksam` says so; its completion notice is
 * queued in this transaction for `POST /adresswechsel/sweep/postausgang`. A change that waits is confirmed alone,
 * answering `wirksam_ab` or `genehmigung_offen`.
 * Either answer spends the link, which keeps answering what became of the change.
 *
 * Refuses a token no change holds (`REQ-ADRESSWECHSEL-001`), a link already answered or a change ended
 * (`REQ-ADRESSWECHSEL-002`), and, in the order the link's view ranks its states, a CONFIRMATION through a link mailed to
 * an address the ban list holds now (`-004`), one past its deadline (`-003`), one whose change would replace an address
 * the ban list holds now (`-005`), so a barred person cannot move their records off the address the ban keys on, one
 * moving a pupil onto an address another pupil signs in on (`-006`), one whose address came to hold a grant its approval
 * does not cover (`-015`), one moving a grant onto an address holding one (`-016`), and one whose new address any entry
 * names, confirmed or not, an open grant request among them (`-018`): moving the person onto it would join two people's
 * records. **A decline is refused none of these**: it removes an address nobody proved, out of every log image of the change too.
 *
 * A change whose address has come to hold nothing to move ends discarded, and the press answers `-002`. The codes past
 * `-004` tell a caller what the view's `nicht_bestaetigbar` keeps alike; only the edge keeps them from the link's holder.
 * @summary Confirm or decline a pending address
 */
export const adresswechselPostAdresswechselAntwort = async (
  fLAdresswechselAntwortPayload: FLAdresswechselAntwortPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLAdresswechselAntwortResponse> => {
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
  return baseKeyTransport<FLAdresswechselAntwortResponse>(getAdresswechselPostAdresswechselAntwortUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAdresswechselAntwortPayload),
  });
};

export const getAdresswechselGetAdresswechselAnsichtUrl = () => {
  return `/api/v0/adresswechsel/bestaetigung/ansicht`;
};

/**
 * Answer what this token opens: the new mailbox's link, the stop link the address on file was mailed, or how either's change ended.
 *
 * **Nothing else about the change**: never a name, either address or the id. A POST that reads, so the token travels in
 * a body and never in a second URL. Refuses only a token no change holds (`REQ-ADRESSWECHSEL-001`); an ended change's
 * links answer `beendet` and how it ended for as long as its record is kept.
 *
 * The new mailbox's side is served in a state: once pressed, `bestaetigt`, or `genehmigung_abgelaufen` where its
 * approval week lapsed unapproved; else `gesperrt` wherever the ban list holds the address the link was mailed to, then
 * `abgelaufen`, then `nicht_bestaetigbar` wherever the press would be refused for the address on file's sake or would
 * find it holding nothing to move, each a state the confirmation is refused in. Those read alike here, though the press
 * answers each by its own code; what keeps the link's holder from telling them apart is the edge, where
 * `nginx/shared/site.conf` routes no public call to this service. The stop side answers the step the change waits on and
 * until when, and never whether it could be confirmed: the stop is refused nothing.
 * @summary What one address link opens
 */
export const adresswechselGetAdresswechselAnsicht = async (
  fLAdresswechselAnsichtPayload: FLAdresswechselAnsichtPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLAdresswechselAnsichtResponse> => {
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
  return baseKeyTransport<FLAdresswechselAnsichtResponse>(getAdresswechselGetAdresswechselAnsichtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAdresswechselAnsichtPayload),
  });
};

export const getAdresswechselPostAdresswechselStoppUrl = () => {
  return `/api/v0/adresswechsel/bestaetigung/stopp`;
};

/**
 * Stop the change the address on file was told of: its new address goes, out of every log image of the change too.
 *
 * **Refused nothing but a token no change holds** (`REQ-ADRESSWECHSEL-001`) **and a change ended** (`-002`): a stop
 * hands nothing over, so it answers past every deadline, a barred address's holder too, until the change ends.
 * @summary Stop a pending address change
 */
export const adresswechselPostAdresswechselStopp = async (
  fLAdresswechselStoppPayload: FLAdresswechselStoppPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLAdresswechselStoppResponse> => {
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
  return baseKeyTransport<FLAdresswechselStoppResponse>(getAdresswechselPostAdresswechselStoppUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAdresswechselStoppPayload),
  });
};

export const getAdresswechselSweepAdresswechselUrl = (params?: AdresswechselSweepAdresswechselParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/adresswechsel/sweep?${stringifiedParams}` : `/api/v0/adresswechsel/sweep`;
};

/**
 * End a bounded share of the live changes whose waiting step lapsed, and make the due ones take effect.
 *
 * **A lapsed change** -- its link, the approval it asked of the address on file, or its grant's approval by another
 * administrator -- ends as `abgelaufen`: its address and reason out of the record and every log image of it
 * (`entfernt`). **A due change**, one whose waiting time has ended and whose grant's move, where its address still
 * holds the grant, was approved, is judged again as its confirmation was: a ban on either address, another pupil
 * signing in on the new one, a grant its approval does not cover, a grant at the new address, or nothing left to move
 * ends it discarded, and
 * `verworfen` counts it, its new address queued to be told it did not take effect and never why; otherwise
 * everything the replaced address holds moves, and `wirksam` counts it, its completion notice queued. The notices are
 * `POST /adresswechsel/sweep/postausgang`'s to claim, queued in each change's own transaction, so none rides on this answer.
 *
 * Each change is handled in a transaction of its own that judges it again, so one confirmed, stopped, discarded or
 * replaced since this call read it is left standing. **A pass is a run of calls, each handing the next the `nach` the last
 * answered**, the first naming none; it ends at the call answering `nach` null. A call reaches at most a fixed share of the
 * changes after `nach`, in `_id` order, and the pass holds no state on the server. A change whose handling fails is
 * logged by its id and passed, holding back nobody behind it; it stays due, and the next pass tries it again. Where the
 * request's deadline cuts the call, it stops at that change, warns once, and answers what it did. `verbleibend` counts
 * the changes standing due after the call, so it is no stopping condition.
 * @summary End the lapsed address changes, and make the due ones take effect
 */
export const adresswechselSweepAdresswechsel = async (
  params?: AdresswechselSweepAdresswechselParams,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAdresswechselSweepResponse> => {
  return systemKeyTransport<FLAdresswechselSweepResponse>(getAdresswechselSweepAdresswechselUrl(params), {
    ...options,
    method: "POST",
  });
};

export const getAdresswechselGetAdresswechselAdresseUrl = () => {
  return `/api/v0/adresswechsel/sweep/adresse`;
};

/**
 * Answer the new address of the live change the new mailbox's link token or the change's id names, folded to the sign-in identifier.
 *
 * For the frontend's server alone, which asks its sign-in store whether an account stands there before a press, a link's
 * view or an approval; the link's own view never serves the address. A token or id naming no live change -- unknown,
 * ended, or the stop link's token -- is answered null rather than refused, so a lapsed or answered link costs no
 * error. Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the token travels in the body, and the
 * address only in the answer.
 * @summary Say which address a live change would move to
 */
export const adresswechselGetAdresswechselAdresse = async (
  fLAdresswechselAdressePayload: FLAdresswechselAdressePayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAdresswechselAdresseResponse> => {
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
  return systemKeyTransport<FLAdresswechselAdresseResponse>(getAdresswechselGetAdresswechselAdresseUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAdresswechselAdressePayload),
  });
};

export const getAdresswechselPostAdresswechselPostausgangUrl = () => {
  return `/api/v0/adresswechsel/sweep/postausgang`;
};

/**
 * Claim, oldest first and a page at a time, every owed notice no claim holds or whose claim has lapsed, for ten minutes.
 *
 * Each end owing a notice queued it in its own transaction: an effect its completion notice and its sign-in account's
 * carry, a due change the pass refused its new address's notice. A second call inside the lease is answered none of
 * them; the caller delivers each and hands the ids it delivered, with `beanspruchung`, to
 * `POST /adresswechsel/sweep/postausgang/zugestellt`, and where the lease lapses first the next call claims them again,
 * so a notice is delivered at least once. A notice handed out past the grants' attempt cap is answered `aufgegeben`:
 * the caller delivers nothing, logs it by id and stamps it. Server to server alone: the answer names addresses.
 * @summary Claim the notices the address changes' ends still owe
 */
export const adresswechselPostAdresswechselPostausgang = async (
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAdresswechselPostausgangResponse> => {
  return systemKeyTransport<FLAdresswechselPostausgangResponse>(getAdresswechselPostAdresswechselPostausgangUrl(), {
    ...options,
    method: "POST",
  });
};

export const getAdresswechselPostAdresswechselZugestelltUrl = () => {
  return `/api/v0/adresswechsel/sweep/postausgang/zugestellt`;
};

/**
 * Remove each named notice the named claim still holds, and nothing else.
 *
 * A notice the claim does not hold -- unknown, removed already, or claimed since by another call after this claim
 * lapsed -- is left alone and counted in `ignoriert`. A repeated id counts once. One transaction, imageless: a row
 * names addresses, and the log keeps no image of its removal.
 * @summary Remove the delivered notices a claim holds
 */
export const adresswechselPostAdresswechselZugestellt = async (
  fLAdresswechselZugestelltPayload: FLAdresswechselZugestelltPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAdresswechselZugestelltResponse> => {
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
  return systemKeyTransport<FLAdresswechselZugestelltResponse>(getAdresswechselPostAdresswechselZugestelltUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAdresswechselZugestelltPayload),
  });
};

export const getAdresswechselDeleteAdresswechselUrl = (adresswechselId: string) => {
  return `/api/v0/adresswechsel/${adresswechselId}`;
};

/**
 * Discard the change this id names: its links open nothing to press, and the address on file stays.
 *
 * **Its address goes from the action log too**: every image the log holds of the change
 * loses its new address and reason, the rest of each image standing. Journalled as the stop is, so a restore does not
 * bring back a change confirmed in its waiting time to take effect. Nothing is mailed. Acts on the change the id names
 * alone, so a page showing a change since replaced discards nothing.
 *
 * Refused as the start is about who asks (`REQ-PURGE-003`, `REQ-PURGE-005`), and where the change ended
 * (`REQ-ADRESSWECHSEL-002`); 404 for an id naming no change.
 * @summary Discard a pending address change
 */
export const adresswechselDeleteAdresswechsel = async (
  adresswechselId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAdresswechselIdResponse> => {
  return adminKeyTransport<FLAdresswechselIdResponse>(getAdresswechselDeleteAdresswechselUrl(adresswechselId), {
    ...options,
    method: "DELETE",
  });
};

export const getAdresswechselEinladenAdresswechselUrl = (adresswechselId: string) => {
  return `/api/v0/adresswechsel/${adresswechselId}/einladen`;
};

/**
 * Mint the new mailbox a fresh link for the change this id names, answering the raw token once, for the caller to mail.
 *
 * The previous link stops working at once and the delivery state of the message it went out in goes with it; the
 * deadline restarts now. The stop link stays, so the address on file is mailed nothing again. A lapsed link is no
 * refusal while the change stands, which is until the next hourly pass ends it. Acts
 * on the change the id names alone, so a page showing a change since replaced re-sends nothing.
 *
 * Refused as the start is about who asks (`REQ-PURGE-003`, `REQ-PURGE-005`), where the ban list holds the pending address
 * (`REQ-ADRESSWECHSEL-009`), where another pupil has come to sign in on it (`-006`), where an entry has come to name it,
 * confirmed or not (`-018`), where a grant's approval week has passed (`-003`), and where the change ended (`-002`). 404 for
 * an id naming no change, and unless the change waits on the new mailbox: one awaiting the address on file's approval,
 * or confirmed, has no link to re-send.
 * @summary Send a pending address a fresh link
 */
export const adresswechselEinladenAdresswechsel = async (
  adresswechselId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAdresswechselVerwaltungMintResponse> => {
  return adminKeyTransport<FLAdresswechselVerwaltungMintResponse>(getAdresswechselEinladenAdresswechselUrl(adresswechselId), {
    ...options,
    method: "POST",
  });
};

export const getAdresswechselPostAdresswechselGenehmigungUrl = (adresswechselId: string) => {
  return `/api/v0/adresswechsel/${adresswechselId}/genehmigung`;
};

/**
 * Approve the move of an administrator's grant with the change of their address, the second pair of eyes the change waits on.
 *
 * Where the new mailbox has confirmed and no waiting time remains, the change takes effect in this transaction: the grant
 * is revoked at the replaced address and granted at the new one under this administrator's name, announced to every
 * administrator as a grant and a revoke are, and everything else the address holds moves, its completion notice queued
 * in this transaction. Otherwise the approval is recorded and the change takes effect at its confirmation
 * or at the end of its waiting time. **An approval refused writes nothing**: the change stands unapproved.
 *
 * Refused where the change asks no approval or was given it (`REQ-ADRESSWECHSEL-012`), where its seven days have passed
 * (`-003`), to the changed address and to the administrator who started it (`-013`), to anyone but an owner, signed in
 * since becoming one, where the grant is an owner's (`-014`), and where the change ended (`-002`); and, where it would
 * take effect, as the confirmation is (`-004`, `-005`, `-006`, `-015`, `-016`, `-018`). A change whose address has come to hold
 * nothing to move ends discarded, its new address told it did not take effect, answering `-010`. 404 for an id naming no
 * change. A sign-in or confirmation older than
 * `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as a grant's is.
 * @summary Approve the move of an administrator's access with their address change
 */
export const adresswechselPostAdresswechselGenehmigung = async (
  adresswechselId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAdresswechselGenehmigungResponse> => {
  return adminKeyTransport<FLAdresswechselGenehmigungResponse>(getAdresswechselPostAdresswechselGenehmigungUrl(adresswechselId), {
    ...options,
    method: "POST",
  });
};

export const getAktionenGetAktionenUrl = (params?: AktionenGetAktionenParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/aktionen?${stringifiedParams}` : `/api/v0/aktionen`;
};

/**
 * List what administrators changed, newest first; `vollstaendig` is false on a cut answer.
 *
 * Admin-tier twice over: every recorded write across every collection is here, public or not,
 * and each row names the administrator behind it — `null` beside `actor.email_gesperrt` where the
 * ban list holds that address, as no barred address is served in plain.
 *
 * `collection`, `operation` and `herkunft` each take a comma-joined selection, or the parameter
 * repeated, and all three narrow this read. `herkunft` names no stored field: it is the category the
 * actor's kind is filed under, `person` covering every kind that authenticates somebody.
 *
 * `anzahl_je_collection`, `anzahl_je_operation` and `anzahl_je_herkunft` count every row `trace_id`
 * and `document_id` leave, with the other two facets applied and their own ignored, so a caller
 * narrowed to one area still knows what asking for another would fetch; a value nothing was recorded
 * under is absent rather than zero. While either of those two terms is in force the counts are that
 * trace's or that document's and not the log's.
 *
 * `trace_id` selects one request's whole fan-out, which this read serves under the same cap as any
 * other; a write made outside a request carries the sentinel `SYSTEM` there, which gathers every
 * such write rather than one (`docs/glossary.md :: Vorgangsnummer`).
 * @summary List recorded admin actions
 */
export const aktionenGetAktionen = async (
  params?: AktionenGetAktionenParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAktionenListResponse> => {
  return adminKeyTransport<FLAktionenListResponse>(getAktionenGetAktionenUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getAktionenGetAktionByIdUrl = (aktionId: string) => {
  return `/api/v0/aktionen/${aktionId}`;
};

/**
 * One row with the document its write replaced, which the list withholds.
 *
 * The read a restore of one write would start from, so the image is served as recorded, every
 * address in it included; the actor is withheld as the list withholds it.
 * @summary One recorded admin action
 */
export const aktionenGetAktionById = async (
  aktionId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAktionSingleResponse> => {
  return adminKeyTransport<FLAktionSingleResponse>(getAktionenGetAktionByIdUrl(aktionId), {
    ...options,
    method: "GET",
  });
};

export const getBerechtigungenGetBerechtigungenUrl = () => {
  return `/api/v0/berechtigungen`;
};

/**
 * List every live grant of access to the administration, by address: its tier, who granted it and when.
 *
 * Uncapped, as few people hold one. A row whose address no request can match -- empty, unfolded or refused by the address rule --
 * admits nobody and is left out, counted in `uebersprungen`. An address on the ban list is answered as `null` beside `gesperrt`,
 * never in plain, and so is a barred `erteilt_von`, beside `erteilt_von_gesperrt`; it is otherwise an administrator's address
 * for a grant made here and whatever the database edit wrote for one made there.
 *
 * `adresswechsel` names the change of a grant's address waiting on an administrator's approval: its new address, how it was
 * started (`weg`), the administrator who started it and the reason they recorded, and why this administrator may not approve
 * it, where they may not: their own, one they started, or an owner's without an owner's power
 * (`POST /adresswechsel/{adresswechsel_id}/genehmigung`); and why the address tool refuses it them (`einsehbar_verwehrt`). An
 * owner's change withholds its new address, starter and reason from that non-owner, as the address tool refuses them an
 * owner's address; a barred new address or starter is withheld as on a grant's row. A change any step of which lapsed is
 * left out: its approval is refused, and the next hourly pass ends it.
 *
 * `antraege` lists every grant and promotion waiting on a second administrator's approval and not yet lapsed, oldest first:
 * the address, the tier asked, who asked and when, until when it waits, whether its requester still holds that tier since
 * before it (`steht`), and why this administrator may not approve it, where they may not. A barred address is withheld as on a
 * grant's row.
 * @summary List who may enter the administration
 */
export const berechtigungenGetBerechtigungen = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBerechtigungenListResponse> => {
  return adminKeyTransport<FLBerechtigungenListResponse>(getBerechtigungenGetBerechtigungenUrl(), {
    ...options,
    method: "GET",
  });
};

export const getBerechtigungenPostBerechtigungUrl = () => {
  return `/api/v0/berechtigungen`;
};

/**
 * Grant an address access to the administration, as `administration`, or ask another administrator to. No request grants `owner`.
 *
 * **Four eyes**: where another administrator could approve it -- a live, unbarred grant in effect now, neither this administrator
 * nor the address -- the grant is not made: a request is, answered with `beantragt` set and its id, and the grant takes effect
 * only on that approval (`POST /berechtigungen/antraege/{antrag_id}/genehmigung`). A lone administrator grants alone.
 *
 * The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where a live
 * grant already holds the address (`REQ-BERECHTIGUNG-001`) -- a dead row of another spelling blocks nothing -- where the ban list
 * holds it (`REQ-BERECHTIGUNG-003`), and where a request about it waits already (`REQ-BERECHTIGUNG-008`). The grant takes effect on
 * the next request, for a session signed in after it alone -- an older one is refused `REQ-AUTH-007` on every admin-tier route -- and
 * its announcement is queued in the same transaction for `POST /berechtigungen/abgleich` to hand out. Like a revoke and a tier
 * change, it takes a passkey sign-in or confirmation no older than `ENROLMENT_WINDOW_MINUTES`, refused `REQ-AUTH-009` otherwise.
 * @summary Grant access to the administration
 */
export const berechtigungenPostBerechtigung = async (
  fLPostBerechtigungPayload: FLPostBerechtigungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostBerechtigungResponse> => {
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
  return adminKeyTransport<FLPostBerechtigungResponse>(getBerechtigungenPostBerechtigungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostBerechtigungPayload),
  });
};

export const getBerechtigungenPostBerechtigungenAbgleichUrl = () => {
  return `/api/v0/berechtigungen/abgleich`;
};

/**
 * Queue every change made to the grants in the database directly, then claim the unannounced changes and answer who to tell.
 *
 * Every grant and revoke made through the application queued its own notice when it was made, naming the administrator who made
 * it. What was changed in the database directly is found here, by comparing the grants with the record of what is already
 * accounted for, and queued naming nobody: `geaendert_von` and `geaendert_am` null. A database change undone again before any
 * call to this endpoint is found by nothing. A row whose address no request can match counts as no grant, and `uebersprungen`
 * counts those rows. A grant found here -- a new row, or an address changed in place -- is stamped `gefunden_am` with this call's
 * time, which `POST /identitaet/subjekt` then answers as `berechtigt_seit`: a session signed in before it administers nothing. Every
 * row a call reads for the first time, one no request can match included, is stamped `gesehen_am`, and a row carrying it beside no
 * record of its own was changed in the database since a call read it: it is no grant until a call finds it.
 *
 * The call then claims, oldest first and a page at a time, every queued change no claim holds or whose claim has lapsed, for ten
 * minutes from now. A second call inside that time is answered none of them. The caller mails each change and then hands the ids it
 * mailed, with `beanspruchung`, to `POST /berechtigungen/abgleich/angekuendigt`. Where a lease lapses before that, the next call
 * claims those changes again. `beanspruchung` and `beansprucht_bis` are null exactly where nothing was claimed.
 *
 * `urheber` says who made each change: `anwendung` for an administrator through the application, `datenbank` for an edit
 * found here. No barred address is answered in plain: wherever one would stand -- `jetzt`, `vorher`, `geaendert_von`,
 * `empfaenger` -- it is `null` or left out; a barred grant address carries `gesperrt`, a barred `geaendert_von`
 * `geaendert_von_gesperrt`. A grant address whose holder was erased is `null` beside `geloescht`, and an erased
 * `geaendert_von` reads `ERASED`, naming nobody. An address changed in place is two changes, its removal and the new
 * address's grant.
 * `empfaenger` is every live, unbarred grant holder now; a removed address is read off its change.
 *
 * A `beantragt` row is a grant or a promotion asked for, which no grant has yet. It goes to its own `an` rather than to
 * `empfaenger`: whoever could approve the request now, as `POST /berechtigungen/antraege/{antrag_id}/genehmigung` judges
 * them, and nobody where the request is decided, withdrawn, lapsed or erased, or its requester does not hold, since before
 * it, the tier it asks for. An `adresswechsel` row is an address change moving a grant, keyed by the change, that waits on
 * an approval: it goes to its own `an` too, whoever could approve it now as `POST /adresswechsel/{adresswechsel_id}/genehmigung`
 * judges them, and nobody where the change is approved, ended or past its week, or its address now holds no grant.
 * An `antrag_abgelehnt` row is a request an administrator refused, and an `antrag_beendet` row one an address change ended,
 * each keyed by the request and naming its requester as `geaendert_von`: it goes to its own `an` as well, that requester alone
 * while they hold a live, unbarred grant, and nobody otherwise. `an` is null on every other row.
 * @summary Claim the grant changes still to be announced
 */
export const berechtigungenPostBerechtigungenAbgleich = async (
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBerechtigungAbgleichResponse> => {
  return systemKeyTransport<FLBerechtigungAbgleichResponse>(getBerechtigungenPostBerechtigungenAbgleichUrl(), {
    ...options,
    method: "POST",
  });
};

export const getBerechtigungenPostBerechtigungenAngekuendigtUrl = () => {
  return `/api/v0/berechtigungen/abgleich/angekuendigt`;
};

/**
 * Remove each named change from the queue, where the named claim still holds it, and nothing else.
 *
 * A change the claim does not hold -- unknown, removed already, or claimed since by another call after this claim lapsed -- is
 * left alone and counted in `ignoriert`, so a caller can mark as told only what the server itself holds as queued under its own
 * claim. A repeated id counts once. One transaction, recorded under the system actor.
 * @summary Remove the announced changes a claim holds
 */
export const berechtigungenPostBerechtigungenAngekuendigt = async (
  fLBerechtigungAngekuendigtPayload: FLBerechtigungAngekuendigtPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBerechtigungAngekuendigtResponse> => {
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
  return systemKeyTransport<FLBerechtigungAngekuendigtResponse>(getBerechtigungenPostBerechtigungenAngekuendigtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBerechtigungAngekuendigtPayload),
  });
};

export const getBerechtigungenDeleteAntragUrl = (antragId: string) => {
  return `/api/v0/berechtigungen/antraege/${antragId}`;
};

/**
 * Refuse a request, or withdraw one's own: it is removed, and nothing it asked for happens. HARD, no soft form.
 *
 * Decided by whoever may approve it, refused with the approval's own codes otherwise (`REQ-BERECHTIGUNG-009`, `-010`, `-011`), and
 * withdrawn by the administrator who made it, whatever their tier now. 404 for an id naming no request, a request decided, withdrawn or
 * lapsed among them. A restore from a snapshot taken before it brings the request back only until the replay of its journal line.
 *
 * A refusal queues, in the same transaction, a notice to the request's requester naming the address and tier it asked for and
 * nobody who refused it, for `POST /berechtigungen/abgleich` to hand out; a withdrawal tells nobody.
 * @summary Refuse a grant or a promotion another administrator asked for, or withdraw one's own
 */
export const berechtigungenDeleteAntrag = async (
  antragId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBerechtigungAntragAbgelehntResponse> => {
  return adminKeyTransport<FLBerechtigungAntragAbgelehntResponse>(getBerechtigungenDeleteAntragUrl(antragId), {
    ...options,
    method: "DELETE",
  });
};

export const getBerechtigungenPostAntragGenehmigungUrl = (antragId: string) => {
  return `/api/v0/berechtigungen/antraege/${antragId}/genehmigung`;
};

/**
 * Approve a request, the second pair of eyes a grant or a promotion waits on.
 *
 * The grant is made, or the tier moved, and the request removed, in one transaction, the change announced to every
 * administrator as one made directly is, under this administrator's name.
 *
 * Refused to the address the request is about and to the administrator who made it (`REQ-BERECHTIGUNG-009`), to anyone but an
 * owner, signed in since becoming one, for a promotion (`-010`), to an administrator whose grant, or owner's tier, took effect after
 * the request (`-011`), and where the requester does not hold that tier since before it, revoked, demoted or barred since
 * (`-012`); and, as the direct act would be, where the address holds a grant by now (`-001`) or is on the ban list (`-003`). 404 for
 * an id naming no request, a request decided, withdrawn or lapsed among them, and for a promotion whose grant has gone. A promotion
 * whose grant is an owner's already removes the request and changes nothing. A sign-in or confirmation older than
 * `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as a grant's is.
 * @summary Approve a grant or a promotion another administrator asked for
 */
export const berechtigungenPostAntragGenehmigung = async (
  antragId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBerechtigungAntragGenehmigtResponse> => {
  return adminKeyTransport<FLBerechtigungAntragGenehmigtResponse>(getBerechtigungenPostAntragGenehmigungUrl(antragId), {
    ...options,
    method: "POST",
  });
};

export const getBerechtigungenDeleteBerechtigungUrl = (berechtigungId: string) => {
  return `/api/v0/berechtigungen/${berechtigungId}`;
};

/**
 * Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `REQ-AUTH-006` on its next request.
 *
 * Only an `owner` revokes (`REQ-BERECHTIGUNG-005`), judged on the actor's own grant inside the transaction, and before anything
 * about the target is answered; an owner's sign-in older than the moment they became one is refused the same. 404 where no grant
 * has the id. Refused for an `owner` row (`REQ-BERECHTIGUNG-002`), which is made an
 * administrator first, and where fewer than two live, unbarred grants would remain (`REQ-BERECHTIGUNG-004`). The removal's
 * announcement is queued in the same transaction, after any change to the row made in the database and not yet announced. A sign-in
 * or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as the grant's is.
 * @summary Revoke access to the administration
 */
export const berechtigungenDeleteBerechtigung = async (
  berechtigungId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBerechtigungWriteResponse> => {
  return adminKeyTransport<FLBerechtigungWriteResponse>(getBerechtigungenDeleteBerechtigungUrl(berechtigungId), {
    ...options,
    method: "DELETE",
  });
};

export const getBerechtigungenPatchBerechtigungUrl = (berechtigungId: string) => {
  return `/api/v0/berechtigungen/${berechtigungId}`;
};

/**
 * Make an administrator an owner, or an owner an administrator; an owner steps down by naming their own grant.
 *
 * Only an `owner` changes a tier (`REQ-BERECHTIGUNG-005`), judged on the actor's own grant inside the transaction, and before
 * anything about the target is answered; an owner's sign-in older than the moment they became one is refused the same.
 *
 * **Four eyes on a promotion**: where another owner could approve it -- a live, unbarred `owner` grant in effect now, neither this
 * owner nor the promoted address -- the tier is not moved: a request is, answered with `beantragt` set, and the promotion takes
 * effect only on that approval (`POST /berechtigungen/antraege/{antrag_id}/genehmigung`). A lone owner promotes alone. A demotion
 * and a step-down take effect at once.
 *
 * A promotion holds for a sign-in after it alone: the promoted administrator's older sessions keep administering and take no owner's
 * step until they sign in again. A demotion takes the tier from every session at once. 404 where no live grant has the id. A
 * promotion of an address on the ban list is refused (`REQ-BERECHTIGUNG-003`), one whose request waits already
 * (`REQ-BERECHTIGUNG-008`), and a demotion leaving no live, unbarred owner (`REQ-BERECHTIGUNG-007`). Naming the tier the grant holds
 * changes nothing and answers 200. The change reaches the next request; its announcement is queued in the same transaction, after
 * any change to the row made in the database and not yet announced, and a grant found that way is stamped `gefunden_am` as
 * `POST /berechtigungen/abgleich` stamps one. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused
 * `REQ-AUTH-009`, as the grant's is.
 * @summary Change a grant between administrator and owner
 */
export const berechtigungenPatchBerechtigung = async (
  berechtigungId: string,
  fLPatchBerechtigungPayload: FLPatchBerechtigungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBerechtigungStufeResponse> => {
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
  return adminKeyTransport<FLBerechtigungStufeResponse>(getBerechtigungenPatchBerechtigungUrl(berechtigungId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchBerechtigungPayload),
  });
};

export const getBewerbungenGetBewerbungenUrl = (params?: BewerbungenGetBewerbungenParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/bewerbungen?${stringifiedParams}` : `/api/v0/bewerbungen`;
};

/**
 * Every application, newest first, narrowable by season and by any number of the three statuses.
 *
 * Decided ones stay listed: what the league turned down, and why, is the record the decision was
 * taken against. `vollstaendig` is false where more rows exist than one read serves. A decision's
 * administrator is `null` beside `entscheidung.von_gesperrt` where the ban list holds that
 * address, as no barred address is served in plain.
 *
 * `saisonbezug` says which side of `saison_id` this read covers — `diese_saison` for that season,
 * `andere_saison` for every other one — and is ignored without a `saison_id` to stand against.
 * Both values is every season, as omitting the parameter is; `saison_id` alone is that season.
 *
 * `anzahl_je_status` counts every status over the seasons this request selected and never over the
 * statuses it named, and `anzahl_je_saisonbezug` counts each side of the season relation over those
 * statuses and never over the relation, so a caller narrowed to one of either still knows what
 * asking for the other would fetch. Repeating a parameter and comma-joining its values are one
 * request; omitting one is every value, and sending it empty is too.
 *
 * `dubletten_schluessel` names every key two or more OPEN applications share, over every season the
 * request selected rather than over the rows served, so a colliding pair the cap parted is named at
 * both ends; a key carries its own season, so no selection can part one. A key
 * is the season and the club id, or the season and the upper-cased Kürzel, parted by the word
 * `team` or `kuerzel`; a caller composes a served row's own key and marks the row where the two
 * match.
 * @summary List Bewerbungen
 */
export const bewerbungenGetBewerbungen = async (
  params?: BewerbungenGetBewerbungenParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungenListResponse> => {
  return adminKeyTransport<FLBewerbungenListResponse>(getBewerbungenGetBewerbungenUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenPostBewerbungUrl = () => {
  return `/api/v0/bewerbungen`;
};

/**
 * Store one school's application to play one season as submitted, and mint one confirmation link per contact person.
 *
 * Everything the league decides -- `status`, `eingereicht_am`, `entscheidung` and each consent's
 * scope, source and date -- is written here and never taken off the payload. The three raw tokens are answered
 * for the caller to mail and stored only as hashes; the response is the one place outside the recipients' inboxes
 * they ever exist.
 *
 * An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * application it holds and stores none: fresh links where no message to any seat is known to have
 * reached its inbox, none otherwise. The same key over other details is refused (`REQ-BEWERBUNG-015`).
 *
 * An address the ban list holds, on any seat, is refused (`REQ-BEWERBUNG-018`) on a first press and on a
 * replay alike, before any link is minted.
 *
 * A seat naming a consent wording other than the one the form now shows is refused (`REQ-EINWILLIGUNG-001`),
 * and only once the key has been looked up: a stored key is answered whatever wording it names.
 * @summary Submit a Bewerbung
 */
export const bewerbungenPostBewerbung = async (
  fLPostBewerbungPayload: FLPostBewerbungPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLPostBewerbungResponse> => {
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
  return baseKeyTransport<FLPostBewerbungResponse>(getBewerbungenPostBewerbungUrl(), {
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
 * Record one person's own answer for the seat their link opens, and for a second seat the form said they hold.
 *
 * A consent writes their date of birth, the stamp, `person` and the wording they were shown in one update, each
 * choice with its evidence, and leaves who seated them as it stands; a decline empties their slot and redacts
 * every log image holding it, as an erasure does. Refuses, in this order: a token no seat holds (`REQ-BEWERBUNG-009`),
 * a link whose deadline has passed or whose application was decided (`REQ-BEWERBUNG-010`), a seat already answered
 * (`REQ-BEWERBUNG-011`), a consent naming any label but the one the view answered as `laufende_fassung` for this link
 * (`REQ-EINWILLIGUNG-001`), a consent from an address the ban list holds now, whenever the link was minted
 * (`REQ-BEWERBUNG-020`), an age outside the span the seats this person holds ask for (`REQ-BEWERBUNG-012`), and a
 * media consent from a person below `medien_mindestalter` (`REQ-EINWILLIGUNG-002`) -- the last four judged before
 * anything is written, so a reloaded page or a mistyped year spends nothing. A decline
 * stores no label and is taken from a barred address too: it empties the seat.
 *
 * The answer also carries what the two outbound messages are composed from, the Ansprechperson seat's own
 * mailbox among it: this is a server-to-server response, and a caller putting it in front of a browser
 * would hand one contact person another's address.
 *
 * A link on a team's season row (`quelle: saison`) is answered the same way on that row, refused in the same order but
 * for `REQ-BEWERBUNG-010`, nothing deciding a season row, and its answer carries nothing to compose a message from. Its
 * own deadline passed is `REQ-KONTAKT-004`, and a consent once its season has ended or its team has left it is
 * `REQ-KONTAKT-006`, a Widerspruch being taken all the same. A Widerspruch there also voids the seat's links on the
 * team's match confirmations of that season, answered and closed ones too, takes those links and their mails' delivery
 * records out of the confirmations' log images, and takes every reason its person typed answering a match confirmation,
 * from any seat they held, from its row and its log images, the answer standing.
 * @summary Confirm or decline one seat of a Bewerbung or of a team's season row
 */
export const bewerbungenPostEinwilligung = async (
  fLBewerbungEinwilligungAntwortPayload: FLBewerbungEinwilligungAntwortPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLBewerbungEinwilligungAntwortResponse | FLSaisonTeamEinwilligungAntwortResponse> => {
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
  return baseKeyTransport<FLBewerbungEinwilligungAntwortResponse | FLSaisonTeamEinwilligungAntwortResponse>(
    getBewerbungenPostEinwilligungUrl(),
    {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
      body: JSON.stringify(fLBewerbungEinwilligungAntwortPayload),
    },
  );
};

export const getBewerbungenGetEinwilligungAnsichtUrl = () => {
  return `/api/v0/bewerbungen/einwilligung/ansicht`;
};

/**
 * Answer what the page renders for the seat this token opens, and no contact record (`READ-BEWERBUNG-002`).
 *
 * The seat's state, the school, the season, the role, and `zugleich_rolle`: the
 * second seat the same person holds, which an answer on this link writes too, or null. Never the holder's name: the
 * link went to an address nobody has confirmed, which behind a typo is a stranger's.
 * `mindestalter` is the age this link's person has to reach, over both seats where they hold two, so the page offers
 * exactly the dates the answer will take. `laufende_fassung` is the label of the page the person is shown and their
 * answer must name: the applicant's where the applicant named them in every seat the link answers, else the one for a
 * person the administration seated.
 * A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
 * seat holds (`REQ-BEWERBUNG-009`), an open link whose seat holds nobody among them: a confirmed, declined or
 * expired link is SERVED in that state rather than refused, so a reopened link shows what became of it. The state
 * is `gesperrt`, ahead of every other, wherever the ban list holds an address a consent on this link would be
 * refused for (`REQ-BEWERBUNG-020`), so the page offers a barred person nothing to press.
 *
 * The same token may open a seat an administrator entered on a team's season row (`quelle: saison`): `schule` is then
 * the name the club carries that season, and the link is over once its seat's own deadline has passed. Before that, a
 * season that has ended or a team that has left it answers `saison_vorbei`: the link takes a Widerspruch and no consent.
 * @summary What one confirmation link opens
 */
export const bewerbungenGetEinwilligungAnsicht = async (
  fLBewerbungEinwilligungAnsichtPayload: FLBewerbungEinwilligungAnsichtPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLBewerbungEinwilligungAnsichtResponse> => {
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
  return baseKeyTransport<FLBewerbungEinwilligungAnsichtResponse>(getBewerbungenGetEinwilligungAnsichtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungEinwilligungAnsichtPayload),
  });
};

export const getBewerbungenGetOffenesFensterUrl = () => {
  return `/api/v0/bewerbungen/fenster`;
};

/**
 * Return the season taking applications today -- its window open and the season not ended; 404 when none is.
 *
 * What is served is the window and whether its season has ended, never the season: the rule
 * withholds a `future` one from this tier (`READ-BEWERBUNG-001`).
 * @summary The Saison currently accepting applications
 */
export const bewerbungenGetOffenesFenster = async (options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLBewerbungFensterResponse> => {
  return baseKeyTransport<FLBewerbungFensterResponse>(getBewerbungenGetOffenesFensterUrl(), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenGetFensterUrl = (saisonId: string) => {
  return `/api/v0/bewerbungen/fenster/${saisonId}`;
};

/**
 * Return one season's application window, or that it records none; 404 only where no season carries the id.
 *
 * A CLOSED window is served rather than hidden: the page says the deadline has passed, which a
 * 404 could not tell from a mistyped id. A season with no window recorded is served for the same
 * reason, and its existence is the whole of what this tier learns about it.
 * @summary One Saison's application window
 */
export const bewerbungenGetFenster = async (
  saisonId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLBewerbungFensterResponse | FLBewerbungKeinFensterResponse> => {
  return baseKeyTransport<FLBewerbungFensterResponse | FLBewerbungKeinFensterResponse>(getBewerbungenGetFensterUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenGetKuerzelUrl = (shorthand: string) => {
  return `/api/v0/bewerbungen/kuerzel/${shorthand}`;
};

/**
 * Answer whether any club holds this three-letter code.
 *
 * Retired clubs COUNT and no club is named: `uniq_shorthand` spans the collection, and an answer
 * naming the holder would publish which schools have left (`READ-BEWERBUNG-001`).
 * @summary Whether a Kürzel is already a club's
 */
export const bewerbungenGetKuerzel = async (
  shorthand: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLBewerbungKuerzelResponse> => {
  return baseKeyTransport<FLBewerbungKuerzelResponse>(getBewerbungenGetKuerzelUrl(shorthand), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenGetSchulenUrl = () => {
  return `/api/v0/bewerbungen/schulen`;
};

/**
 * Every club still in the league, as `{id, name}` and nothing else, sorted by name.
 *
 * `FLBewerbungSchuleOption` decides the wire (`READ-BEWERBUNG-001`) and the projection below
 * decides what leaves the database. Both are pinned.
 * @summary The clubs a public application may name
 */
export const bewerbungenGetSchulen = async (options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLBewerbungSchulenResponse> => {
  return baseKeyTransport<FLBewerbungSchulenResponse>(getBewerbungenGetSchulenUrl(), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenGetSweepSaisonsUrl = () => {
  return `/api/v0/bewerbungen/sweep`;
};

/**
 * Answer every season's id, oldest first, so the caller runs the clocks one season at a time, and the day each pass last ran.
 *
 * System tier rather than the base one: a season taking applications is `future`, which the base tier is never served,
 * and the two clocks that matter run over exactly those seasons.
 *
 * Null against this database means no pass has ever run, never that the last one found nothing to do: a pass that reminds
 * nobody and deletes nothing records the day exactly as a busy one does. Reading it writes nothing.
 * @summary Every season the sweep has to visit
 */
export const bewerbungenGetSweepSaisons = async (
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBewerbungSweepSaisonsResponse> => {
  return systemKeyTransport<FLBewerbungSweepSaisonsResponse>(getBewerbungenGetSweepSaisonsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenSweepSaisonUrl = (saisonId: string) => {
  return `/api/v0/bewerbungen/sweep/${saisonId}`;
};

/**
 * Run the six retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.
 *
 * The reminder clock stamps `erinnert_am` and mints a fresh link per seat BEFORE answering, so a failed mail costs one
 * person one reminder and never a repeat; the first link stays valid beside the fresh one. A seat whose last message the
 * mail provider refused is not chased at all, its one reminder buying nothing. A seat whose address the ban list holds is
 * sent nothing and has nothing written: it stays due, so every pass asks the ban list for it again until its deadline, and
 * reminds it once a lift comes first; each pass logs how many mailboxes it withheld, never which. The fourteen-day clock only
 * LISTS its candidates here, each saying whether its notice has already gone out -- the caller mails the rest, stamps the
 * delivered ones through `/angekuendigt` and erases every announced one through `/loeschen`. An application whose
 * Ansprechperson the provider refuses is listed by neither: it is held past its deadline for an administrator to
 * correct the address, because erasing it would destroy a school's application with nobody told. That hold ends with the
 * season: once the season applied for is `past`, every application still awaiting a decision is erased here, whatever its
 * seats answered and whether or not its notice could be delivered, because no decision can be taken for a season that is
 * over. That clock runs before the two above it, so an application it takes is neither chased nor listed for a notice. The
 * declined, accepted and contact-block clocks erase and redact in this call. Every removal names this season alone.
 *
 * One call reminds, lists and clears contact blocks for a bounded share of what is due, the first two earliest deadline
 * first; the rest stay due and the calls after it take them. The reminders are committed by the call's LAST transactions, so no later step
 * of the same call can answer an error in their place; where the request's deadline cuts them after one has committed, the call
 * answers what committed and warns once.
 *
 * An application or a season row whose write fails, the database refusing it or anything else, or one the answer cannot carry,
 * is passed over alone and logged by id: the rest of its clock's page or share goes, and it stays due, so the next pass meets it
 * again and one failing record holds back no clock and nobody behind it. `fehlgeschlagen` sums the rows each of the six clocks
 * passed over: a day stamped beside a sum that is not zero is a clock passing rows over, not one that ran clean.
 *
 * 404 where no season has the id. Idempotent per day once every share has been taken: a run after that writes nothing,
 * though it logs the count of withheld seats again.
 *
 * The accepted clock and the contact block run once a later season has ended while this one is not `active`, the moment the
 * season-after rule stops keeping this season's pupils: a running season keeps both, and a later season planned and never run
 * holds neither back. A season whose id is not a four-digit year fails the whole pass rather than running the four clocks
 * that need no later season, because a pass that skipped those two quietly would leave both stopped for ever with nothing
 * anywhere saying so. From that moment every pass also strips, on the rows and in their log images, the season's fixture
 * confirmation rows of every seat's link entry, each reason and a contact's holder digest, and its match
 * reports of their remarks and every card's reason; the answers' way, day and role and the reports' scorers, cards and
 * result stay as the record. Each strip is its own transaction after the blocks' share: one that fails is
 * logged under the season's id and counted in `fehlgeschlagen`, and the blocks clear all the same.
 *
 * One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
 * answers it. So a day's first call records the day and the rest of that day's calls record nothing.
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

export const getBewerbungenAngekuendigtBewerbungenUrl = (saisonId: string) => {
  return `/api/v0/bewerbungen/sweep/${saisonId}/angekuendigt`;
};

/**
 * Record that the deletion notice reached the applications named, so an erasure that fails afterwards mails nobody twice.
 *
 * An id whose stamp fails, the database refusing it or anything else, is passed over alone, logged by id, left unstamped and
 * counted in `fehlgeschlagen`. Every later pass then lists it as unannounced, so a caller mailing those mails its notice again,
 * and `/loeschen` skips it: until a stamp lands it stands until its season is `past`.
 *
 * The ids are re-judged in-session: only one still submitted, past its deadline and with a seat outstanding is stamped, and one
 * already carrying a stamp keeps the day it has. An id whose Ansprechperson the mail provider refused between the pass and this
 * call is skipped, so a notice the provider never carried is not recorded as delivered. 404 where no season has the id. An empty
 * list answers zero.
 * @summary Stamp the candidates whose notice was delivered
 */
export const bewerbungenAngekuendigtBewerbungen = async (
  saisonId: string,
  fLBewerbungSweepAngekuendigtPayload: FLBewerbungSweepAngekuendigtPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBewerbungSweepAngekuendigtResponse> => {
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
  return systemKeyTransport<FLBewerbungSweepAngekuendigtResponse>(getBewerbungenAngekuendigtBewerbungenUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungSweepAngekuendigtPayload),
  });
};

export const getBewerbungenLoeschenBewerbungenUrl = (saisonId: string) => {
  return `/api/v0/bewerbungen/sweep/${saisonId}/loeschen`;
};

/**
 * Erase the applications whose deletion notice went out, and redact every log row naming them.
 *
 * The ids are re-judged in-session: only one still submitted, past its deadline, with a seat outstanding, whose announcement the
 * mail provider will still carry AND carrying the announcement stamp is erased, so an application confirmed and accepted between
 * the calls survives, one whose notice bounced after it was stamped is held rather than destroyed, and an id from another
 * season or one nobody was told about is skipped rather than refused. 404 where no season has the id. An empty list answers zeros.
 *
 * An id whose erasure fails, the database refusing it or anything else, is passed over alone, logged by id, left standing and
 * counted in `fehlgeschlagen`.
 * @summary Erase the notified deletion candidates
 */
export const bewerbungenLoeschenBewerbungen = async (
  saisonId: string,
  fLBewerbungSweepLoeschenPayload: FLBewerbungSweepLoeschenPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBewerbungSweepLoeschenResponse> => {
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
  return systemKeyTransport<FLBewerbungSweepLoeschenResponse>(getBewerbungenLoeschenBewerbungenUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungSweepLoeschenPayload),
  });
};

export const getBewerbungenGetTrikotfarbenUrl = (saisonId: string) => {
  return `/api/v0/bewerbungen/trikotfarben/${saisonId}`;
};

/**
 * Answer which kit colours this season has assigned, so the form can offer the rest.
 *
 * 404 unless that season takes applications today, which is the one state the form reads this in.
 * The SET alone, naming no club (`READ-BEWERBUNG-001`).
 * @summary The kit colours a Saison has already assigned
 */
export const bewerbungenGetTrikotfarben = async (
  saisonId: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLBewerbungTrikotFarbenResponse> => {
  return baseKeyTransport<FLBewerbungTrikotFarbenResponse>(getBewerbungenGetTrikotfarbenUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenPostZustellungUrl = () => {
  return `/api/v0/bewerbungen/zustellung`;
};

/**
 * Record what the mail provider reported about one message, on every seat that message was sent to.
 *
 * Applied only where the event names the message the seat still holds AND is stamped strictly later than the state
 * it holds: a re-send mints a new message, so the old one's bounce must not mark the fresh link, and a redelivery or
 * an event overtaken by a later one changes nothing. Both are answered with the seats written -- none, where nothing
 * qualified -- rather than with a refusal, because the provider retries anything but a success and would resend a
 * settled event for hours.
 *
 * 404 where no application has the id, which an application erased between the send and the event is: a caller that
 * must not retry maps it rather than repeating the call.
 * @summary Apply one delivery event to the seats its message was sent to
 */
export const bewerbungenPostZustellung = async (
  fLBewerbungZustellungEreignisPayload: FLBewerbungZustellungEreignisPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBewerbungZustellungResponse> => {
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
  return systemKeyTransport<FLBewerbungZustellungResponse>(getBewerbungenPostZustellungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungZustellungEreignisPayload),
  });
};

export const getBewerbungenAngenommenZustellungUrl = () => {
  return `/api/v0/bewerbungen/zustellung/angenommen`;
};

/**
 * Record that the mail provider accepted one message for the seats named, under the id it answered with.
 *
 * That id is the only join between a send and any later delivery event, so a seat carrying none is a seat every event
 * about it is discarded for. Accepting a request is not delivering it: what this records is that the provider took the
 * message, and `POST /bewerbungen/zustellung` is where the recipient's own mail server is heard from.
 *
 * Applied per seat and only where this send is newer than the ACCEPT the seat already holds, so a call retried after
 * a later one landed writes nothing; a delivery state the provider stamped never blocks it, that stamp being the
 * provider's clock rather than this sender's. A seat the application does not hold -- erased, or never mailed -- is
 * skipped rather than refused, and the answer names the seats that were written. 404 where no application has the id.
 * @summary Record the message the provider accepted for these seats
 */
export const bewerbungenAngenommenZustellung = async (
  fLBewerbungZustellungAngenommenPayload: FLBewerbungZustellungAngenommenPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLBewerbungZustellungResponse> => {
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
  return systemKeyTransport<FLBewerbungZustellungResponse>(getBewerbungenAngenommenZustellungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungZustellungAngenommenPayload),
  });
};

export const getBewerbungenGetBewerbungByIdUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${bewerbungId}`;
};

/**
 * One application in full, which is what the triage decides against; its decision's administrator is withheld as the list withholds it.
 *
 * Answers whether its confirmation deadline has passed today, so the editor words the deletion without reading a day of its own.
 * @summary One Bewerbung
 */
export const bewerbungenGetBewerbungById = async (
  bewerbungId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungSingleResponse> => {
  return adminKeyTransport<FLBewerbungSingleResponse>(getBewerbungenGetBewerbungByIdUrl(bewerbungId), {
    ...options,
    method: "GET",
  });
};

export const getBewerbungenAblehnenBewerbungUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${bewerbungId}/ablehnen`;
};

/**
 * Decline an application, recording who decided and the reason they gave.
 *
 * The submission itself is untouched: a decline moves `status` and `entscheidung` and nothing else,
 * so what the school wrote stays the record the decision was taken against.
 * @summary Decline a Bewerbung
 */
export const bewerbungenAblehnenBewerbung = async (
  bewerbungId: string,
  fLAblehnenBewerbungPayload: FLAblehnenBewerbungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAblehnenBewerbungResponse> => {
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
  return adminKeyTransport<FLAblehnenBewerbungResponse>(getBewerbungenAblehnenBewerbungUrl(bewerbungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAblehnenBewerbungPayload),
  });
};

export const getBewerbungenAnnehmenBewerbungUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${bewerbungId}/annehmen`;
};

/**
 * Accept an application, creating the school's club where the applicant proposed a new one.
 *
 * IRREVERSIBLE. `saison_teams` has no DELETE, so a club entered in error leaves only through an
 * `austritt`, which is a public record carrying a stated reason. Refused while any contact person has yet to
 * confirm their own seat (`REQ-BEWERBUNG-013`), so every seat enters the season as its person confirmed it.
 * @summary Accept a Bewerbung and enter the school into the season
 */
export const bewerbungenAnnehmenBewerbung = async (
  bewerbungId: string,
  fLAnnehmenBewerbungPayload: FLAnnehmenBewerbungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAnnehmenBewerbungResponse> => {
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
  return adminKeyTransport<FLAnnehmenBewerbungResponse>(getBewerbungenAnnehmenBewerbungUrl(bewerbungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLAnnehmenBewerbungPayload),
  });
};

export const getBewerbungenErneutEinwilligungUrl = (bewerbungId: string, seat: string) => {
  return `/api/v0/bewerbungen/${bewerbungId}/einwilligung/${seat}/erneut`;
};

/**
 * Mint a fresh link for one seat and answer it raw, for the caller to mail; the old link then opens nothing.
 *
 * Where one person holds two seats both entries are replaced, so the old links die on both and the one new link answers both.
 * The answer names the address and the seats as the write found them, so a correction landing mid-request is where the link goes.
 * The application's confirmation deadline restarts from today and the seat's reminder is owed again. The mirrored seat
 * is judged with the pressed one, a seat an erasure emptied is refused as an answered one is, and a
 * decision, an answer or an erasure landing while the request runs is refused too. A seat whose address the ban list
 * holds is refused `REQ-BEWERBUNG-019`. A path naming no seat is a 404.
 * @summary Re-send one seat's confirmation link
 */
export const bewerbungenErneutEinwilligung = async (
  bewerbungId: string,
  seat: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungEinwilligungErneutResponse> => {
  return adminKeyTransport<FLBewerbungEinwilligungErneutResponse>(getBewerbungenErneutEinwilligungUrl(bewerbungId, seat), {
    ...options,
    method: "POST",
  });
};

export const getBewerbungenBesetzeKontaktSitzUrl = (bewerbungId: string, seat: string) => {
  return `/api/v0/bewerbungen/${bewerbungId}/kontakte/${seat}`;
};

/**
 * Write another person into a seat its own holder stepped out of, and mint the fresh link to mail them.
 *
 * It runs on an EMPTY seat alone, and the one thing that empties a seat this way is that person's own Widerspruch.
 * The record written is administrative and confirms nothing: the new person's own link is what asks them, and an
 * acceptance waits on that answer as it waits on the other two. Where one person holds two seats both are filled
 * from one press and one link answers both, and both must be empty for either to be written.
 *
 * The link the seat's last holder was sent stops opening anything, and the application's confirmation deadline
 * restarts from today EVEN WHERE IT HAD PASSED: left where it was, it would hand the new person a link that opens
 * nothing, seating them for a confirmation they cannot give.
 *
 * Refused on an application already decided (`REQ-BEWERBUNG-001`); on any seat this write would reach that nobody
 * stepped out of — confirmed, still waiting or erased at its person's request, the claimed mirror included
 * (`REQ-BEWERBUNG-011`); and on an address another
 * contact person on this application already holds (`REQ-BEWERBUNG-014`), or that the ban list holds
 * (`REQ-BEWERBUNG-019`); and on any label but the application form's running one (`REQ-EINWILLIGUNG-001`), the person
 * seated being a new acceptance. A path naming no seat is a 404.
 * @summary Seat another person where a contact person stepped out
 */
export const bewerbungenBesetzeKontaktSitz = async (
  bewerbungId: string,
  seat: string,
  fLBewerbungKontaktSitzPayload: FLBewerbungKontaktSitzPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungKontaktSitzResponse> => {
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
  return adminKeyTransport<FLBewerbungKontaktSitzResponse>(getBewerbungenBesetzeKontaktSitzUrl(bewerbungId, seat), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungKontaktSitzPayload),
  });
};

export const getBewerbungenKorrigiereKontaktEmailUrl = (bewerbungId: string, seat: string) => {
  return `/api/v0/bewerbungen/${bewerbungId}/kontakte/${seat}/email`;
};

/**
 * Write a corrected address onto one seat and mint the fresh link to mail there; the old link then opens nothing.
 *
 * **The mailbox the link leaves is answered in `abgang_email`** for the caller to tell, as the contacts editor's save
 * answers one it takes off a seat; null where the corrected address is the one the seat held.
 *
 * The only repair there is for a link the mail provider will not carry: everything else the school typed stays the
 * record the decision is taken against. Where one person holds two seats both are corrected, and the confirmation
 * deadline restarts from today exactly as a re-send restarts it.
 *
 * The seat's delivery state goes with the entry it sat in, so an application held back from the fourteen-day
 * deletion because its notice could not arrive is a deletion candidate again once the corrected link is answered
 * for or its deadline passes. Refused on an application already decided (`REQ-BEWERBUNG-001`), on any seat this
 * write would reach that is already confirmed, already answered with a Widerspruch, or holding nothing to confirm
 * — the mirrored seat included (`REQ-BEWERBUNG-011`) — on a seat holding another address than `bisherige_email`, the address the
 * caller's page showed, as after a Widerspruch and a reseat (`REQ-BEWERBUNG-021`), and on an address another contact person on this
 * application already holds (`REQ-BEWERBUNG-014`), or that the ban list holds (`REQ-BEWERBUNG-019`). A path naming
 * no seat is a 404.
 * @summary Correct one contact person's email address and re-send their link
 */
export const bewerbungenKorrigiereKontaktEmail = async (
  bewerbungId: string,
  seat: string,
  fLBewerbungKontaktEmailPayload: FLBewerbungKontaktEmailPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungKontaktEmailResponse> => {
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
  return adminKeyTransport<FLBewerbungKontaktEmailResponse>(getBewerbungenKorrigiereKontaktEmailUrl(bewerbungId, seat), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungKontaktEmailPayload),
  });
};

export const getBewerbungenPatchEinwilligungUrl = (bewerbungId: string) => {
  return `/api/v0/bewerbungen/${bewerbungId}/person/einwilligung`;
};

/**
 * Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application.
 *
 * WITHDRAW-ONLY: the season seat's payload, a grant of either choice being the confirmation page's alone; the
 * account page offers it so taking a consent back is as easy as giving it was (Art. 7(3) DSGVO). One answer for
 * every seat the person holds there, each choice moving only where it differs from the application as the page
 * served it; no other seat, field or document is written, and a press moving no seat writes nothing. Nothing is
 * counted against the person's ceiling.
 *
 * Refuses, in this order: an application that is decided or holds no confirmed seat of the address
 * (`REQ-FUNKTION-001`); a `nachweis_stand` other than the held seats' own, either choice having moved since the
 * page was served (`REQ-EINWILLIGUNG-003`); a grant of either choice (`REQ-EINWILLIGUNG-004`); and a `text_version`
 * naming no version of the account page's seat control (`REQ-EINWILLIGUNG-001`). Each refusal writes nothing.
 * @summary Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung
 */
export const bewerbungenPatchEinwilligung = async (
  bewerbungId: string,
  fLBewerbungPersonEinwilligungPayload: FLBewerbungPersonEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLBewerbungPersonEinwilligungResponse> => {
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
  return adminKeyTransport<FLBewerbungPersonEinwilligungResponse>(getBewerbungenPatchEinwilligungUrl(bewerbungId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLBewerbungPersonEinwilligungPayload),
  });
};

export const getEinwilligungGetFassungUrl = (textVersion: string) => {
  return `/api/v0/einwilligung/fassungen/${textVersion}`;
};

/**
 * Return the words a consent label names: its paragraphs, its switch, its other controls, its page and the day it took effect.
 *
 * A label's words never change, so the answer may be cached. A label the registry does not hold 404s,
 * and never answers another label's words.
 * @summary The words one consent label names
 */
export const einwilligungGetFassung = async (
  textVersion: string,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLEinwilligungFassungResponse> => {
  return baseKeyTransport<FLEinwilligungFassungResponse>(getEinwilligungGetFassungUrl(textVersion), {
    ...options,
    method: "GET",
  });
};

export const getEinwilligungGetSeitenUrl = () => {
  return `/api/v0/einwilligung/seiten`;
};

/**
 * Return, for every page that stamps a consent label, the label a new acceptance on it must name.
 *
 * A deploy moves it, so a reader caching it refuses its own visitors' presses until the cache expires.
 * @summary The consent label each page stamps today
 */
export const einwilligungGetSeiten = async (options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLEinwilligungSeitenResponse> => {
  return baseKeyTransport<FLEinwilligungSeitenResponse>(getEinwilligungGetSeitenUrl(), {
    ...options,
    method: "GET",
  });
};

export const getIdentitaetPostAbmeldungUrl = () => {
  return `/api/v0/identitaet/abmeldung`;
};

/**
 * File one log row saying that this administrator ended every session of an address, and when, before the caller ends them.
 *
 * ADMIN TIER, a step-up write. The sessions live in the sign-in store, which the caller holds and this backend does not, so
 * the row is the whole of what this writes: collection `anmeldungen`, operation `delete_many`, the administrator as actor,
 * and no address, filter, image or count. Nothing bars the address and nothing is mailed; a person signs in again as before.
 *
 * Refused so that a refused call ends no session: from a sign-in older than the step-up window (`REQ-AUTH-009`), the
 * administrator's own address (`REQ-PURGE-003`), an address holding an `owner` grant unless the administrator holds an
 * owner's power (`REQ-PURGE-005`). Unlike the erasure, it
 * ends another administrator's sessions for an administrator holding no owner's power: signing in again repairs it.
 * @summary Log the ending of every session an address holds
 */
export const identitaetPostAbmeldung = async (
  fLErasureAdressePayload: FLErasureAdressePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLAbmeldungResponse> => {
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
  return adminKeyTransport<FLAbmeldungResponse>(getIdentitaetPostAbmeldungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLErasureAdressePayload),
  });
};

export const getIdentitaetGetAnmeldungUrl = () => {
  return `/api/v0/identitaet/anmeldung`;
};

/**
 * Answer what the sign-in gate decides on for one mailbox: its own records, its pending confirmation, its ban and its grant.
 *
 * No record, name or id is answered, only flags and the grant's tier. Stores nothing, and a POST for `POST /identitaet/subjekt`'s
 * reason. The address is folded on arrival and compared as that endpoint compares it, and `unbestaetigt`, `gesperrt` and
 * `verwaltung` are that endpoint's own answers.
 *
 * `konto` is true exactly where the mailbox holds a record its own person confirmed: a contact seat on any season row, a past
 * season's and a withdrawn team's included; a contact seat on a pending application; a pupil or referee record, a retired one
 * included, never the placeholder every erased referee's fixtures name; and a pending registration whose pupil confirmed it with
 * a choice. A decided application, a declined registration and every unconfirmed record count for nothing. It holds wherever
 * `POST /identitaet/subjekt` answers a record, and also where the only records are ones granting no panel.
 *
 * The ban narrows neither flag: a barred address holding records is answered `gesperrt` and `konto` both, and refusing it is the
 * caller's. A mailbox the league holds nothing for is answered both flags false rather than a 404.
 * @summary Say whether one mailbox may be offered a sign-in
 */
export const identitaetGetAnmeldung = async (
  fLSubjektPayload: FLSubjektPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLAnmeldungResponse> => {
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
  return systemKeyTransport<FLAnmeldungResponse>(getIdentitaetGetAnmeldungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSubjektPayload),
  });
};

export const getIdentitaetEraseAufAnfrageUrl = () => {
  return `/api/v0/identitaet/erasure`;
};

/**
 * Erase every record an address holds, on a request that person made by mail, at once and as one write, and answer how many of each kind went.
 *
 * ADMIN TIER, a step-up write. It runs the erasure `POST /identitaet/selbst/erasure` runs and refuses nothing about the
 * person's own state: a pupil in a live squad and a referee booked on a fixture still to be played are erased on one pass.
 * Three refusals are about who asks. The administrator's own address is refused (`REQ-PURGE-003`): their account page
 * serves it, or an owner. An address holding a live grant is refused unless the administrator holds an owner's power,
 * signed in since becoming one (`REQ-PURGE-005`), judged inside the write: erasing it removes the grant, whatever grants
 * remain, so it asks what a revoke asks, an owner's power and a sign-in `ENROLMENT_WINDOW_MINUTES` old at most. Every
 * other address is erased from a sign-in inside the step-up window. Either window missed answers `REQ-AUTH-009`. An
 * address another address's pending change would move to is refused, judged inside the write, where that address holds a
 * live grant and the administrator no owner's power (`REQ-PURGE-007`): the erasure ends the change, a discard only an
 * owner makes of it. The refusal tells that administrator some change the preview withholds names the address.
 *
 * `anlass` names the request the erasure answers, and every log row the erasure files carries it; no other row does. No
 * redaction reaches it, so it is refused 422 where it holds an address, and, inside the write ahead of the erasure's first
 * step, where it holds a name of the person's own records as a whole word or before a genitive s (`REQ-PURGE-006`): each
 * name field whole and each of its words, but a particle such as `von` before a later word of its field and any single
 * letter. Names compare as stored, spacing aside, and equal where their plain lower or their plain upper case is: „Weiss“
 * is refused for „Weiß“, whose capitals it shares, and another spelling such as „Mueller“ for „Müller“ passes. A common
 * word equal to a name is refused with it. The grant notice names this administrator as ending the
 * person's grant. An address holding nothing is answered with every count zero. The 404 and the 409 answer only a database
 * changed by hand under the request. The sign-in account is not touched here: deleting it is the caller's, once this has
 * answered.
 * @summary Erase every record an address holds, on that person's request
 */
export const identitaetEraseAufAnfrage = async (
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
  return adminKeyTransport<FLErasureResponse>(getIdentitaetEraseAufAnfrageUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLErasurePayload),
  });
};

export const getIdentitaetGetErasureAnsichtAufAnfrageUrl = () => {
  return `/api/v0/identitaet/erasure/ansicht`;
};

/**
 * Answer which of this address's records `POST /identitaet/erasure` would remove or empty, by kind, name and the ids a page links each by.
 *
 * ADMIN TIER. Takes that erasure's own payload address and reads through its own selections in one snapshot, so it names
 * every one of them, an unconfirmed seat, a retired row, a pupil's every squad row and a declined registration among them,
 * and no other. Another address's pending change to this address is named by its id, the change going and that address's
 * records standing, beside why the address tool refuses that change this administrator, or null where it opens it; a change
 * of an address holding a grant is left out for an administrator without an owner's power, as the administrators page
 * withholds it, since naming it would answer whether a typed address is its new one. The address's own live change is
 * named by its id, ending with the records it would move. Every request for a grant about the address (`betroffen`) or
 * made by it (`gestellt`) is named by its id and the tier it asks; a lapsed one is gone to every reader already and is
 * left out, though the erasure removes its row too. A squad
 * row and a referee row each carry the day it was retired, null while live, and a referee row every season holding a
 * fixture still to be played that it is booked on, as `REQ-RETIRE-004` judges one. Reached and not named: the fixtures
 * booking a referee row, which move onto the ghost, and the referee's name in each of those fixtures' log images, which
 * goes; the match reports a referee row sent, which stand naming the ghost, in
 * their log images too; the confirmations a referee row was asked for, which go, and its id
 * and reason in a removed season's log images; the links its contact seats were mailed on their teams' open match
 * confirmations, which stop answering; every reason typed from the address answering a match confirmation, from any seat,
 * which goes from its row and its log images, the answer standing; the grants, bans, invitations and decisions the address made for
 * others, which name a marker in its place; its day counts; its rows in the log; every log image of a record the
 * erasure removes, emptied whole whether or not it holds the address, and every other log image holding the address;
 * a dead spelling of its grant, which admits nobody, each grant's announced row, and an announced row holding the
 * address under another grant's id; and the address in every notice still queued, withheld. Written besides: the
 * notice that the address's grant ended, which every administrator is sent. No address and no birthdate is answered.
 * `verwaltung` is the tier of the live grant the address holds, or null. `gesperrt` is whether a standing ban holds the
 * address, judged as `POST /identitaet/gesperrt` judges one; the erasure leaves a ban standing. Stores nothing.
 *
 * Refused as the erasure is: the administrator's own address (`REQ-PURGE-003`), an address holding a live grant unless
 * the administrator holds an owner's power (`REQ-PURGE-005`).
 * @summary Show what an erasure of an address would remove
 */
export const identitaetGetErasureAnsichtAufAnfrage = async (
  fLErasureAdressePayload: FLErasureAdressePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLErasureAnsichtResponse> => {
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
  return adminKeyTransport<FLErasureAnsichtResponse>(getIdentitaetGetErasureAnsichtAufAnfrageUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLErasureAdressePayload),
  });
};

export const getIdentitaetGetGesperrtUrl = () => {
  return `/api/v0/identitaet/gesperrt`;
};

/**
 * Answer whether a standing ban holds the one address the frontend's mailer is about to send to.
 *
 * Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the address travels in the body, so no path or query carries it
 * into an access line.
 *
 * The address is judged as a stored one is: every spelling that folds to the same mailbox -- its letters in any case, its domain in
 * Unicode or in punycode -- answers alike, and a ban holds only while the running season is within its bound, every ban holding
 * while no season runs. An address today's address rule refuses is answered `false` rather than refused, no ban being keyable
 * under it: the mailer sends to the addresses records hold, some of them stored under older rules.
 *
 * The flag is the whole answer. No record the address holds and no part of the ban reaches the caller, which needs neither.
 * @summary Say whether a ban stands on an address about to be mailed
 */
export const identitaetGetGesperrt = async (
  fLGesperrtPayload: FLGesperrtPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLGesperrtResponse> => {
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
  return systemKeyTransport<FLGesperrtResponse>(getIdentitaetGetGesperrtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLGesperrtPayload),
  });
};

export const getIdentitaetPostLoeschungLaufUrl = (params?: IdentitaetPostLoeschungLaufParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/identitaet/loeschung/lauf?${stringifiedParams}` : `/api/v0/identitaet/loeschung/lauf`;
};

/**
 * Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.
 *
 * The rule, read from the seasons' stored statuses at each call: a pupil is due once they hold no squad row, live or retired,
 * in the latest `past` season, in any season with a greater id or in the running one, and no registration still `eingereicht`
 * at their address, compared as the sign-in folds it. While no season is `past` nobody is due, and `abgeschlossene_saison_id`
 * is null. A pupil holding no address is never due: nothing else erases by a name. A pupil whose stored address no request
 * matches, empty, unfolded or refused by the address rule, is passed over and named by id in a warning: a hand correction
 * left it so, and an erasure by another spelling would remove nobody.
 *
 * Each pupil is deleted in a transaction of their own, which first judges them again: one who has gained a squad row or a
 * pending registration since this call read them, the two committing before that transaction writes included, or whom another
 * call deleted first, is counted `uebersprungen` and left standing. A squad entry or a registration meeting that transaction's
 * writes waits for it to end: the entry then finds nobody, and the registration is stored for a pupil already gone.
 * Two calls at once therefore delete each pupil once. Deleted are
 * the pupil's own data alone: the pupil record, every squad row it holds and every registration at the address, a declined
 * one included, each with its log images, and their day counts as a pupil; every log row they wrote as a pupil keeps a
 * fixed marker in their place. A contact seat, a referee record, a grant and anything else held at the same
 * address stand, and so do the log images naming them.
 *
 * **A pass is a run of calls, each handing the next the `nach` the last answered**, the first naming none; it ends at the call
 * answering `nach` null. A call reaches at most a fixed share of the due pupils after `nach`, in `_id` order, and the pass
 * holds no state on the server. A pupil whose deletion fails, the database refusing it or anything else, is counted
 * `fehlgeschlagen`, logged by id and passed, so a failing record holds back nobody behind it in the pass; it stays due, and
 * the next pass tries it again. Where the request's deadline cuts the call, it stops at that pupil, warns once, and answers
 * what it did; the rest stay due, and the pass goes on from the next call. `verbleibend` counts the pupils due after the
 * call, those it failed or passed over among them, so it is no stopping condition. No body: the call takes no season and no
 * limit.
 *
 * The 409 is published because the duplicate-key trace reaches the registry's insert of the pupils' sentinel and reads no
 * handler; this call counts that failure as any other and never answers it.
 * @summary Delete one share of the pupils the season-after rule makes due
 */
export const identitaetPostLoeschungLauf = async (
  params?: IdentitaetPostLoeschungLaufParams,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLLoeschungLaufResponse> => {
  return systemKeyTransport<FLLoeschungLaufResponse>(getIdentitaetPostLoeschungLaufUrl(params), {
    ...options,
    method: "POST",
  });
};

export const getIdentitaetGetReferenzenUrl = () => {
  return `/api/v0/identitaet/referenzen`;
};

/**
 * Answer which of the addresses asked about no league record references, so the sign-in account each names may be deleted.
 *
 * Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the addresses travel in the body.
 *
 * An address is referenced, and so never answered, while any of these holds:
 *
 * - a contact seat on any season row holds it, a `past` season's and a withdrawn team's included, confirmed or not;
 * - a contact seat on a pending application holds it, confirmed or not;
 * - a pupil or referee record holds it, confirmed or not and live or retired; the placeholder every erased referee's fixtures
 *   name and the one every erased pupil's entries name hold nothing;
 * - a pending registration holds it that its pupil confirmed;
 * - a grant in `berechtigungen` holds it, as stored, before the comparison has seen it too;
 * - an address change that took effect replaced it, and the notice owing its sign-in account's carry to the new address is
 *   not yet delivered.
 *
 * A ban holds nothing: a barred address is answered as any other once none of these holds it. A pending address change holds
 * nothing either: its new address admits no sign-in until the change takes effect, and the address it replaces stays on the
 * records until then.
 *
 * That is wider than what `POST /identitaet/anmeldung` admits a sign-in on, so no account answered here is one the sign-in
 * would admit again: an unconfirmed seat on a `past` season and an unconfirmed retired record keep an account the gate admits
 * no sign-in for, until the block is cleared or the row removed.
 *
 * The whole batch is refused, `REQ-REFERENZEN-001`, while no live grant in `berechtigungen` is an `owner`'s. A league always
 * holds one, so such a database is empty or another one, and answering from it would call every address unreferenced.
 *
 * Each address is compared as `POST /identitaet/subjekt` compares one, on the sign-in fold, and answered in the spelling it was
 * asked in, once however often it was asked. An address today's address rule refuses is judged as any other and never
 * refused, since one refused address would refuse the whole batch. A batch past its published ceiling is refused whole.
 * @summary Say which of these sign-in addresses no record references
 */
export const identitaetGetReferenzen = async (
  fLReferenzenPayload: FLReferenzenPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLReferenzenResponse> => {
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
  return systemKeyTransport<FLReferenzenResponse>(getIdentitaetGetReferenzenUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLReferenzenPayload),
  });
};

export const getIdentitaetEraseSelbstUrl = () => {
  return `/api/v0/identitaet/selbst/erasure`;
};

/**
 * Erase every record the signed-in address holds, at once and as one write, and answer how many of each kind went.
 *
 * PERSON TIER. The last live, unbarred `owner` of the administration is refused until another administrator is made one
 * (`REQ-PURGE-004`), since nobody else could ever make an owner again; a person holding a live grant erases it with the rest
 * from a passkey sign-in `ENROLMENT_WINDOW_MINUTES` old at most, as a revoke asks, else `REQ-AUTH-009`. No other
 * precondition stands in front of a person's own request, a pupil in a live squad and a referee booked on a fixture still
 * to be played included. Nothing is counted against the person's day.
 *
 * Removed: the pupil record and every squad row it holds, so the team reads one player fewer; the referee record, every
 * fixture it was booked on moving to the one row that holds no person and keeping its own fee, and every confirmation it
 * was asked for, answered or not; every registration at the address, pending or declined; another address's pending
 * change naming this one as its new address, every record it would move standing at its own; every grant the address
 * holds, an `owner` grant and the last two among them, every administrator being told it ended; and the person's day
 * counts. Emptied: every contact seat the address holds on a team's season row and on an
 * application of any status, the row and its other seats standing, an emptied seat's links on its team's open match
 * confirmations stopping to answer. Every reason the person typed answering a match confirmation, from any seat they held,
 * goes from its row and its log images, the answer standing. Every match report the referee record sent stands, its
 * remarks and entries included, naming the row that holds no person in its place, in its log images too. Every record
 * the person made as an administrator or
 * decided as a seat holder -- a grant, a ban, an invitation, an application's or a registration's decision -- and every
 * log row they wrote name a fixed marker in their place, this erasure's own rows included. The log images of the removed
 * records are emptied, and every other image holding the address loses it, the people beside them keeping theirs.
 *
 * An address holding nothing is answered with every count zero rather than refused. The 409 answers only a database
 * changed by hand, a second nameless referee meeting the ghost's name index. The 404 is published for the steps' reads by
 * id, which no request can meet: every id comes from the subject read in the same snapshot. The sign-in account is not
 * touched here: deleting it is the caller's, once this has answered.
 * @summary Erase every record the signed-in address holds
 */
export const identitaetEraseSelbst = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLErasureResponse> => {
  return adminKeyTransport<FLErasureResponse>(getIdentitaetEraseSelbstUrl(), {
    ...options,
    method: "POST",
  });
};

export const getIdentitaetGetErasureAnsichtUrl = () => {
  return `/api/v0/identitaet/selbst/erasure/ansicht`;
};

/**
 * Answer what `POST /identitaet/selbst/erasure` would remove for the signed-in address, by kind and by name.
 *
 * Read through that erasure's own selections in one snapshot, so it names every record of the person's own the erasure
 * removes or empties, an unconfirmed seat, a retired row and a declined registration among them, and no other. No address
 * and no birthdate is answered. Another address's pending change naming this one is counted and not named, once its link
 * has reached this mailbox: its records are not this address's until it takes effect. Reached and not named: the fixtures booking
 * their referee record, which move onto the ghost, and their name in each of those fixtures' log images, which goes; the
 * confirmations their referee record was asked for, which go, and its id and reason in a removed season's log images;
 * the match reports their referee record sent, which stand naming the ghost, in their log images too;
 * the links their contact seats were mailed on their teams' match confirmations, answered and closed ones too, which stop
 * answering, and those links and their mails' delivery records in the confirmations' log images, which go; every reason
 * they typed answering a match confirmation, from any seat they held, which goes from its row and its log images, the
 * answer standing; what the person made or decided for others, which names a marker in their place; their day counts; every
 * request for a grant about their address or made by it, which goes; their rows in the
 * log; every log image of a record the erasure removes, emptied whole whether or not it holds the address, and every
 * other log image holding the address; each grant's announced row, and an announced row holding the address under
 * another grant's id; and the address in every notice still queued, withheld. Written besides: the notice that their
 * grant ended, which every administrator is sent. `verwaltung` is the tier of the live grant the address holds, or
 * null; a dead spelling of the address, which admits nobody, goes with the erasure unnamed.
 *
 * `letzter_inhaber` says whether the press would be refused `REQ-PURGE-004` as the grants stand at this read: the address
 * holds the last live `owner` grant, a barred owner counting as none. Read outside the press's transaction, it is advisory;
 * the press judges again, and its answer alone decides.
 * @summary Show what an erasure of the signed-in address would remove
 */
export const identitaetGetErasureAnsicht = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSelbstErasureAnsichtResponse> => {
  return adminKeyTransport<FLSelbstErasureAnsichtResponse>(getIdentitaetGetErasureAnsichtUrl(), {
    ...options,
    method: "GET",
  });
};

export const getIdentitaetGetSubjektUrl = () => {
  return `/api/v0/identitaet/subjekt`;
};

/**
 * Answer which confirmed contact seats, pupil records and referee records the league holds for one mailbox.
 *
 * Stores nothing, and a POST all the same: the identifier travels in the body so that no path or query carries an address into an
 * access line, which is `POST /identitaet/erasure/ansicht`'s reason too.
 *
 * The address is folded to the sign-in identifier -- trimmed, its domain in punycode, its ASCII letters lower-cased -- on arrival
 * and matched by equality, every record storing its address in that form: `Anna.Mueller@Schule.de` asked answers for the
 * `anna.mueller@schule.de` a contact seat stores, and a domain asked as `müller.de` for the `xn--mller-kva.de` a record stores. `ß`
 * is not folded to `ss`, so `poststrasse.de` and `poststraße.de` are two domains here as they are at sign-in.
 *
 * A record is answered only once its own person has confirmed it -- a seat's `einwilligung.bestaetigt_am`, judged per seat, and the
 * same stamp on a pupil's and a referee's consent record, an empty stamp confirming nothing -- and only while its row is live: a
 * retired pupil or referee is answered nothing, and so is the placeholder every erased referee's fixtures name. A seat on a season
 * its team withdrew from, by disqualification or withdrawal alike, is answered nothing either; its seats on other seasons stand.
 * A seat on a `past` season is still answered, carrying its `saison_status`: which seasons grant a panel is each caller's to decide.
 *
 * `unbestaetigt` is true exactly where the mailbox holds records that could grant a panel -- a live pupil or referee row, or a seat
 * on an `active` or `future` season -- and none of them is confirmed, so an unconfirmed person is told apart from one the league
 * holds nothing for. A seat on a `past` season counts toward neither answer: confirming it would open nothing.
 *
 * `gesperrt` says whether the address is on the ban list, judged as a sign-up is: the address in any spelling that folds to the same
 * mailbox, and a ban only while the running season is within its bound. It narrows none of the records beside it.
 *
 * `verwaltung` is the grant the mailbox holds in `berechtigungen` -- `owner`, `administration`, or null for none -- matched on the
 * folded identifier alone, the one spelling a grant is stored in. It is the one stored answer here: whether a person is an
 * administrator is decided by a grant rather than derived from a league record, and it narrows none of the records beside it. A
 * promotion to `owner` made in the database is answered `administration` until `POST /berechtigungen/abgleich` finds it.
 *
 * `berechtigt_seit` is when that grant took effect, null exactly where `verwaltung` is: the moment `POST /berechtigungen/abgleich`
 * first found a grant made in the database directly, the grant's own `erteilt_am` for one made through the application, and for one
 * made in the database that no call to that endpoint has read yet, its `erteilt_am` or the moment its id was generated, whichever is
 * later. A row changed in the database after that endpoint read it -- an address changed in place, a spelling no request matched
 * made one that does, a row put back after its removal was found -- is no grant, `verwaltung` null, until that endpoint finds the
 * change. A tier change leaves it standing. An admin-tier request from a sign-in older than it is refused.
 *
 * `inhaber_seit` is when the `owner` tier took effect, null exactly where `verwaltung` is not `owner`: the moment the tier change
 * made the grant an owner's, or that endpoint found a promotion made in the database, and never earlier than `berechtigt_seit`. A
 * sign-in older than it administers and holds no owner's power, so the revoke and the tier change it asks for are refused. A
 * demotion takes the tier at once.
 *
 * Each list may be empty and each may hold more than one entry: one person holds seats at two clubs, and nothing enforces one pupil
 * record per address.
 * An address the league holds nothing for is answered with three empty lists and `unbestaetigt` false rather than a 404.
 * @summary Say which league records one mailbox holds
 */
export const identitaetGetSubjekt = async (
  fLSubjektPayload: FLSubjektPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSubjektResponse> => {
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
  return systemKeyTransport<FLSubjektResponse>(getIdentitaetGetSubjektUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSubjektPayload),
  });
};

export const getKontoDeleteAdresswechselUrl = () => {
  return `/api/v0/konto/adresswechsel`;
};

/**
 * Stop the change pending on the signed-in address, the stop link's twin: its new address goes, out of every log image too.
 *
 * Asks no fresh confirmation and counts nothing: a stop hands nothing over. 404 where no change is pending on the address.
 * @summary Stop the address change pending on the signed-in person
 */
export const kontoDeleteAdresswechsel = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLKontoAdresswechselResponse> => {
  return adminKeyTransport<FLKontoAdresswechselResponse>(getKontoDeleteAdresswechselUrl(), {
    ...options,
    method: "DELETE",
  });
};

export const getKontoGetAdresswechselUrl = () => {
  return `/api/v0/konto/adresswechsel`;
};

/**
 * Answer whether the signed-in address holds anything its own change moves, and the change pending on it.
 *
 * PERSON TIER. `moeglich` where the address holds a pupil row, a confirmed referee row, a confirmed contact seat, a
 * registration or a grant. **The pending address is served masked where an administrator started the change**, whole
 * only where the person typed it here: a change an administrator started may be a pretext whose target the holder of
 * the address on file must not learn. `genehmigung` is the approval a change moving the person's grant waits on;
 * `abgelaufen` says the step the change waits on lapsed, whose press is refused until the hourly pass ends the change.
 * @summary Whether a signed-in person may change their address
 */
export const kontoGetAdresswechsel = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLKontoAdresswechselResponse> => {
  return adminKeyTransport<FLKontoAdresswechselResponse>(getKontoGetAdresswechselUrl(), {
    ...options,
    method: "GET",
  });
};

export const getKontoPostAdresswechselUrl = () => {
  return `/api/v0/konto/adresswechsel`;
};

/**
 * Start a change of the address the person signs in on, answering both raw links once, for the frontend's server to mail.
 *
 * The new mailbox is mailed its link, and the address on file a notice with a stop link; **everything the address holds
 * as its person's own moves when the new mailbox confirms**, within `ADRESSWECHSEL_GUELTIG_STUNDEN`. Where it holds a
 * grant, the change also waits on another administrator's approval, an owner's for an owner's grant,
 * `genehmiger_anzahl` counts who could give it, and the grants' outbox tells them (`POST /berechtigungen/abgleich`). The address's live
 * change ends replaced, an administrator's too: a sign-in at the address on file proves the mailbox is not lost.
 * **Nothing about the new address is judged here** -- the ban list, another pupil, a grant it holds -- so this start
 * answers alike whatever the new address holds.
 *
 * Refused `REQ-AUTH-009` from a sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES`, or by code where the
 * address holds a grant;
 * `REQ-ADRESSWECHSEL-010` where the address holds nothing a change moves; `-007` where the typed address is the one
 * signed in; `-011` where nobody could approve the grant's move, the last owner making another first; and
 * `REQ-DROSSELUNG-001` past the day's count of starts and approvals.
 * @summary Start a change of the signed-in person's address
 */
export const kontoPostAdresswechsel = async (
  fLKontoAdresswechselPayload: FLKontoAdresswechselPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKontoAdresswechselMintResponse> => {
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
  return adminKeyTransport<FLKontoAdresswechselMintResponse>(getKontoPostAdresswechselUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLKontoAdresswechselPayload),
  });
};

export const getKontoPostAdresswechselFreigabeUrl = () => {
  return `/api/v0/konto/adresswechsel/freigabe`;
};

/**
 * Approve the change `id` names, which an administrator started without a reason, minting the new mailbox's link once.
 *
 * **Nothing reaches the new mailbox before this press**. Nothing about the new address is
 * judged here either: the approver is owed no answer about it, and the confirmation judges it. **The press approves the
 * change its page showed alone**: an administrator's later start replaces that one, and its id then names an ended change.
 *
 * Refused `REQ-AUTH-009` as the start is; `REQ-ADRESSWECHSEL-002` where the change `id` names has ended; 404 where it
 * is no change of this address awaiting its approval; `REQ-ADRESSWECHSEL-003` past the approval's deadline; and
 * `REQ-DROSSELUNG-001` as the start is.
 * @summary Approve the address change an administrator asked of the signed-in person
 */
export const kontoPostAdresswechselFreigabe = async (
  fLKontoAdresswechselFreigabePayload: FLKontoAdresswechselFreigabePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKontoAdresswechselFreigabeResponse> => {
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
  return adminKeyTransport<FLKontoAdresswechselFreigabeResponse>(getKontoPostAdresswechselFreigabeUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLKontoAdresswechselFreigabePayload),
  });
};

export const getKontoGetEinwilligungenUrl = () => {
  return `/api/v0/konto/einwilligungen`;
};

/**
 * Answer every confirmed consent record the signed-in address holds, its pupil, referee and contact-seat records alike.
 *
 * The seats come one entry per team season on which the address holds a confirmed seat, however many of its slots;
 * `bewerbungen` one per PENDING application on which it does, whose two choices the account page may only withdraw;
 * `registrierungen` one per pending registration its pupil confirmed, withdraw-only alike until the admission; a
 * returning pupil's asked no choice, so it serves its stored data with both choices null and offers nothing to press.
 *
 * PERSON TIER, for the account page, which every signed-in person reaches: an address holding nothing is answered
 * `spieler: null` and four empty lists, never refused. A retired record, a past season's seat and a withdrawn team's
 * seat are served too, a withdrawal staying open wherever a consent stands; `kontext` carries what the record's
 * confirmation page filled its words with, as those records stand today; `erteilbar` says whether a grant is
 * admitted, `medien_angeboten` whether the media consent may be switched on. A record awaiting its person's
 * confirmation is not served: there is nothing on it yet to change.
 * @summary A signed-in person's own consent records
 */
export const kontoGetEinwilligungen = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLKontoEinwilligungenResponse> => {
  return adminKeyTransport<FLKontoEinwilligungenResponse>(getKontoGetEinwilligungenUrl(), {
    ...options,
    method: "GET",
  });
};

export const getRegistrierungenGetRegistrierungenUrl = (params?: RegistrierungenGetRegistrierungenParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/registrierungen?${stringifiedParams}` : `/api/v0/registrierungen`;
};

/**
 * Every pending registration, newest first, narrowable by season, by team and by status.
 *
 * `bestaetigt` says whether the pupil answered their own confirmation link, composed here rather
 * than left to the reader: an admission is offered on no registration lacking it.
 * `vollstaendig` is false where more rows exist than one read serves. A decision's author is `null`
 * beside `entscheidung.von_gesperrt` where the ban list holds that address, as no barred address is
 * served in plain.
 * @summary List Registrierungen
 */
export const registrierungenGetRegistrierungen = async (
  params?: RegistrierungenGetRegistrierungenParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLRegistrierungenListResponse> => {
  return adminKeyTransport<FLRegistrierungenListResponse>(getRegistrierungenGetRegistrierungenUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getRegistrierungenPostRegistrierungUrl = () => {
  return `/api/v0/registrierungen`;
};

/**
 * Store one pupil's registration for the team and season the link belongs to, and mint the confirmation link.
 *
 * Everything the league decides -- the team, the season, `status`, `eingereicht_am` and the
 * deadline -- is taken off the invite and the clock and never off the payload. The raw confirmation
 * token is answered for the caller to mail and stored only as a hash; this response is the one
 * place outside the recipient's inbox it ever exists.
 *
 * An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * registration it holds and stores none: a fresh link where no message is known to have reached the
 * inbox and nothing is confirmed, none otherwise. The same key over other details is refused
 * (`REQ-REGISTRIERUNG-011`), and so is a key whose stored address, the one the answer mails, has been
 * banned since (`REQ-REGISTRIERUNG-009`), before any link is minted. A key whose registration the team has since
 * admitted is refused too (`REQ-REGISTRIERUNG-016`) and stores nothing: the pupil is in the squad.
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

export const getRegistrierungenPostBestaetigungUrl = () => {
  return `/api/v0/registrierungen/bestaetigung`;
};

/**
 * Record a pupil's own answer for the registration their link opens: their date of birth and the consent record, in one update.
 *
 * Which page the link opens is resolved again here, as the view resolves it. On the new pupil's page the record
 * carries the publication scope they chose, the media answer beside it, the stamp and the wording they were shown.
 * On the returning pupil's page, which asks no choice, it carries the stamp and the wording alone: the choices
 * standing on the person's own record are theirs to change on the account page, and nothing here re-grants one.
 * Its body carries no birthdate: the person's stored one, read here, is judged and written, and the answer echoes
 * null rather than the stored date.
 *
 * Refuses, in this order: a token no registration holds (`REQ-REGISTRIERUNG-004`), a link whose deadline has
 * passed or whose registration has been decided (`-005`), a registration already confirmed (`-006`), any label but
 * the running one of the page the link opens now (`REQ-EINWILLIGUNG-001`), answers that are not the ones that page
 * asks -- both choices and a birthdate on the new pupil's, none of the three on the returning pupil's
 * (`REQ-REGISTRIERUNG-017`) -- a returning pupil's person holding no birthdate to take (`-019`), a link mailed to an
 * address the ban list holds now, whenever the link was minted (`REQ-REGISTRIERUNG-012`), an age below the floor
 * (`-007`), and a media consent from a pupil below `medien_mindestalter` (`REQ-REGISTRIERUNG-010`). Every one is
 * judged before anything is written, so a reloaded page or a mistyped year spends nothing and the pupil keeps the
 * link.
 *
 * The registration stays pending after this: an admission is a later decision, and nothing here writes a person
 * or a squad row.
 * @summary Confirm one registration and record the pupil's consent
 */
export const registrierungenPostBestaetigung = async (
  fLRegistrierungBestaetigungPayload: FLRegistrierungBestaetigungPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLRegistrierungBestaetigungResponse> => {
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
  return baseKeyTransport<FLRegistrierungBestaetigungResponse>(getRegistrierungenPostBestaetigungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungBestaetigungPayload),
  });
};

export const getRegistrierungenGetBestaetigungAnsichtUrl = () => {
  return `/api/v0/registrierungen/bestaetigung/ansicht`;
};

/**
 * Answer what the page renders for the registration this token opens, and no part of the registration beyond it.
 *
 * The link's state, the team and its school, the season, the age floor the press will be judged by, the age from
 * which the media switch is offered, and which of two pages the link opens. Never the pupil's name: the link went to
 * an address nobody has confirmed, which behind a typo is a stranger's.
 *
 * `bestaetigung_spieler_wiederkehrend` is the returning pupil's: a stored person at the registration's folded
 * address under its folded name who confirmed their own record. That page asks no choice and no birthdate, taking
 * the person's own; nothing the person's record holds is served, the holder of a mailed link not yet being known
 * to be that person. Matched on the address alone, a mailbox shared anyway would hand a sibling that person's
 * page, so the name narrows the match.
 *
 * A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
 * registration holds (`REQ-REGISTRIERUNG-004`): a confirmed or an expired link is SERVED in that state rather
 * than refused, so a reopened link shows what became of it. The state is `gesperrt`, ahead of every other, wherever
 * the ban list holds the address the link was mailed to (`REQ-REGISTRIERUNG-012`), so the page offers a barred
 * pupil nothing to press.
 * @summary What one registration confirmation link opens
 */
export const registrierungenGetBestaetigungAnsicht = async (
  fLRegistrierungBestaetigungAnsichtPayload: FLRegistrierungBestaetigungAnsichtPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLRegistrierungBestaetigungAnsichtResponse> => {
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
  return baseKeyTransport<FLRegistrierungBestaetigungAnsichtResponse>(getRegistrierungenGetBestaetigungAnsichtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungBestaetigungAnsichtPayload),
  });
};

export const getRegistrierungenPostEinladungAnsichtUrl = () => {
  return `/api/v0/registrierungen/einladung/ansicht`;
};

/**
 * Answer what this registration link is for: the team, its school, the season, and what the form may offer.
 *
 * A POST because the link value travels in the body and never in a path the edge would log. A shut
 * window is a STATE here rather than a refusal, so a link opened after the deadline reads as closed
 * rather than as invalid; only a link that opens no live invite is refused.
 * @summary What a registration link opens
 */
export const registrierungenPostEinladungAnsicht = async (
  fLEinladungAnsichtPayload: FLEinladungAnsichtPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLEinladungAnsichtResponse> => {
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
  return baseKeyTransport<FLEinladungAnsichtResponse>(getRegistrierungenPostEinladungAnsichtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLEinladungAnsichtPayload),
  });
};

export const getRegistrierungenGetOffeneRegistrierungenUrl = (
  teamId: string,
  saisonId: string,
  params?: RegistrierungenGetOffeneRegistrierungenParams,
) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/v0/registrierungen/kader/${teamId}/${saisonId}?${stringifiedParams}`
    : `/api/v0/registrierungen/kader/${teamId}/${saisonId}`;
};

/**
 * Every pending registration for this team's season, each marked admissible or not by whether the pupil has confirmed it.
 *
 * A confirmed row names the stored person its address resolves to, flagged where that person's name or birthdate
 * differs. An unconfirmed row names nobody: its address is unproven.
 * No address, telephone number, birthdate or consent record is served for anybody.
 * `vollstaendig` is false where more pending rows exist than `limit` serves.
 * @summary A team's pending registrations for one season
 */
export const registrierungenGetOffeneRegistrierungen = async (
  teamId: string,
  saisonId: string,
  params?: RegistrierungenGetOffeneRegistrierungenParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLOffeneRegistrierungenResponse> => {
  return adminKeyTransport<FLOffeneRegistrierungenResponse>(getRegistrierungenGetOffeneRegistrierungenUrl(teamId, saisonId, params), {
    ...options,
    method: "GET",
  });
};

export const getRegistrierungenPatchEinwilligungUrl = (registrierungId: string) => {
  return `/api/v0/registrierungen/selbst/${registrierungId}/einwilligung`;
};

/**
 * Withdraw the publication scope or the media consent the signed-in pupil gave on their own pending registration.
 *
 * WITHDRAW-ONLY until the admission: a grant is the team's admission's to make possible, after which the pupil's own
 * record takes it on the account page; this one is offered so taking a consent back is as easy as giving it was
 * (Art. 7(3) DSGVO). Writes those two on this one registration, and nothing else: the confirmation day, the day given
 * and the wording the pupil confirmed stand. A PATCH moving neither choice writes nothing, and nothing is counted
 * against the person's ceiling. The admission carries a withdrawal made here onto the person, as it carries every
 * choice the registration set later than the person's own.
 *
 * Refuses, in this order: an id that is no pending registration of this address, confirmed by its pupil and carrying
 * their choices (`REQ-FUNKTION-001`); a `nachweis_stand` other than the registration's own, either choice having
 * moved since the page was served (`REQ-EINWILLIGUNG-003`); a grant of either choice (`REQ-EINWILLIGUNG-004`); and a
 * `text_version` naming no version of the account page's pupil control (`REQ-EINWILLIGUNG-001`). Each refusal writes
 * nothing.
 * @summary Withdraw a pupil's own publication and media consent on their pending registration
 */
export const registrierungenPatchEinwilligung = async (
  registrierungId: string,
  fLRegistrierungSelbstEinwilligungPayload: FLRegistrierungSelbstEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLRegistrierungSelbstEinwilligungResponse> => {
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
  return adminKeyTransport<FLRegistrierungSelbstEinwilligungResponse>(getRegistrierungenPatchEinwilligungUrl(registrierungId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungSelbstEinwilligungPayload),
  });
};

export const getRegistrierungenSweepRegistrierungenUrl = (saisonId: string) => {
  return `/api/v0/registrierungen/sweep/${saisonId}`;
};

/**
 * Run the four registration retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.
 *
 * A declined registration is erased a month after the decision. Once the season is `past`, every registration still awaiting a
 * decision is erased whatever the pupil answered, because no admission can be taken for a season that is over. The confirmed ones
 * among them are listed in `benachrichtigt` and told AFTERWARDS -- one message saying it happened -- while an unconfirmed one is
 * told neither before nor after, its address never having been confirmed. A call whose erasure names somebody to tell answers once
 * that erasure has committed, so the rest of the season's registrations wait for the next call; the two clocks below do not run
 * for a `past` season, whose own end takes every row they read.
 *
 * Otherwise an unconfirmed registration strictly past its deadline is erased with no notice at all, the confirmation mail having
 * named that day. Then one reminder per registration at its reminder age, earliest deadline first: a fresh link is minted and
 * `erinnert_am` stamped BEFORE this answers, so a failed send costs one pupil one reminder and never a repeat, and the link already
 * in that inbox stays valid beside the fresh one. One call reminds a bounded share of the registrations due; the rest stay due and
 * the calls after it remind them. A registration whose last message the mail provider refused is not chased at all, and one whose
 * address the ban list holds is sent nothing and has nothing written: it stays due, so every pass asks the ban list for it again
 * until its deadline, and reminds it once a lift comes first; each pass logs how many it withheld, never which. Every removal
 * names this season alone, is made inside a transaction and takes its log rows with it.
 *
 * Whatever a call answers in `erinnerungen` and `benachrichtigt` was committed by its last transactions, so no later step of the same
 * call can answer an error in their place; where the request's deadline cuts them after one has committed, the call answers what
 * committed and warns once.
 *
 * A registration whose write fails, the database refusing it or anything else, or one the answer cannot carry, is passed over
 * alone and logged by id: the rest of its clock's page or share goes, and it stays due, so the next pass meets it again and one
 * failing record holds back no clock and nobody behind it. `fehlgeschlagen` sums the rows each of the four clocks passed over: a
 * day stamped beside a sum that is not zero is a clock passing rows over, not one that ran clean.
 *
 * 404 where no season has the id. Idempotent per day once every due reminder and notice has gone out: a run after that writes
 * nothing, though it logs the count of withheld registrations again.
 *
 * One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
 * answers it beside the application pass's own day. So a day's first call records the day and the rest of that day's calls record
 * nothing.
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

export const getRegistrierungenAblehnenUrl = (registrierungId: string) => {
  return `/api/v0/registrierungen/${registrierungId}/ablehnen`;
};

/**
 * Decline one pending registration, confirmed or not: its state and the decision are written, and nothing else.
 *
 * The decision records the declining seat holder's address and a reason from a closed set, never free text:
 * `andere_person` where the team answered that the registration is not the person its address belongs to. The
 * row stays until the retention sweep erases it a month later. The answer carries the address the pupil's link
 * went to, for the decline mail and nothing else, and whether that address was ever confirmed.
 *
 * Refuses, in this order, a press past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), no pending
 * registration with this id (404) and no seat on its team's season (`REQ-FUNKTION-001`).
 * @summary Decline a registration
 */
export const registrierungenAblehnen = async (
  registrierungId: string,
  fLRegistrierungAblehnenPayload: FLRegistrierungAblehnenPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLRegistrierungAblehnungResponse> => {
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
  return adminKeyTransport<FLRegistrierungAblehnungResponse>(getRegistrierungenAblehnenUrl(registrierungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungAblehnenPayload),
  });
};

export const getRegistrierungenAufnehmenUrl = (registrierungId: string) => {
  return `/api/v0/registrierungen/${registrierungId}/aufnehmen`;
};

/**
 * Admit one confirmed registration: the person it resolves to, or a new one, joins the team's squad, and the registration is erased.
 *
 * The person survives the season, so the admission first looks for them: the stored person holding the
 * registration's address IS that person, and is updated with the registration's name and, where the new pupil's page
 * asked them, its birthdate and its freshly confirmed consent record: one confirmed on the returning pupil's page
 * leaves the person's own birthdate standing, as an administrator may have corrected it since. Where that person's
 * name or birthdate differs, `spieler_id` must name them (the team said it is the same person). With no such
 * person, `spieler_id` is null for a new one. A retired person comes back. A pending address change of theirs
 * stands, asked over the address this admission proves again.
 *
 * The squad row takes the registration's number, position and Stufe, no role, and a Nachnominierung marker derived
 * today; this person's retired row of this season is rewritten rather than a second one written, whichever team
 * it was on. The registration is deleted and its values redacted from the log in the same transaction, so a second
 * press meets no row. Its submission key moves onto the squad row, so the submission replayed later stores nothing.
 *
 * Refuses, in this order: a press past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), no pending
 * registration with this id (404), no seat on its team's season (`REQ-FUNKTION-001`), a registration the pupil has
 * not confirmed (`REQ-REGISTRIERUNG-013`), an address the ban list holds (`REQ-REGISTRIERUNG-009`, worded to the team
 * as neutrally as to the pupil), a Stufe the season does not offer (`REQ-REGISTRIERUNG-003`), a registration
 * confirmed on the returning pupil's page whose address holds no stored person (`REQ-REGISTRIERUNG-018`: it carries
 * no choice, so it admits nobody, and the pupil registers again), a `spieler_id` that is not the person this
 * registration may be admitted into (`REQ-REGISTRIERUNG-014`), a person already playing in a squad this season
 * (`REQ-REGISTRIERUNG-015`) and a full squad (`REQ-SQUAD-003`). Nothing is written on any of them.
 * @summary Admit a registration into the team's squad
 */
export const registrierungenAufnehmen = async (
  registrierungId: string,
  fLRegistrierungAufnehmenPayload: FLRegistrierungAufnehmenPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLRegistrierungAufnahmeResponse> => {
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
  return adminKeyTransport<FLRegistrierungAufnahmeResponse>(getRegistrierungenAufnehmenUrl(registrierungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLRegistrierungAufnehmenPayload),
  });
};

export const getSaisonsGetSaisonsUrl = (params?: SaisonsGetSaisonsParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/saisons?${stringifiedParams}` : `/api/v0/saisons`;
};

/**
 * List the seasons the public may read, optionally narrowed to `past` or `active`.
 *
 * Unlike the other resources, this does NOT default to the current season. A `future` season is
 * withheld here and served by `GET /saisons/list/admin`.
 * @summary List Saisons
 */
export const saisonsGetSaisons = async (
  params?: SaisonsGetSaisonsParams,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSaisonsListResponse> => {
  return baseKeyTransport<FLSaisonsListResponse>(getSaisonsGetSaisonsUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsPostSaisonUrl = () => {
  return `/api/v0/saisons`;
};

/**
 * Create a season, always `future`.
 *
 * The id is supplied rather than generated -- it is the string every `saison_id` elsewhere
 * references, so reusing one comes back 409. Making the season live is a separate step.
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

export const getSaisonsGetCurrentSaisonUrl = () => {
  return `/api/v0/saisons/current`;
};

/**
 * Return the season currently marked active -- what every other endpoint resolves an omitted `saison_id` against.
 * @summary The active Saison
 */
export const saisonsGetCurrentSaison = async (options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLSaisonsSingleResponse> => {
  return baseKeyTransport<FLSaisonsSingleResponse>(getSaisonsGetCurrentSaisonUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSaisonsForAdminUrl = (params?: SaisonsGetSaisonsForAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/saisons/list/admin?${stringifiedParams}` : `/api/v0/saisons/list/admin`;
};

/**
 * List every season, the `future` ones `GET /saisons` withholds included.
 *
 * The admin surfaces read here because a season is created `future` and clubs are entered while it
 * still is, so an admin who cannot see one cannot run the league.
 * @summary Every Saison for the admin surfaces
 */
export const saisonsGetSaisonsForAdmin = async (
  params?: SaisonsGetSaisonsForAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonsListResponse> => {
  return adminKeyTransport<FLSaisonsListResponse>(getSaisonsGetSaisonsForAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsGetSaisonUrl = (saisonId: string) => {
  return `/api/v0/saisons/${saisonId}`;
};

/**
 * Return one season by its id; 404 when none carries it, rather than an empty list.
 *
 * A `future` season is one of those: it is withheld from this tier by the FILTER, so the miss is a
 * genuine one and nothing here has to know it was withheld.
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
  return `/api/v0/saisons/${saisonId}`;
};

/**
 * Update a season's dates and rules. `status` is on no payload.
 *
 * Editing the points moves every league table on the NEXT READ, standings being derived. What a
 * finished or drawn season has fixed is refused, as is a rule narrowed below what it holds.
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
  return `/api/v0/saisons/${saisonId}/activate`;
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

export const getSaisonsPostEinladungenVersandUrl = (saisonId: string) => {
  return `/api/v0/saisons/${saisonId}/einladungen/versand`;
};

/**
 * Mint one registration link per admitted team of this season and answer each team's raw link once, for the caller to mail.
 *
 * **Every team mailed is minted for, and any link that team already held is REVOKED in the same per-team transaction** — the copy in
 * somebody's inbox opens nothing from that moment. A stored link is a hash, so the value to put in a message is one that has just been
 * made; there is nothing to re-send. `ersetzt_link` says of each row whether a link died for it, and the preview answers it before the
 * press. A team this skips is left exactly as it was.
 *
 * Five skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that block
 * has been confirmed by its own person, every confirmed seat's address is on the ban list, or its live link already carries a delivery
 * record and `erneut` is false. **The ban is read once ahead of every team**, so a team the mailer could reach nobody of keeps the link it
 * holds rather than losing it to a press that mails nobody. **The fifth is read off
 * the delivery record**, which only `POST /zustellung/angenommen` writes — so pressing twice mails nobody twice, while a link minted and
 * never sent is still sent. **The first is read off the junction row's `austritt` record**, so a team out of the season by either route is
 * passed over; minting for one team by hand is not refused, that being a deliberate act rather than a bulk one.
 *
 * The answer carries the raw link per team and is the only place each appears. Refused where the season has ended (`REQ-EINLADUNG-002`);
 * 404 where no season holds that id; a season holding no team answers an empty list.
 *
 * **An administrator whose access is revoked while the mailing runs is refused `REQ-AUTH-006` at the next team**, and the answer
 * carries no link at all: every team minted for before that point has lost the link it held and holds one nobody was sent. Running the
 * mailing again, as an administrator who still holds access, mints and answers those teams' links anew, none of them carrying a
 * delivery record yet.
 * @summary Mint every admitted team a link
 */
export const saisonsPostEinladungenVersand = async (
  saisonId: string,
  fLEinladungVersandPayload: FLEinladungVersandPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLEinladungVersandResponse> => {
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
  return adminKeyTransport<FLEinladungVersandResponse>(getSaisonsPostEinladungenVersandUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLEinladungVersandPayload),
  });
};

export const getSaisonsPreviewEinladungenVersandUrl = (saisonId: string, params?: SaisonsPreviewEinladungenVersandParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/v0/saisons/${saisonId}/einladungen/versand/vorschau?${stringifiedParams}`
    : `/api/v0/saisons/${saisonId}/einladungen/versand/vorschau`;
};

/**
 * Per team of this season, the mailboxes the send would write to and the reason it would skip a team — and it writes nothing itself.
 *
 * Decided by the function the send itself decides by, so the list read here is the list performed. `erneut` mirrors the send's own
 * switch: left false, a team whose live link already carries a delivery record reads as `bereits_gesendet`, and pressing the send with
 * `erneut` true instead makes this preview's own answer wrong unless the same value is asked for here.
 *
 * **`ersetzt_link` is the warning this list carries**: the send mints for every team it answers, so a team already holding a link has that
 * link REVOKED and the copy in somebody's inbox opens nothing from that moment. A row carries no trace of the invitation the team holds,
 * so a page offering the press reads that fact here or nowhere.
 *
 * Five skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that
 * block has been confirmed by its own person, every confirmed seat's address is on the ban list, or its live link already carries a
 * delivery record and `erneut` is false. A season holding
 * no team answers an empty list. One row per MAILBOX, so a person sitting in two seats is named once. 404 where no season holds that id.
 * @summary Who the send would reach
 */
export const saisonsPreviewEinladungenVersand = async (
  saisonId: string,
  params?: SaisonsPreviewEinladungenVersandParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLEinladungVersandVorschauResponse> => {
  return adminKeyTransport<FLEinladungVersandVorschauResponse>(getSaisonsPreviewEinladungenVersandUrl(saisonId, params), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsSwapGruppenUrl = (saisonId: string) => {
  return `/api/v0/saisons/${saisonId}/gruppen/swap`;
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

export const getSaisonsPreviewLoeschungUrl = (saisonId: string) => {
  return `/api/v0/saisons/${saisonId}/loeschung/vorschau`;
};

/**
 * How many pupils `POST /identitaet/loeschung/lauf` deletes once this season is activated, and which season that activation closes.
 *
 * Judged by the run's own rule over the statuses the activation leaves: the season now `active` turned `past`, this one
 * `active`, every other as it stands. A count and never a name, and writes nothing. It judges none of the activation's own
 * refusals, and the people it counts are those due at this moment: a squad row or a registration arriving before the run
 * keeps its pupil, and a pupil whose stored address no request matches is counted though the run passes them over.
 * `abgeschlossene_saison_id` is null where no season but this one is `active`. 404 where no season holds that id.
 * @summary How many pupils activating this season would delete
 */
export const saisonsPreviewLoeschung = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLLoeschungVorschauResponse> => {
  return adminKeyTransport<FLLoeschungVorschauResponse>(getSaisonsPreviewLoeschungUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSaisonsUndrawSpielplanUrl = (saisonId: string) => {
  return `/api/v0/saisons/${saisonId}/spielplan`;
};

/**
 * Return the season to undrawn: matchdays, fixtures and watermark, in one transaction.
 *
 * Every fixture's confirmations go with it.
 *
 * The replace's window bounds it (`REQ-SPIELPLAN-006`), and a submitted match report refuses it
 * (`REQ-SPIELPLAN-007`). Undoing the draw is what reopens the shape rules to `PATCH` and the groups to
 * an entry.
 * @summary Undraw this Saison's Spielplan
 */
export const saisonsUndrawSpielplan = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLUndrawSpielplanResponse> => {
  return adminKeyTransport<FLUndrawSpielplanResponse>(getSaisonsUndrawSpielplanUrl(saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getSaisonsGenerateSpielplanUrl = (saisonId: string) => {
  return `/api/v0/saisons/${saisonId}/spielplan`;
};

/**
 * Draw the whole season at once: every matchday and every fixture, undated, in one transaction.
 *
 * `shape` states the three rules the fixtures come out of, and is stored with them. `replace`
 * deletes both lists first, every fixture's confirmations with them, inside `REQ-SPIELPLAN-005`'s
 * window and on a season holding no submitted match report (`REQ-SPIELPLAN-007`), and is refused
 * `REQ-AUTH-009` from a sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`: nothing writes
 * the removed rows back.
 * @summary Draw this Saison's Spielplan
 */
export const saisonsGenerateSpielplan = async (
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
  return adminKeyTransport<FLGenerateSpielplanResponse>(getSaisonsGenerateSpielplanUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLGenerateSpielplanPayload),
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
 * Create a referee and mint their confirmation link.
 *
 * `inactive_since` is set to null here and is on no payload. **Entering a referee IS the
 * invitation**: the payload requires an email address, and there is no second press deciding
 * whether this person is asked, because a referee nobody asked is a name nobody consented to
 * publish. The raw token is answered once, for the caller to mail, and the row stores only its hash.
 *
 * Refused `REQ-SCHIEDSRICHTER-007` where the address given is on the ban list.
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

export const getSchiedsrichterPostBestaetigungUrl = () => {
  return `/api/v0/schiedsrichter/bestaetigung`;
};

/**
 * Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.
 *
 * The consent carries the publication scope they chose, the media answer beside it, the stamp and the wording they were
 * shown. It reaches this one collection and writes nothing on any fixture: a referee's publication scope has one home,
 * which the fixture list joins at read time to decide whether to publish the name each fixture stores.
 *
 * Refuses, in this order: a token no referee holds (`REQ-SCHIEDSRICHTER-002`), an entry already confirmed
 * (`REQ-SCHIEDSRICHTER-004`), a link whose deadline has passed (`REQ-SCHIEDSRICHTER-003`), any label but the referee
 * page's running one (`REQ-EINWILLIGUNG-001`), a link mailed to an address the ban list holds now, whenever the link
 * was minted (`REQ-SCHIEDSRICHTER-009`), an age outside what this consent asks (`REQ-SCHIEDSRICHTER-005`), and a media
 * consent from a referee below `medien_mindestalter` (`REQ-SCHIEDSRICHTER-008`) -- the label and the last two judged
 * before anything is written, so a reloaded page or a mistyped year spends nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this record. Nothing here can:
 * a withheld name would go on being served for as long as that entry lives.
 * @summary Confirm one Schiedsrichter's entry and consent
 */
export const schiedsrichterPostBestaetigung = async (
  fLSchiedsrichterBestaetigungPayload: FLSchiedsrichterBestaetigungPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSchiedsrichterBestaetigungResponse> => {
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
  return baseKeyTransport<FLSchiedsrichterBestaetigungResponse>(getSchiedsrichterPostBestaetigungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSchiedsrichterBestaetigungPayload),
  });
};

export const getSchiedsrichterGetBestaetigungAnsichtUrl = () => {
  return `/api/v0/schiedsrichter/bestaetigung/ansicht`;
};

/**
 * Answer what this token opens: the link's state and deadline, and both age floors.
 *
 * **Nothing else** (`READ-REFEREE-002`): never a name, the school, the contact details, the fee, the birthdate or the
 * entry's id, all of which are behind `READ-CONTACT-001`. The link went to an address an administrator typed and nobody has
 * confirmed, which behind a typo is a stranger's. A POST that reads, so the token travels in a body and never in a second
 * URL.
 *
 * Refuses only a token no referee holds (`REQ-SCHIEDSRICHTER-002`): a confirmed or an expired link
 * is SERVED in that state rather than refused, so a reopened link shows what became of it. The state is `gesperrt`,
 * ahead of every other, wherever the ban list holds the address the link was mailed to (`REQ-SCHIEDSRICHTER-009`),
 * so the page offers a barred referee nothing to press.
 * @summary What one Schiedsrichter confirmation link opens
 */
export const schiedsrichterGetBestaetigungAnsicht = async (
  fLSchiedsrichterBestaetigungAnsichtPayload: FLSchiedsrichterBestaetigungAnsichtPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSchiedsrichterBestaetigungAnsichtResponse> => {
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
  return baseKeyTransport<FLSchiedsrichterBestaetigungAnsichtResponse>(getSchiedsrichterGetBestaetigungAnsichtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSchiedsrichterBestaetigungAnsichtPayload),
  });
};

export const getSchiedsrichterGetSelbstUrl = () => {
  return `/api/v0/schiedsrichter/selbst`;
};

/**
 * Answer every confirmed referee record the signed-in address holds, with its stored contact details.
 *
 * PERSON TIER: the fee set for them per fixture as `honorar`, never the confirmation link's bookkeeping. A retired
 * record is served too. Its consent is the account page's (`GET /konto/einwilligungen`), so none is served here.
 *
 * Refuses an address holding no confirmed referee record (`REQ-FUNKTION-001`).
 * @summary A signed-in referee's own records
 */
export const schiedsrichterGetSelbst = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLSchiedsrichterSelbstResponse> => {
  return adminKeyTransport<FLSchiedsrichterSelbstResponse>(getSchiedsrichterGetSelbstUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSchiedsrichterPatchEinwilligungUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/selbst/${schiedsrichterId}/einwilligung`;
};

/**
 * Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.
 *
 * Writes those two on this one referee row, each moved choice with its evidence (`nachweis.<choice>`), and nothing
 * else: the confirmation day, the day given and the wording they confirmed stand, and no fixture is written. The
 * public fixture list reads the scope off this row, so a withdrawal takes the name off every fixture page at that
 * list's next read. A PATCH moving neither choice writes nothing. A GRANT (`umfang` to
 * `kader_oeffentlich` or `medien` to `true`) is taken on a live record alone; a withdrawal on a retired one too.
 *
 * Refuses, in this order: an id that is no confirmed referee record of this address (`REQ-FUNKTION-001`); a
 * `nachweis_stand` other than the record's own, either choice having moved since the page was served
 * (`REQ-EINWILLIGUNG-003`); a grant on a retired record (`REQ-EINWILLIGUNG-004`); a `text_version` naming no version of
 * the account page's referee control, or a grant naming any but the page's running one (`REQ-EINWILLIGUNG-001`);
 * `medien` moving to `true` where the stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing
 * (`REQ-EINWILLIGUNG-002`); and a grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), which
 * counts grants alone, so a withdrawal is never refused for it. Each refusal writes nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this row; nothing here can.
 * @summary Change a signed-in referee's own publication and media consent
 */
export const schiedsrichterPatchEinwilligung = async (
  schiedsrichterId: string,
  fLSchiedsrichterSelbstEinwilligungPayload: FLSchiedsrichterSelbstEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterSelbstEinwilligungResponse> => {
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
  return adminKeyTransport<FLSchiedsrichterSelbstEinwilligungResponse>(getSchiedsrichterPatchEinwilligungUrl(schiedsrichterId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSchiedsrichterSelbstEinwilligungPayload),
  });
};

export const getSchiedsrichterDeleteSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${schiedsrichterId}`;
};

/**
 * Deactivate a referee. SOFT, for the same reason as venues: matches embed a copy.
 * @summary Deactivate a Schiedsrichter (soft delete)
 */
export const schiedsrichterDeleteSchiedsrichter = async (
  schiedsrichterId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterWriteResponse> => {
  return adminKeyTransport<FLSchiedsrichterWriteResponse>(getSchiedsrichterDeleteSchiedsrichterUrl(schiedsrichterId), {
    ...options,
    method: "DELETE",
  });
};

export const getSchiedsrichterGetSchiedsrichterByIdUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${schiedsrichterId}`;
};

/**
 * Admin-tier as the list is, and for the same two rules (`READ-CONTACT-001`, `READ-MONEY-001`).
 *
 * Deactivated ones included -- a historical match references them by id. The ghost answers 404, as
 * does an id whose referee has been erased: the document is gone
 * (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
 *
 * Answers whether the consent link's deadline has passed today, by the rule its press refuses on, so the editor marks a
 * lapsed link without reading a clock of its own; and the live change of the referee's address, which the address tool shows,
 * beside why the tool refuses it this administrator, null where it opens it.
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
  return `/api/v0/schiedsrichter/${schiedsrichterId}`;
};

/**
 * Update a referee, then update the embedded name on every Spiel that uses them.
 *
 * Only the name. `payment` is NOT propagated: the fee on a match is what was agreed for it.
 *
 * **A corrected address on an UNCONFIRMED referee retires their link and answers a fresh one** in
 * `bestaetigung`, for the caller to mail to the new address: the old link was posted to a mailbox
 * nobody reads, and leaving it live is a credential in the wrong inbox.
 *
 * **A CONFIRMED referee's address is refused here** (`REQ-SCHIEDSRICHTER-011`), retired or not: it is who signs in as the
 * person, and moves only through an address change: the address tool, `POST /adresswechsel`, or the person's own account page.
 * A save keeping it lands, a pending change standing.
 *
 * **A RETIRED unconfirmed referee's corrected address is stored and mails nothing**: no consent is
 * collected for a role nobody gives them. Their old link is retired all the same, and the
 * reactivation mints the fresh one. Where a link is minted, a banned new address is refused
 * `REQ-SCHIEDSRICHTER-007`. A save retiring or minting a link is refused `REQ-AUTH-009` from a
 * sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`.
 *
 * The ghost answers 404 here as it does to every read: a name written onto it would appear on the
 * fixtures of every referee already erased.
 * @summary Update a Schiedsrichter and fan the change out
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

export const getSchiedsrichterEinladenSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${schiedsrichterId}/bestaetigung/einladen`;
};

/**
 * Mint a fresh confirmation link for this referee and answer the raw token once, for the caller to mail.
 *
 * It replaces the whole block, so the previous link stops working at once and the delivery state
 * of the message that link went out in goes with it — a bounce recorded against a replaced address
 * would otherwise hold the fresh link's referee unreachable for ever. The deadline restarts from
 * today.
 *
 * Refused where the referee is retired (`REQ-SCHIEDSRICHTER-001`), where they have already
 * answered (`REQ-SCHIEDSRICHTER-004`), where they carry no email address
 * (`REQ-SCHIEDSRICHTER-006`), and where that address is on the ban list
 * (`REQ-SCHIEDSRICHTER-007`). 404 for an id no referee holds, an erased referee's among them, and
 * for the ghost, which every by-id route filters out.
 *
 * **A referee who has already answered is refused rather than sent a second link**: the
 * confirmation refuses every such press, so minting one would replace a live block with a
 * credential that can never be spent.
 * @summary Send a Schiedsrichter a fresh confirmation link
 */
export const schiedsrichterEinladenSchiedsrichter = async (
  schiedsrichterId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSchiedsrichterMintResponse> => {
  return adminKeyTransport<FLSchiedsrichterMintResponse>(getSchiedsrichterEinladenSchiedsrichterUrl(schiedsrichterId), {
    ...options,
    method: "POST",
  });
};

export const getSchiedsrichterReactivateSchiedsrichterUrl = (schiedsrichterId: string) => {
  return `/api/v0/schiedsrichter/${schiedsrichterId}/reactivate`;
};

/**
 * Clear `inactive_since`, putting the referee back into the picker and every default read.
 *
 * **A retired referee who has not answered is minted a fresh link**, answered once for the caller
 * to mail: a retired referee's save stores a new address and mails nothing, so coming back is what
 * asks them. A row holding no address a link can go to comes back unasked, and so does one whose
 * person has answered. Where a link is minted, an address on the ban list is refused
 * `REQ-SCHIEDSRICHTER-007` and the row stays retired, and one from a sign-in or confirmation older than
 * `STEP_UP_WINDOW_HOURS` is refused `REQ-AUTH-009`.
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

export const getSperrlisteGetSperrlisteUrl = () => {
  return `/api/v0/sperrliste`;
};

/**
 * List the bans, newest first: why each was entered, by whom and on which day, with how many the list holds.
 *
 * No address of the person a ban bars, and nothing one can be recovered from: a row stores a keyed
 * hash of it and the read projects that away. `erstellt_von` is the administrator who entered the
 * row, and is an address — `null` beside `erstellt_von_gesperrt` where the ban list holds that
 * administrator's address too, as no barred address is served in plain. **The rows are capped at
 * `LIST_LIMIT_DEFAULT` and there is no paging control**, so where `anzahl_gesamt` exceeds the rows
 * served, bans are enforced that this answer does not show — and a ban nobody can see is one nobody can lift.
 * @summary List the banned addresses
 */
export const sperrlisteGetSperrliste = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLSperrlisteListResponse> => {
  return adminKeyTransport<FLSperrlisteListResponse>(getSperrlisteGetSperrlisteUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSperrlistePostSperrlisteEintragUrl = () => {
  return `/api/v0/sperrliste`;
};

/**
 * Ban an address from signing up. The address is hashed under the backend key and dropped; no row and no log line holds it.
 *
 * Refused where the list already holds the address (`REQ-SPERRLISTE-001`), while no season is
 * running, there being nothing to count the ban's five seasons from (`REQ-SPERRLISTE-002`), and
 * where the address is an administrator's (`REQ-SPERRLISTE-003`). The ban covers the
 * fifth season after the one running now — the last one it covers is answered as
 * `gesperrt_bis_saison_id` — and it survives that person's erasure. Every grant notice still queued
 * for the address loses the address in the same transaction.
 *
 * `grund` is served, mailed to the address and kept past that person's erasure, so it is refused 422 where it holds a
 * name of the address's own records, as `POST /identitaet/erasure/ansicht` names each (`REQ-SPERRLISTE-004`). It is
 * matched as that erasure's `anlass` is: as stored, spacing aside, and equal where the plain lower or the plain upper case
 * is, so „Weiss“ is refused for „Weiß“ and another spelling such as „Mueller“ for „Müller“ passes.
 * @summary Ban an email address
 */
export const sperrlistePostSperrlisteEintrag = async (
  fLPostSperrlistePayload: FLPostSperrlistePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostSperrlisteResponse> => {
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
  return adminKeyTransport<FLPostSperrlisteResponse>(getSperrlistePostSperrlisteEintragUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostSperrlistePayload),
  });
};

export const getSperrlisteDeleteSperrlisteEintragUrl = (sperrlisteId: string) => {
  return `/api/v0/sperrliste/${sperrlisteId}`;
};

/**
 * Lift a ban before it lapses, removing the row. HARD, no soft form.
 *
 * Nothing reverses it from here: the address a row was taken from cannot be recovered out of the
 * hash, so re-entering the ban means being told the address again. 404 where no row holds the id.
 *
 * **The action log keeps a copy of the removed row** — the hash, its key label, the reason and the
 * administrator who entered it, and no address of the person it barred — for the twelve months
 * the rule gives every log row. The lifted ban is therefore readable
 * at `GET /aktionen` for that period and enforced by nothing from the moment this answers.
 * @summary Lift a ban
 */
export const sperrlisteDeleteSperrlisteEintrag = async (
  sperrlisteId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSperrlisteWriteResponse> => {
  return adminKeyTransport<FLSperrlisteWriteResponse>(getSperrlisteDeleteSperrlisteEintragUrl(sperrlisteId), {
    ...options,
    method: "DELETE",
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
 * (`REQ-SPIELPLAN-007`). Scoped to `saison_id`, the active season when none is named, which answers 404 while no
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

export const getSpielberichteGetSpielberichtePersonUrl = () => {
  return `/api/v0/spielberichte/person`;
};

/**
 * The `active` season's fixtures booked to the signed-in referee whose day has come, newest first.
 *
 * Booked to any confirmed, live referee record of the address, each with when its report was first sent, null where
 * none stands. A fixture called off or struck out is left out, having no report; `spiele` is empty while no season is
 * `active`.
 *
 * `fruehere` holds every fixture of an ended season booked to those records now on which a report stands, newest
 * first, one whose date was cleared after its report last with a null `datum`: its page shows the report read-only.
 * Refused `REQ-FUNKTION-001` where the address holds no confirmed, live referee record.
 * @summary The fixtures a signed-in referee reports on
 */
export const spielberichteGetSpielberichtePerson = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielberichtePersonResponse> => {
  return adminKeyTransport<FLSpielberichtePersonResponse>(getSpielberichteGetSpielberichtePersonUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielberichtePatchSpielberichtUrl = (spielId: string) => {
  return `/api/v0/spielberichte/${spielId}`;
};

/**
 * Write the whole report of one fixture as an administrator, replacing what stood, as the referee's own write does.
 *
 * Every write changing it raises its `version`, so a report adopted before reads `abweichend` until it is adopted
 * again, and a write changing nothing writes nothing. Who first wrote the report stays recorded; a report an
 * administrator writes first records an administrator, naming nobody.
 *
 * `bericht_stand` is the `version` of the report the page was served, null where none stood, as on the referee's
 * write.
 *
 * Refuses, in this order, each writing nothing: a fixture that does not exist (`DB-COMMON-001`); a `bericht_stand`
 * other than the version standing now, or than none where none stands (`REQ-BERICHT-006`); one undated or whose day is
 * still to come (`REQ-BERICHT-001`); one called off or struck out (`REQ-BERICHT-004`); a shoot-out proposed on a
 * group-phase fixture (`REQ-BERICHT-009`); a pupil newly named on a side outside that side's live squad of the season
 * (`REQ-BERICHT-003`); a yellow or second yellow card naming no reason, unless the stored report holds that card, by
 * side, pupil and colour, stripped of its reason at the end of the season after the match (`REQ-BERICHT-008`); and remarks naming a seat
 * holder of either club, the booked referee or a pupil of either squad (`REQ-BERICHT-005`), last. Each but
 * `REQ-BERICHT-006` is asked again outside the transaction just before answering; a write of the report landing
 * mid-press conflicts with this one, whose retry meets `REQ-BERICHT-006`. Two first writes at once are two pages
 * opened on no report: the later is refused.
 * @summary Write one fixture's report as an administrator
 */
export const spielberichtePatchSpielbericht = async (
  spielId: string,
  fLSpielberichtPayload: FLSpielberichtPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielberichtAdminResponse> => {
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
  return adminKeyTransport<FLSpielberichtAdminResponse>(getSpielberichtePatchSpielberichtUrl(spielId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielberichtPayload),
  });
};

export const getSpielberichteGetSpielberichtAdminUrl = (spielId: string, params?: SpielberichteGetSpielberichtAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0
    ? `/api/v0/spielberichte/${spielId}/admin?${stringifiedParams}`
    : `/api/v0/spielberichte/${spielId}/admin`;
};

/**
 * One fixture's report as the editor's panel reads it, whole, with the state it reads in.
 *
 * Beside it the fixture and the pupils the report names, by name. Both clubs' live squads of the season only with
 * `kader`, which the correction's form picks from: the panel reads no pupil the report does not name, so a fixture
 * holding no report serves none. The report and its state are null where no report stands; `DB-COMMON-001` only for
 * a fixture that does not exist.
 * @summary One fixture's report, whole, for an administrator
 */
export const spielberichteGetSpielberichtAdmin = async (
  spielId: string,
  params?: SpielberichteGetSpielberichtAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielberichtAdminResponse> => {
  return adminKeyTransport<FLSpielberichtAdminResponse>(getSpielberichteGetSpielberichtAdminUrl(spielId, params), {
    ...options,
    method: "GET",
  });
};

export const getSpielberichteGetSpielberichtBerichtUrl = (spielId: string) => {
  return `/api/v0/spielberichte/${spielId}/bericht`;
};

/**
 * What the booked referee's report form reads.
 *
 * The fixture, both clubs' live squads of the season, the pupils the stored report names outside them, and the stored
 * report, its remarks and card reasons included, or null.
 *
 * Served for a fixture still to come or called off too, whose page says why it takes no report, with both squads
 * empty: the pupils the stored report names are then all in `genannt`. Once the fixture's season has ended,
 * `abgeschlossen` is true and the read is the report alone, both squads empty, which its referee writes no more.
 * Refused
 * `REQ-FUNKTION-001` where the address holds no confirmed, live referee record, and `REQ-BERICHT-002` where the fixture
 * is booked to none of its records; `DB-COMMON-001` for a fixture that does not exist.
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
  return `/api/v0/spielberichte/${spielId}/bericht`;
};

/**
 * Write the whole report of one fixture as its booked referee, replacing what stood.
 *
 * The proposed result, the scorers, the cards and the remarks. The first write creates it and answers 201; every
 * write changing it raises its `version`, so a report the administrator adopted reads `abweichend` again until it
 * is adopted anew, and a write changing nothing writes nothing. Every write stamps the clubs the fixture fields now,
 * so a report a knockout correction re-fielded a side under reads `teams_geaendert` until it is written again. Writes
 * no fixture: the result is the administrator's to save.
 *
 * `bericht_stand` is the `version` of the report the form was served, null where none stood: a write composed on
 * another version would replace a report its sender never saw.
 *
 * Refuses, in this order, each writing nothing: a write past the person's ceiling for the German day
 * (`REQ-DROSSELUNG-001`); an address holding no confirmed, live referee record (`REQ-FUNKTION-001`); a fixture that
 * does not exist (`DB-COMMON-001`); one booked to none of its records (`REQ-BERICHT-002`); one whose season has
 * ended, whose report its referee only reads (`REQ-BERICHT-007`); a `bericht_stand` other than the version standing
 * now, or than none where none stands (`REQ-BERICHT-006`); one undated or whose day is still to come
 * (`REQ-BERICHT-001`); one called off or struck out (`REQ-BERICHT-004`); a shoot-out proposed on a group-phase fixture
 * (`REQ-BERICHT-009`); a pupil the write newly names on a side outside that side's live squad of the season, a pupil
 * the report already named on that side staying while the side fields the club it did (`REQ-BERICHT-003`); a yellow
 * or second yellow card naming no reason (`REQ-BERICHT-008`); and remarks naming a seat holder of either club, the
 * booked referee or a pupil of either squad (`REQ-BERICHT-005`), last. Every refusal but the ceiling's and
 * `REQ-BERICHT-006` is asked again outside the transaction just before answering, the referee's records included, so
 * a write landing on what was judged before that second asking refuses the report rather than letting it stand, and
 * one landing after it stands beside the report; a write of the report itself landing mid-press conflicts with this
 * one, whose retry meets `REQ-BERICHT-006`. Two first writes at once are two forms opened on no report: the later is
 * refused.
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
 * Every confirmation row of the season, or of its one fixture, and the day the confirmation pass last ran over it.
 *
 * Newest first, closed rows included. No seat's link hashes and no answer's holder digest are served. Every row still
 * holding its party's question is served; `limit` cuts the others, and `vollstaendig` is false where it left the
 * oldest of them out. A season no document has answers no rows and a null day rather than 404.
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

export const getSpielbestaetigungenPostSpielbestaetigungUrl = () => {
  return `/api/v0/spielbestaetigungen`;
};

/**
 * Record one club's answer about one Ansetzung, from whichever of its three seats presses first, and the seat it came from.
 *
 * The first press binds: a second seat pressing at once conflicts with it, and its retry finds the row answered
 * (`REQ-ANSETZUNG-002`). Writes no fixture: a proposal is the administrator's to act on.
 *
 * Refuses, in this order: a token no seat holds (`REQ-ANSETZUNG-001`); a link whose seat's address the ban list holds
 * now, whenever it was minted (`REQ-ANSETZUNG-011`); a row already answered, closed since or not
 * (`REQ-ANSETZUNG-002`); one closed unanswered (`REQ-ANSETZUNG-009`); a fixture decided, called off or left by a club
 * (`REQ-ANSETZUNG-005`), then one whose date, time, ground or sides moved since the link (`REQ-ANSETZUNG-004`), each
 * as the confirmation pass's close judges the row; an answer after the deadline's day (`REQ-ANSETZUNG-003`); a
 * proposal dated before today (`REQ-ANSETZUNG-007`); and a proposal the administrator's own save of that date would be
 * refused, judged on what it newly claims and in that save's order: on or after a club's exit
 * (`REQ-ELIGIBILITY-001`), outside the matchday (`REQ-DATE-001`), or within four hours of the ground's or the referee's
 * other fixture (`REQ-CLASH-001`). The reason is stored as typed. Every refusal after the ban's is asked again outside
 * the transaction just before answering, so a write landing mid-answer on what was judged refuses the answer rather
 * than letting it stand.
 * @summary Confirm a fixture's Ansetzung, or decline it proposing another date
 */
export const spielbestaetigungenPostSpielbestaetigung = async (
  fLSpielbestaetigungAntwortPayload: FLSpielbestaetigungAntwortPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpielbestaetigungAntwortResponse> => {
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
  return baseKeyTransport<FLSpielbestaetigungAntwortResponse>(getSpielbestaetigungenPostSpielbestaetigungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielbestaetigungAntwortPayload),
  });
};

export const getSpielbestaetigungenGetSpielbestaetigungAnsichtUrl = () => {
  return `/api/v0/spielbestaetigungen/ansicht`;
};

/**
 * Answer what the page renders for the fixture this token asks a club about, and nobody's name or address (`READ-ANSETZUNG-001`).
 *
 * The state, which side the reader's club plays, the fixture as it stands now (or, where it moved since the link, the
 * Ansetzung the link asked about), the row's deadline, the other club's proposal and which role answered. A POST that
 * reads, so the token travels in a body and never in a second URL. Refuses only a token no seat of any row holds
 * (`REQ-ANSETZUNG-001`), a guess and a link voided when its seat changed hands alike: an answered, closed, moved,
 * decided or expired link is SERVED in that state rather than refused, so a reopened link shows what became of it. The
 * state is `gesperrt`, ahead of every other, wherever the ban list holds the address the seat's links were mailed to.
 * `vorschlag` is the state of an open link while the other club's decline proposes another date for the same
 * Ansetzung, whose date and hour alone are served.
 * @summary What one fixture confirmation link opens
 */
export const spielbestaetigungenGetSpielbestaetigungAnsicht = async (
  fLSpielbestaetigungAnsichtPayload: FLSpielbestaetigungAnsichtPayload,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpielbestaetigungAnsichtResponse> => {
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
  return baseKeyTransport<FLSpielbestaetigungAnsichtResponse>(getSpielbestaetigungenGetSpielbestaetigungAnsichtUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielbestaetigungAnsichtPayload),
  });
};

export const getSpielbestaetigungenGetEigeneSpielbestaetigungenUrl = () => {
  return `/api/v0/spielbestaetigungen/selbst`;
};

/**
 * Answer each fixture's newest confirmation row naming one of the signed-in address's live, confirmed referee records.
 *
 * One row per fixture in an `active` season: a fixture moved, reinstated or booked to them again answers its fresh
 * request alone.
 *
 * Open, answered and closed rows alike, each with the fixture as it stands -- or, where the fixture moved since, the
 * Ansetzung the row asked about -- its state, `abgesagt` once the fixture is called off, the referee's own decline
 * reason, whether the league recorded the answer for them, naming nobody, and whether its day is past. No deadline is
 * served: a referee answers until the fixture's day. Ordered with the days still to come first, rows still open
 * ahead, each by its day; then the days gone by, the latest first. Nobody's address or seat is served, and no reason an
 * administrator entered on the row.
 *
 * Refuses an address holding no live, confirmed referee record (`REQ-FUNKTION-001`).
 * @summary A signed-in referee's own fixture assignments
 */
export const spielbestaetigungenGetEigeneSpielbestaetigungen = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielbestaetigungenSelbstResponse> => {
  return adminKeyTransport<FLSpielbestaetigungenSelbstResponse>(getSpielbestaetigungenGetEigeneSpielbestaetigungenUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielbestaetigungenGetSpielSweepSaisonsUrl = () => {
  return `/api/v0/spielbestaetigungen/sweep`;
};

/**
 * Answer every `active` season's id, oldest first, and the day a confirmation pass last ran over any of them.
 *
 * `active` alone: a confirmation serves no purpose once its season is over, and a season that ended with a fixture nobody
 * entered a result for would otherwise be asked about a day long gone. System tier because this is the timer's own
 * bookkeeping, asked by the process running the pass and by no page. Null means no pass has run over these seasons. Reading
 * it writes nothing.
 * @summary Every season the confirmation pass visits
 */
export const spielbestaetigungenGetSpielSweepSaisons = async (
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSpielbestaetigungSweepSaisonsResponse> => {
  return systemKeyTransport<FLSpielbestaetigungSweepSaisonsResponse>(getSpielbestaetigungenGetSpielSweepSaisonsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielbestaetigungenSweepSpielbestaetigungenUrl = (saisonId: string) => {
  return `/api/v0/spielbestaetigungen/sweep/${saisonId}`;
};

/**
 * Close, mint and remind one season's fixture confirmations, as of today in Europe/Berlin, and answer what the caller must mail.
 *
 * The close shuts every row not yet closed, answered or not, whose fixture moved, was decided, was called off, lost a club
 * to an `austritt` dated on or before its day, or -- a referee's row -- names another referee or none; failing all of
 * those, a row whose fixture's day is before today closes `spiel_vergangen`, so nobody is asked about a past date. A
 * club's decline closed `verworfen` is closed again for each of those but a move and a referee change, in the pass
 * that closes an agreement beside it, and once the day it was about has passed: the public fixture then stops
 * counting it as that club's agreement.
 *
 * A closing owes its party a notice where the party's first request or Einteilung went out, about a day today or later:
 * for a move, the slot it left or the one the fixture holds now; for a referee taken off the fixture -- ahead of a move
 * it shares a close with, and never for the referee's own decline, which closed its row as it was given -- and for a
 * call-off, the slot the row was about. The closed row holds the
 * notice, and the notice step answers a share of those the season's rows hold, each built off the fixture and the
 * mailboxes or address as they stand: a team's move in `neue_ansetzungen`, a referee's in
 * `schiedsrichter_neue_ansetzungen`, a referee taken off in `schiedsrichter_gewechselt`, a call-off in `spiel_abgesagt`
 * and `schiedsrichter_spiel_abgesagt`, and the notice an administrator's discard holds, that the date stands, in
 * `vorschlag_verworfen`. A notice is answered on every pass until the caller stamps it through
 * `/mitgeteilt`; one answered as often as `app/api/spielbestaetigungen/services.py :: MITTEILUNG_VERSUCHE_HOECHSTENS`
 * allows, or about no day still to come, is given up: answered in `mitteilungen_aufgegeben` by its row, its fixture
 * and its party's kind, never a person, for the administrator to tell by hand, and answered so on every pass until
 * `/mitgeteilt` stamps it too, so a lost answer loses no give-up. One with nobody left to tell, or whose closing the
 * fixture has since undone -- reinstated, its referee booked again, back at the row's slot -- is dropped unanswered,
 * the mint asking its party afresh.
 *
 * The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
 * ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
 * its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `verworfen`: a
 * decline the administrator discarded is the party's one answer to that Ansetzung. A fixture booked onto the erased
 * referee's ghost gets no referee row, the ghost holding no address. The deadline falls the notice period
 * (`app/shared/schemas/bounds.py :: SPIEL_BESTAETIGUNG_FRIST_TAGE`) before the fixture, or today where that has passed.
 * Each seat holding an address gets one link, a person holding two seats one link naming both, and the raw tokens are
 * answered in `anfragen` UNSTAMPED: the caller stamps what it mailed through `/angefragt`, so a request that never went
 * out shows as never asked. An open row's occupied seat holding no link -- its holder replaced,
 * newly seated, or a ban since lifted -- is minted one too and answered the same way. Referee rows are answered in
 * `einteilungen`, with the referee's address and no token. A fixture holding rows about an Ansetzung it has left is asked
 * once the close has shut them and each one's notice that its links are void is answered, in this answer or an earlier
 * one, so that notice goes out first.
 *
 * The reminder mints a fresh link per seat on each team row whose deadline lies a reminder's count of days away
 * (`app/shared/schemas/bounds.py :: SPIEL_ERINNERUNG_TAGE_ERSTE`, `:: SPIEL_ERINNERUNG_TAGE_ZWEITE`), appended beside the
 * links already mailed so every one of them answers until the deadline, and stamps the day BEFORE answering: a failed send
 * costs one reminder, never a daily repeat. It passes over each seat whose last mail the provider refused, and reminds no
 * row this pass inserted nor one whose request was stamped today; where this pass's mint gave one of a row's seats a fresh
 * link, that request is the seat's message of the day and the row's other seats are reminded beside it.
 *
 * A row whose first request was never stamped as sent, inserted on an earlier pass, is asked again on every pass until a
 * stamp lands or it stops taking an answer, a team row after its deadline and a referee row after the fixture's day: a
 * team row in `anfragen`, with a fresh link per seat appended the same way and each
 * refused seat passed over; a referee row in `einteilungen`, unless the provider refused the last mail recorded to the
 * referee's address. A row with nobody left to ask is not asked and stays unstamped, so it shows as never asked.
 *
 * A seat whose address the ban list holds is minted nothing and has nothing written, so it stays due and a later pass mints
 * it once the ban is lifted; each pass logs how many seats it withheld, never which.
 *
 * Each step takes a bounded share and leaves the rest due. Everything answered was committed, and once a step has
 * committed something owed a message, a later failure -- the stamp of the pass's day on this season included -- is logged
 * and the call answers what committed. A row whose write or answer fails is passed over alone, logged by id and counted in
 * `fehlgeschlagen`.
 *
 * A season that is not `active` is passed by whole -- nothing closed, minted, reminded or stamped, every list empty -- so a
 * mistyped call, or one for a season ended since the listing, mails nobody. 404 where no season has the id.
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

export const getSpielbestaetigungenAngefragtSpielbestaetigungenUrl = (saisonId: string) => {
  return `/api/v0/spielbestaetigungen/sweep/${saisonId}/angefragt`;
};

/**
 * Record that the first message about the rows named went out, team and referee rows alike.
 *
 * Every named row of this season not yet stamped is stamped today, answered or closed since or not: the stamp says the
 * request was mailed, which a row closed for a move needs before its parties are told the date changed. A row already
 * stamped keeps the day it has, and an id of another season is skipped. A row whose stamp fails is passed over alone,
 * logged by id, left unstamped and counted in `fehlgeschlagen`. 404 where no season has the id. An empty list answers zero.
 * @summary Stamp the confirmations whose first message went out
 */
export const spielbestaetigungenAngefragtSpielbestaetigungen = async (
  saisonId: string,
  fLSpielbestaetigungSweepAngefragtPayload: FLSpielbestaetigungSweepAngefragtPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSpielbestaetigungSweepAngefragtResponse> => {
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
  return systemKeyTransport<FLSpielbestaetigungSweepAngefragtResponse>(getSpielbestaetigungenAngefragtSpielbestaetigungenUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielbestaetigungSweepAngefragtPayload),
  });
};

export const getSpielbestaetigungenMitgeteiltSpielbestaetigungenUrl = (saisonId: string) => {
  return `/api/v0/spielbestaetigungen/sweep/${saisonId}/mitgeteilt`;
};

/**
 * Record that the notices about the rows named went out, or were given up and logged, so no later pass answers them again.
 *
 * Every named row of this season still holding its notice stops holding it. A row holding none -- stamped already,
 * dropped, or never owing one -- and an id of another season are left alone and not counted. No claim is checked:
 * one process runs the pass, so no second pass can hold the rows named. One
 * transaction, recorded under the system actor. 404 where no season has the id. An empty list answers zero.
 * @summary Stamp the confirmations whose notice went out
 */
export const spielbestaetigungenMitgeteiltSpielbestaetigungen = async (
  saisonId: string,
  fLSpielbestaetigungSweepMitgeteiltPayload: FLSpielbestaetigungSweepMitgeteiltPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLSpielbestaetigungSweepMitgeteiltResponse> => {
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
  return systemKeyTransport<FLSpielbestaetigungSweepMitgeteiltResponse>(getSpielbestaetigungenMitgeteiltSpielbestaetigungenUrl(saisonId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielbestaetigungSweepMitgeteiltPayload),
  });
};

export const getSpielbestaetigungenPostSchiedsrichterAntwortUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${spielbestaetigungId}/antwort`;
};

/**
 * Record the signed-in referee's answer about one fixture they are booked on: they accept it, or decline it giving a reason.
 *
 * The first answer binds, as a club's does. A decline also takes the referee off the fixture, writing its referee
 * null and nothing else of it -- no other fixture is resolved again and no club is told -- and closes the row, so
 * booking the same referee again asks them afresh. The reason is stored as typed, for the administrator, and goes at
 * the season's end. Answering is open until the fixture's day, whatever deadline a club's row of the same fixture
 * carries.
 *
 * Refuses, in this order: an answer past the person's ceiling for the German day (`REQ-DROSSELUNG-001`); an address
 * holding no live, confirmed referee record (`REQ-FUNKTION-001`); an id naming no row of an `active` season, or a row
 * naming none of those records (`REQ-ANSETZUNG-015`, one answer for both); a row already answered, by them or by the
 * league for them (`REQ-ANSETZUNG-002`); one closed unanswered (`REQ-ANSETZUNG-009`); a fixture decided, called off
 * or left by a club (`REQ-ANSETZUNG-005`), then one whose date, time, ground or sides moved since the row, or which
 * books another referee or none (`REQ-ANSETZUNG-004`); and a fixture whose day has gone by (`REQ-ANSETZUNG-003`). An
 * acceptance is judged again outside the transaction just before answering, so a move or a reassignment landing
 * mid-answer refuses it rather than letting it stand.
 *
 * **The caller drops the cached fixture list after a successful answer**: an acceptance can put the referee's name
 * on the public fixture, and a decline takes it off.
 * @summary Accept or decline one of the signed-in referee's own fixture assignments
 */
export const spielbestaetigungenPostSchiedsrichterAntwort = async (
  spielbestaetigungId: string,
  fLSpielbestaetigungSchiedsrichterAntwortPayload: FLSpielbestaetigungSchiedsrichterAntwortPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielbestaetigungSchiedsrichterAntwortResponse> => {
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
  return adminKeyTransport<FLSpielbestaetigungSchiedsrichterAntwortResponse>(
    getSpielbestaetigungenPostSchiedsrichterAntwortUrl(spielbestaetigungId),
    {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
      body: JSON.stringify(fLSpielbestaetigungSchiedsrichterAntwortPayload),
    },
  );
};

export const getSpielbestaetigungenEintragenSpielbestaetigungUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${spielbestaetigungId}/eintragen`;
};

/**
 * Record that the party of an open confirmation agreed to its Ansetzung elsewhere than through its link.
 *
 * The administrator's reason says how. IRREVERSIBLE: the answer is the league's record of how a date was agreed, and
 * nothing rewrites it. It names nobody: no seat and no person is recorded, and the reason takes any text and goes at
 * the season's end. Refused for a row
 * already answered, by a seat or by an administrator, or closed (`REQ-ANSETZUNG-013`), including one a seat answers
 * while this request runs: of the two answers exactly one is stored. A row about an Ansetzung the fixture has since
 * left is settled as asked, and the next confirmation pass closes it.
 * @summary Record a party's Zusage on its behalf
 */
export const spielbestaetigungenEintragenSpielbestaetigung = async (
  spielbestaetigungId: string,
  fLSpielbestaetigungEintragenPayload: FLSpielbestaetigungEintragenPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielbestaetigungEintragenResponse> => {
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
  return adminKeyTransport<FLSpielbestaetigungEintragenResponse>(getSpielbestaetigungenEintragenSpielbestaetigungUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielbestaetigungEintragenPayload),
  });
};

export const getSpielbestaetigungenVerwerfenSpielbestaetigungUrl = (spielbestaetigungId: string) => {
  return `/api/v0/spielbestaetigungen/${spielbestaetigungId}/verwerfen`;
};

/**
 * Close a club's open decline that proposes another date, so the proposal stops asking the administrator to act.
 *
 * IRREVERSIBLE: the decline stays as the club gave it, and the row is closed `verworfen`, which is that club's one
 * answer to this Ansetzung: the confirmation pass never asks it about this Ansetzung again, and the public fixture
 * counts it as the club's agreement, the league having kept the date, until a pass closes it again as it closes an
 * agreement beside it. Where its day is still to come, the row holds the club a notice that the date stands, which
 * the confirmation pass mails. Refused for any other row -- open, agreed, declined without a proposal, a referee's, closed, or
 * about an Ansetzung the fixture has left, the fixture moving while this request runs included (`REQ-ANSETZUNG-014`):
 * the confirmation pass closes that row and tells its club of the move.
 * @summary Discard a club's proposed date
 */
export const spielbestaetigungenVerwerfenSpielbestaetigung = async (
  spielbestaetigungId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielbestaetigungVerwerfenResponse> => {
  return adminKeyTransport<FLSpielbestaetigungVerwerfenResponse>(getSpielbestaetigungenVerwerfenSpielbestaetigungUrl(spielbestaetigungId), {
    ...options,
    method: "POST",
  });
};

export const getSpieleGetSpieleUrl = (params?: SpieleGetSpieleParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spiele?${stringifiedParams}` : `/api/v0/spiele`;
};

/**
 * List Spiele matching the given filters.
 *
 * Omitting `saison_id` returns the CURRENT season; one this tier may not read lists nothing.
 * `saison_phase` aliases `playoffs` to "any phase but gruppenphase"; `ausstehend` includes today.
 * @summary List Spiele
 */
export const spieleGetSpiele = async (
  params?: SpieleGetSpieleParams,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpieleListResponse> => {
  return baseKeyTransport<FLSpieleListResponse>(getSpieleGetSpieleUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpieleGetSpieleActionRequiredUrl = (params?: SpieleGetSpieleActionRequiredParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spiele/action_required?${stringifiedParams}` : `/api/v0/spiele/action_required`;
};

/**
 * List Spiele needing attention, and the bracket faults among them.
 *
 * Qualifying: cancelled, missing a date, time, venue or referee, past with no result, a
 * knockout side with neither team nor `quelle`, or holding a referee's report the administrator has
 * not adopted as it stands. Every report's state the season holds is served beside them. Scoped to `saison_id`, the active season when none
 * is named, which answers 404 while no season is active.
 *
 * Also every fixture a club's unclosed confirmation about its Ansetzung as it stands puts before the
 * administrator: a decline proposing another date, a deadline passed unanswered, or a deadline of
 * today on a request sent today or never. The rows themselves are not served: `GET /spielbestaetigungen`
 * for the same season serves them, read separately, so a row reaching one of those states between
 * the two reads shows its fixture on the next.
 *
 * The faults include a fixture still to be played that is booked onto a retired venue or referee,
 * and one whose venue or referee another fixture of any season claims less than four hours away.
 * @summary Spiele needing attention
 */
export const spieleGetSpieleActionRequired = async (
  params?: SpieleGetSpieleActionRequiredParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieleActionRequiredResponse> => {
  return adminKeyTransport<FLSpieleActionRequiredResponse>(getSpieleGetSpieleActionRequiredUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpieleGetSpieleForAdminUrl = (params?: SpieleGetSpieleForAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spiele/list/admin?${stringifiedParams}` : `/api/v0/spiele/list/admin`;
};

/**
 * List a season's Spiele for the admin surfaces, a `future` season's included.
 *
 * Same filters as `GET /spiele`, without its season gate -- which lists a planned season as empty,
 * so every admin surface counting fixtures reads zero. The admin fixture shape, so the referee
 * carries their whole name and the two figures ride along (`READ-MONEY-001`, `READ-REFEREE-001`).
 * @summary Spiele for the admin surfaces
 */
export const spieleGetSpieleForAdmin = async (
  params?: SpieleGetSpieleForAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieleAdminListResponse> => {
  return adminKeyTransport<FLSpieleAdminListResponse>(getSpieleGetSpieleForAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpieleGetSpielUrl = (spielId: string) => {
  return `/api/v0/spiele/${spielId}`;
};

/**
 * Return one match by its id.
 *
 * The season is read to gate it and for nothing else: the match carries its own `saison_id`, and
 * `spiel_status` is a property of a query. 404 for a season this tier may not read.
 * @summary One Spiel
 */
export const spieleGetSpiel = async (spielId: string, options?: Parameters<typeof baseKeyTransport>[1]): Promise<FLSpieleSingleResponse> => {
  return baseKeyTransport<FLSpieleSingleResponse>(getSpieleGetSpielUrl(spielId), {
    ...options,
    method: "GET",
  });
};

export const getSpielePatchSpielDataUrl = (spielId: string, params?: SpielePatchSpielDataParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spiele/${spielId}?${stringifiedParams}` : `/api/v0/spiele/${spielId}`;
};

/**
 * Update one Spiel and resolve the season's bracket.
 *
 * The payload is written wholesale: an omitted field is overwritten, and every name it carries is
 * composed by the server. A result can fill or empty the slots below it, each named in `advanced_to`.
 *
 * With `uebernimmt_bericht`, the save also stamps the fixture's Spielbericht adopted at that version, in the same
 * transaction. A report corrected since that version, or written about other clubs than the save leaves on the
 * fixture, is left unstamped, and the save lands all the same: nothing is refused for it. A `dry_run` stamps nothing.
 * @summary Update a Spiel
 */
export const spielePatchSpielData = async (
  spielId: string,
  fLPatchSpielDataPayload: FLPatchSpielDataPayload,
  params?: SpielePatchSpielDataParams,
  options?: Parameters<typeof adminKeyTransport>[1],
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
  return adminKeyTransport<FLPatchSpielDataResponse>(getSpielePatchSpielDataUrl(spielId, params), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSpielDataPayload),
  });
};

export const getSpieleGetSpielForAdminUrl = (spielId: string) => {
  return `/api/v0/spiele/${spielId}/admin`;
};

/**
 * Return one match in the joined shape, plus the two figures the base tier withholds.
 *
 * The editor reads here because it round-trips `ort.mietpreis` and `schiedsrichter.payment`,
 * which are admin-tier (`READ-MONEY-001`).
 * @summary One Spiel for the admin editor
 */
export const spieleGetSpielForAdmin = async (
  spielId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieleAdminSingleResponse> => {
  return adminKeyTransport<FLSpieleAdminSingleResponse>(getSpieleGetSpielForAdminUrl(spielId), {
    ...options,
    method: "GET",
  });
};

export const getSpielerGetSpielerUrl = (params?: SpielerGetSpielerParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spieler?${stringifiedParams}` : `/api/v0/spieler`;
};

/**
 * List players, normally one team's squad in one season.
 *
 * Naming a `team_id` without a `saison_id` returns that team's squad in the CURRENT season, and 404s
 * while no season is active. Naming neither lists every season's players, a season this tier may not
 * read adding no row. BASE TIER: a pupil reads back redacted (`READ-PUPIL-001`).
 *
 * Both names are `null` where the person's consent record does not publish them (`READ-PUPIL-003`);
 * the row keeps its `nummer` and `position`, and no row carries the person's record id
 * (`READ-PUPIL-005`).
 * @summary List Spieler
 */
export const spielerGetSpieler = async (
  params?: SpielerGetSpielerParams,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpielerListResponse> => {
  return baseKeyTransport<FLSpielerListResponse>(getSpielerGetSpielerUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpielerGetKaderUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/spieler/kader/${teamId}/${saisonId}`;
};

/**
 * The squad of one team in one season, for a person holding any contact seat on it.
 *
 * Every row, ausgetragen ones included and marked by `inactive_since`; each surname whole, and no
 * e-mail address or telephone number of anybody. `nummer_doppelt` marks a live row whose number
 * another live row of the squad wears, compared as stored. `erlaubte_stufen` is what the season's
 * rules offer an edit. Refused `REQ-FUNKTION-001` where the signed-in person holds no seat on this
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

export const getSpielerDeleteKaderZeileUrl = (teamId: string, saisonId: string, spielerId: string) => {
  return `/api/v0/spieler/kader/${teamId}/${saisonId}/${spielerId}`;
};

/**
 * Take a player out of this team's squad for the season, as any contact seat of the team may. SOFT: the row stays.
 *
 * Stamps the row's `inactive_since`; the person stays in the league, and only an administrator
 * brings the row back. 404 where this team holds no live row for the player in this season,
 * another team's pupil and an ausgetragen row alike. Refused `REQ-DROSSELUNG-001` past the person's ceiling for the
 * German day, ahead of the 404, and `REQ-FUNKTION-001` without a seat.
 * @summary Take a Spieler out of the squad as its team's seat holder (austragen)
 */
export const spielerDeleteKaderZeile = async (
  teamId: string,
  saisonId: string,
  spielerId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKaderZeileResponse> => {
  return adminKeyTransport<FLKaderZeileResponse>(getSpielerDeleteKaderZeileUrl(teamId, saisonId, spielerId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielerPatchKaderZeileUrl = (teamId: string, saisonId: string, spielerId: string) => {
  return `/api/v0/spieler/kader/${teamId}/${saisonId}/${spielerId}`;
};

/**
 * Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.
 *
 * The team and the Nachnominierung flag stay the stored row's. 404 where this team holds no live
 * row for the player in this season: another team's pupil and an ausgetragen row answer alike, and
 * nothing is written. Refused `REQ-DROSSELUNG-001` past the person's ceiling for the German day, ahead of the 404 and
 * every rule, `REQ-FUNKTION-001` without a seat, `REQ-SQUAD-005` for a `stufe` the
 * season's `erlaubte_stufen` does not offer unless the row already holds it, and `REQ-SQUAD-004`
 * for a `rolle` another live row of the squad holds. A shared `nummer` is permitted.
 * @summary Update a squad entry as its team's seat holder
 */
export const spielerPatchKaderZeile = async (
  teamId: string,
  saisonId: string,
  spielerId: string,
  fLPatchKaderZeilePayload: FLPatchKaderZeilePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKaderZeileResponse> => {
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
  return adminKeyTransport<FLKaderZeileResponse>(getSpielerPatchKaderZeileUrl(teamId, saisonId, spielerId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchKaderZeilePayload),
  });
};

export const getSpielerGetSpielerMembershipsUrl = () => {
  return `/api/v0/spieler/memberships`;
};

/**
 * Every player, retired ones included, each with every squad row they hold.
 *
 * `GET /spieler` answers it at no setting: the junction join is strict with a `saison_id`, and
 * without one a player with no live row has `nummer` and `position` null.
 *
 * `adresswechsel_id` names the live change of the pupil's address, which the address tool shows, and
 * `adresswechsel_einsehbar_verwehrt` why the tool refuses it this administrator, null where it opens it.
 * @summary Every Spieler with their squad rows
 */
export const spielerGetSpielerMemberships = async (
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerMembershipsResponse> => {
  return adminKeyTransport<FLSpielerMembershipsResponse>(getSpielerGetSpielerMembershipsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielerGetSpielerNachnominierungUrl = (saisonId: string) => {
  return `/api/v0/spieler/nachnominierung/${saisonId}`;
};

/**
 * Whether a player entered into this season's squads today would be marked a Nachnominierung.
 *
 * `POST /spieler/{spieler_id}/saisons` derives the stored marker from this same test: from the first
 * day of matchday 1 of the season's first phase. A season whose matchday 1 is undated, or which
 * holds none yet, answers `false`. 404 where no season has this id.
 * @summary Whether a squad entry into a season today is a Nachnominierung
 */
export const spielerGetSpielerNachnominierung = async (
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerNachnominierungResponse> => {
  return adminKeyTransport<FLSpielerNachnominierungResponse>(getSpielerGetSpielerNachnominierungUrl(saisonId), {
    ...options,
    method: "GET",
  });
};

export const getSpielerGetSelbstUrl = () => {
  return `/api/v0/spieler/selbst`;
};

/**
 * Answer the signed-in address's own pupil record's stored data with every squad row it holds.
 *
 * PERSON TIER: the whole surname and the birthdate, never masked, and never the sign-in address itself. A retired
 * record is served too. Its consent is the account page's (`GET /konto/einwilligungen`), so none is served here.
 *
 * Refuses an address holding no confirmed pupil record (`REQ-FUNKTION-001`).
 * @summary A signed-in pupil's own record
 */
export const spielerGetSelbst = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLSpielerSelbstResponse> => {
  return adminKeyTransport<FLSpielerSelbstResponse>(getSpielerGetSelbstUrl(), {
    ...options,
    method: "GET",
  });
};

export const getSpielerPatchEinwilligungUrl = () => {
  return `/api/v0/spieler/selbst/einwilligung`;
};

/**
 * Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.
 *
 * Writes those two on this one record, each moved choice with its evidence (`nachweis.<choice>`), and nothing else:
 * the confirmation day, the day given and the wording they confirmed stand, and no other document is written. A
 * PATCH moving neither choice writes nothing. A GRANT (`umfang` to `kader_oeffentlich` or `medien` to `true`) is
 * taken on a live record alone; a withdrawal on a retired one too.
 *
 * Refuses, in this order: an address holding no confirmed pupil record (`REQ-FUNKTION-001`); a `nachweis_stand`
 * other than the record's own, either choice having moved since the page was served (`REQ-EINWILLIGUNG-003`); a
 * grant on a retired record (`REQ-EINWILLIGUNG-004`); a `text_version` naming no version of the account page's pupil
 * control, or a grant naming any but the page's running one (`REQ-EINWILLIGUNG-001`); `medien` moving to `true` where
 * the stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`REQ-EINWILLIGUNG-002`); and a
 * grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), which counts grants alone, so a
 * withdrawal is never refused for it. Each refusal writes nothing.
 *
 * **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
 * name is served, and nothing here can.
 * @summary Change a signed-in pupil's own publication and media consent
 */
export const spielerPatchEinwilligung = async (
  fLSpielerSelbstEinwilligungPayload: FLSpielerSelbstEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerSelbstEinwilligungResponse> => {
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
  return adminKeyTransport<FLSpielerSelbstEinwilligungResponse>(getSpielerPatchEinwilligungUrl(), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSpielerSelbstEinwilligungPayload),
  });
};

export const getSpielerDeleteSpielerUrl = (spielerId: string) => {
  return `/api/v0/spieler/${spielerId}`;
};

/**
 * Retire a player. SOFT: it stamps `inactive_since`, and their squad rows are LEFT ALONE.
 * @summary Retire a Spieler (soft delete)
 */
export const spielerDeleteSpieler = async (
  spielerId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerAdminSingleResponse> => {
  return adminKeyTransport<FLSpielerAdminSingleResponse>(getSpielerDeleteSpielerUrl(spielerId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielerGetSpielerByIdUrl = (spielerId: string) => {
  return `/api/v0/spieler/${spielerId}`;
};

/**
 * Return one player -- an id, a forename and an INITIAL, which is all this surface needs.
 *
 * Both names are `null` where the person's consent record does not publish them (`READ-PUPIL-003`).
 *
 * NOT the flattened squad shape the list returns: those are season-scoped, and picking a season
 * here would make the answer depend on a default nobody asked for.
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

export const getSpielerPatchSpielerUrl = (spielerId: string) => {
  return `/api/v0/spieler/${spielerId}`;
};

/**
 * Replace a player's own facts wholesale. No fan-out: unlike a team or a venue, a person is embedded in no other document.
 * @summary Update a Spieler's name
 */
export const spielerPatchSpieler = async (
  spielerId: string,
  fLPatchSpielerPayload: FLPatchSpielerPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerAdminSingleResponse> => {
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
  return adminKeyTransport<FLSpielerAdminSingleResponse>(getSpielerPatchSpielerUrl(spielerId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSpielerPayload),
  });
};

export const getSpielerReactivateSpielerUrl = (spielerId: string) => {
  return `/api/v0/spieler/${spielerId}/reactivate`;
};

/**
 * Clear `inactive_since`: the PERSON is back in the league. A squad row they left is revived by its own reactivate.
 * @summary Bring a retired Spieler back
 */
export const spielerReactivateSpieler = async (
  spielerId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielerAdminSingleResponse> => {
  return adminKeyTransport<FLSpielerAdminSingleResponse>(getSpielerReactivateSpielerUrl(spielerId), {
    ...options,
    method: "POST",
  });
};

export const getSpielerPostSaisonSpielerUrl = (spielerId: string) => {
  return `/api/v0/spieler/${spielerId}/saisons`;
};

/**
 * Put a player in a team's squad for a season.
 *
 * 404 where no player has this id. One row per player per season: moving a player is a PATCH of
 * `team_id`, and a repeat is a 409 even where the row is retired. A
 * squad holds each `rolle` once (`REQ-SQUAD-004`). `ist_nachnominiert` is derived here and never
 * taken from the body: it is true from the first day of the season's matchday 1, and false while
 * that matchday is undated.
 * @summary Add a Spieler to a squad
 */
export const spielerPostSaisonSpieler = async (
  spielerId: string,
  fLPostSaisonSpielerPayload: FLPostSaisonSpielerPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonSpielerResponse> => {
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
  return adminKeyTransport<FLSaisonSpielerResponse>(getSpielerPostSaisonSpielerUrl(spielerId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostSaisonSpielerPayload),
  });
};

export const getSpielerDeleteSaisonSpielerUrl = (spielerId: string, saisonId: string) => {
  return `/api/v0/spieler/${spielerId}/saisons/${saisonId}`;
};

/**
 * Take a player out of a season's squad. SOFT: the row stays.
 *
 * The row records that this player wore this number in this squad, which stays true after they
 * leave. `GET /spieler/memberships` is where an admin reads it back, marked by `inactive_since`.
 * @summary Remove a Spieler from a squad
 */
export const spielerDeleteSaisonSpieler = async (
  spielerId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonSpielerResponse> => {
  return adminKeyTransport<FLSaisonSpielerResponse>(getSpielerDeleteSaisonSpielerUrl(spielerId, saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielerPatchSaisonSpielerUrl = (spielerId: string, saisonId: string) => {
  return `/api/v0/spieler/${spielerId}/saisons/${saisonId}`;
};

/**
 * Update a player's squad entry for that season.
 *
 * Changing `team_id` is how a transfer is recorded. A DUPLICATE `nummer` is permitted
 * (`docs/domain.md`'s what the model permits on purpose); a `rolle` another live row holds is not
 * (`REQ-SQUAD-004`).
 * @summary Update a squad entry
 */
export const spielerPatchSaisonSpieler = async (
  spielerId: string,
  saisonId: string,
  fLPatchSaisonSpielerPayload: FLPatchSaisonSpielerPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonSpielerResponse> => {
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
  return adminKeyTransport<FLSaisonSpielerResponse>(getSpielerPatchSaisonSpielerUrl(spielerId, saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSaisonSpielerPayload),
  });
};

export const getSpielerReactivateSaisonSpielerUrl = (spielerId: string, saisonId: string) => {
  return `/api/v0/spieler/${spielerId}/saisons/${saisonId}/reactivate`;
};

/**
 * Clear a squad row's `inactive_since`, with the number and position it had.
 *
 * Where a repeat create is redirected: a create reviving the row
 * would overwrite both. Refused where the squad has filled up, where its club left, or where the
 * `rolle` the row carries has been given to somebody else since (`REQ-SQUAD-004`).
 * @summary Put a Spieler back in a squad they left
 */
export const spielerReactivateSaisonSpieler = async (
  spielerId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonSpielerResponse> => {
  return adminKeyTransport<FLSaisonSpielerResponse>(getSpielerReactivateSaisonSpielerUrl(spielerId, saisonId), {
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
 * @summary Create a Spielort
 */
export const spielortePostSpielort = async (
  fLPostSpielortPayload: FLPostSpielortPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostSpielortResponse> => {
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
  return adminKeyTransport<FLPostSpielortResponse>(getSpielortePostSpielortUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostSpielortPayload),
  });
};

export const getSpielorteDeleteSpielortUrl = (spielortId: string) => {
  return `/api/v0/spielorte/${spielortId}`;
};

/**
 * Deactivate a venue. SOFT: it stamps `inactive_since`, and the document stays.
 *
 * Matches embed a copy, so a hard delete would orphan every historical match that used it. Refused
 * while an unplayed fixture is still booked here (`REQ-RETIRE-003`).
 * @summary Deactivate a Spielort (soft delete)
 */
export const spielorteDeleteSpielort = async (
  spielortId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielortWriteResponse> => {
  return adminKeyTransport<FLSpielortWriteResponse>(getSpielorteDeleteSpielortUrl(spielortId), {
    ...options,
    method: "DELETE",
  });
};

export const getSpielorteGetSpielortUrl = (spielortId: string) => {
  return `/api/v0/spielorte/${spielortId}`;
};

/**
 * Admin-tier as the list is, and for the same two rules (`READ-MONEY-001`, `READ-ADDRESS-001`).
 *
 * Deactivated ones included -- a historical match's venue is the case worth answering.
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
  return `/api/v0/spielorte/${spielortId}`;
};

/**
 * Update a venue, then update every Spiel that embeds it.
 *
 * The fan-out is not optional: without it, match cards keep showing the old name. `mietpreis` is
 * NOT fanned out -- the rent on a match is what was agreed for that match.
 * @summary Update a Spielort and fan the change out
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
  return `/api/v0/spielorte/${spielortId}/reactivate`;
};

/**
 * Clear `inactive_since`, putting the venue back into the picker and every default read.
 * @summary Bring a deactivated Spielort back
 */
export const spielorteReactivateSpielort = async (
  spielortId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpielortWriteResponse> => {
  return adminKeyTransport<FLSpielortWriteResponse>(getSpielorteReactivateSpielortUrl(spielortId), {
    ...options,
    method: "POST",
  });
};

export const getSpieltageGetSpieltageUrl = (params?: SpieltageGetSpieltageParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spieltage?${stringifiedParams}` : `/api/v0/spieltage`;
};

/**
 * List matchdays for a season, in the order they are played.
 *
 * That order is the phase in bracket order, then the stored `position` -- `sort_by=natural`.
 * Omitting `saison_id` returns the CURRENT season; one this tier may not read 404s.
 * @summary List Spieltage
 */
export const spieltageGetSpieltage = async (
  params?: SpieltageGetSpieltageParams,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLSpieltageListResponse> => {
  return baseKeyTransport<FLSpieltageListResponse>(getSpieltageGetSpieltageUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpieltageGetSpieltageForAdminUrl = (params?: SpieltageGetSpieltageForAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/spieltage/list/admin?${stringifiedParams}` : `/api/v0/spieltage/list/admin`;
};

/**
 * List a season's matchdays for the admin surfaces, a `future` season's included.
 *
 * Same filters, order and shape as `GET /spieltage`, without its season gate: a season's matchdays
 * are drawn while it is planned, and dating them is what this list is for.
 * @summary Spieltage for the admin surfaces
 */
export const spieltageGetSpieltageForAdmin = async (
  params?: SpieltageGetSpieltageForAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieltageListResponse> => {
  return adminKeyTransport<FLSpieltageListResponse>(getSpieltageGetSpieltageForAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getSpieltageGetSpieltagUrl = (spieltagId: string) => {
  return `/api/v0/spieltage/${spieltagId}`;
};

/**
 * Return one matchday by its id.
 *
 * Its OWN `saison_id` is resolved rather than the current season's, the derived match count needing
 * that season's rules. A matchday of a season this tier may not read 404s.
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
  return `/api/v0/spieltage/${spieltagId}`;
};

/**
 * Move a matchday's span.
 *
 * No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. The span is held
 * to its season's, to the days its own fixtures stand on, and its `beginn` to the order its phase is dated in.
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

export const getSpieltageGetSpieltagForAdminUrl = (spieltagId: string) => {
  return `/api/v0/spieltage/${spieltagId}/admin`;
};

/**
 * Return one matchday by its id for the admin editor, a `future` season's included.
 *
 * Same shape as `GET /spieltage/{spieltag_id}`, without its season gate: the editor opens a
 * matchday to date it, and that happens before its season is ever activated.
 * @summary One Spieltag for the admin editor
 */
export const spieltageGetSpieltagForAdmin = async (
  spieltagId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSpieltageSingleResponse> => {
  return adminKeyTransport<FLSpieltageSingleResponse>(getSpieltageGetSpieltagForAdminUrl(spieltagId), {
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

export const getTeamsGetTeamsUrl = (params?: TeamsGetTeamsParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/teams?${stringifiedParams}` : `/api/v0/teams`;
};

/**
 * List teams for a season.
 *
 * `in_gruppen=true` returns the groups the season offers, keyed by group name, otherwise a plain list; check `format`.
 * Omitting `saison_id` returns the CURRENT season; one this tier may not read 404s, and a club that left the league
 * is listed in a `past` season alone.
 * @summary List teams, flat or grouped
 */
export const teamsGetTeams = async (
  params?: TeamsGetTeamsParams,
  options?: Parameters<typeof baseKeyTransport>[1],
): Promise<FLTeamsListResponse | FLTeamsGroupedResponse> => {
  return baseKeyTransport<FLTeamsListResponse | FLTeamsGroupedResponse>(getTeamsGetTeamsUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getTeamsPostTeamUrl = () => {
  return `/api/v0/teams`;
};

/**
 * Create a club. `shorthand` is unique across every club, retired ones included, so a duplicate is a 409.
 * @summary Create a team
 */
export const teamsPostTeam = async (
  fLPostTeamPayload: FLPostTeamPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPostTeamResponse> => {
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
  return adminKeyTransport<FLPostTeamResponse>(getTeamsPostTeamUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostTeamPayload),
  });
};

export const getTeamsGetTeamsForAdminUrl = (params?: TeamsGetTeamsForAdminParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/teams/list/admin?${stringifiedParams}` : `/api/v0/teams/list/admin`;
};

/**
 * List a season's teams for the admin surfaces, a `future` season's included.
 *
 * Same filters and shapes as `GET /teams`, without its season gate: a club is entered while its
 * season is still planned, so an admin who cannot see one cannot enter it.
 * @summary Teams for a Saison, for the admin surfaces
 */
export const teamsGetTeamsForAdmin = async (
  params?: TeamsGetTeamsForAdminParams,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLTeamsListResponse | FLTeamsGroupedResponse> => {
  return adminKeyTransport<FLTeamsListResponse | FLTeamsGroupedResponse>(getTeamsGetTeamsForAdminUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getTeamsGetTeamMembershipsUrl = () => {
  return `/api/v0/teams/memberships`;
};

/**
 * Every team, retired ones included, each with every season membership it holds. Sorted by name.
 *
 * `GET /teams` cannot answer it: that read is season-scoped with a strict junction join. Each membership names the live
 * change of each seat's address, which the address tool shows, and per seat why the tool refuses that change this
 * administrator.
 * @summary Every team with its season memberships
 */
export const teamsGetTeamMemberships = async (options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLTeamsMembershipsResponse> => {
  return adminKeyTransport<FLTeamsMembershipsResponse>(getTeamsGetTeamMembershipsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getTeamsDeleteTeamUrl = (teamId: string) => {
  return `/api/v0/teams/${teamId}`;
};

/**
 * Retire a club from the league. SOFT: `inactive_since` is stamped and the document stays.
 *
 * Refused while the club is entered in an `active` or `future` season. Its junction rows are left
 * alone: the seasons it played still happened.
 * @summary Retire a team (soft delete)
 */
export const teamsDeleteTeam = async (teamId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLTeamWriteResponse> => {
  return adminKeyTransport<FLTeamWriteResponse>(getTeamsDeleteTeamUrl(teamId), {
    ...options,
    method: "DELETE",
  });
};

export const getTeamsGetTeamUrl = (teamId: string, params?: TeamsGetTeamParams) => {
  const stringifiedParams = serializeQuery(params);

  return stringifiedParams.length > 0 ? `/api/v0/teams/${teamId}?${stringifiedParams}` : `/api/v0/teams/${teamId}`;
};

/**
 * Return one team, with its group and its statistics for a season.
 *
 * The path names WHICH TEAM; the query names WHICH SEASON'S figures: `gruppe` and `statistik` are
 * season-scoped. 404 where the team, its row or the season is one this tier cannot read.
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

export const getTeamsPatchTeamUrl = (teamId: string) => {
  return `/api/v0/teams/${teamId}`;
};

/**
 * Update a club, then rewrite the name and shorthand its unfinished seasons carry.
 *
 * The junction and every match hold a copy of both; a `past`
 * season keeps the name it was played under.
 * @summary Update a team and fan the rename out
 */
export const teamsPatchTeam = async (
  teamId: string,
  fLPatchTeamPayload: FLPatchTeamPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPatchTeamResponse> => {
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
  return adminKeyTransport<FLPatchTeamResponse>(getTeamsPatchTeamUrl(teamId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchTeamPayload),
  });
};

export const getTeamsReactivateTeamUrl = (teamId: string) => {
  return `/api/v0/teams/${teamId}/reactivate`;
};

/**
 * Clear `inactive_since`, restoring a retired club to reads that hide retired ones.
 * @summary Bring a retired team back
 */
export const teamsReactivateTeam = async (teamId: string, options?: Parameters<typeof adminKeyTransport>[1]): Promise<FLTeamWriteResponse> => {
  return adminKeyTransport<FLTeamWriteResponse>(getTeamsReactivateTeamUrl(teamId), {
    ...options,
    method: "POST",
  });
};

export const getTeamsPostSaisonTeamUrl = (teamId: string) => {
  return `/api/v0/teams/${teamId}/saisons`;
};

/**
 * Enter a team into a season, in a group, under the name the club carries today.
 *
 * A club with no row here is ABSENT from that season rather than merely unlisted.
 * @summary Enter a team into a season
 */
export const teamsPostSaisonTeam = async (
  teamId: string,
  fLPostSaisonTeamPayload: FLPostSaisonTeamPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonTeamResponse> => {
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
  return adminKeyTransport<FLSaisonTeamResponse>(getTeamsPostSaisonTeamUrl(teamId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPostSaisonTeamPayload),
  });
};

export const getTeamsPatchSaisonTeamUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}`;
};

/**
 * Rewrite a team's row for one season: group, exit record and kit colour.
 *
 * All three are required and replaced WHOLESALE: an omitted key is a 422, never a team reinstated.
 * The contact block is `PATCH .../kontakte`'s.
 * @summary Rewrite a team's season row: group, exit record and kit colour
 */
export const teamsPatchSaisonTeam = async (
  teamId: string,
  saisonId: string,
  fLPatchSaisonTeamPayload: FLPatchSaisonTeamPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonTeamResponse> => {
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
  return adminKeyTransport<FLSaisonTeamResponse>(getTeamsPatchSaisonTeamUrl(teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSaisonTeamPayload),
  });
};

export const getTeamsDeleteEinladungUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/einladung`;
};

/**
 * Stamp this team's live registration link revoked, so it opens nothing from here on.
 *
 * The row stays: a delivery event about a message carrying that link still has somewhere to land, and a reissue's history is what says
 * which link a bounce was about. 404 where the team holds no live link for the season; a link of a season that has ended stays revocable.
 * @summary Revoke this team's live registration link for a season
 */
export const teamsDeleteEinladung = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLEinladungWriteResponse> => {
  return adminKeyTransport<FLEinladungWriteResponse>(getTeamsDeleteEinladungUrl(teamId, saisonId), {
    ...options,
    method: "DELETE",
  });
};

export const getTeamsGetEinladungUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/einladung`;
};

/**
 * What this team's live registration link for the season is, or that it holds none, beside the window deciding what it opens.
 *
 * **No hash and no raw value**: the link itself was answered once, by the mint. What is served is who minted it and when, and what became
 * of the last message sent about it — a `versand.zustellung` absent, or naming no message, means nobody has mailed it, which is a state
 * rather than a delivery failure. The minter is `null` beside `erstellt_von_gesperrt` where the ban list holds that address, as no barred
 * address is served in plain.
 *
 * `laeuft` is the season's registration window judged against today, and false for good once the season has ended; it is the whole of
 * the link's expiry. 404 where no season holds that id; a team with no invitation answers `einladung: null` rather than a 404.
 * @summary This team's live registration link for a season, and whether it opens anything
 */
export const teamsGetEinladung = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLEinladungResponse> => {
  return adminKeyTransport<FLEinladungResponse>(getTeamsGetEinladungUrl(teamId, saisonId), {
    ...options,
    method: "GET",
  });
};

export const getTeamsPostEinladungUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/einladung`;
};

/**
 * Mint the link a team's players register through, revoking whatever link that team held for this season.
 *
 * **The raw link value is in this answer and in no other, ever**: the row stores an unkeyed SHA-256 of it, so a link nobody copied out of
 * this response is lost and the repair is another mint. Mailing it is a separate press.
 *
 * The reissue is part of the same transaction, so the previous link stops opening anything the moment this answers, and the team is left
 * holding exactly one live invitation. The link carries no date: it expires with the season's registration window, which is judged afresh
 * every time somebody opens it, so a window moved after the mint moves this link with it.
 *
 * Refused where the season holds no junction row for this team (`REQ-EINLADUNG-001`) and where the season has ended
 * (`REQ-EINLADUNG-002`); a `future` season mints, the links being prepared before the window opens. 404 where no season holds that id.
 *
 * **A team that has left the season still mints here**, where the season-wide send passes it over: this call names one team an
 * administrator is looking at, and a squad row and a contact correction are accepted for such a team too.
 *
 * A mint voiding a live link is refused `REQ-AUTH-009` from a sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`, and
 * writes nothing; a team's first link is not.
 * @summary Mint this team's registration link for a season
 */
export const teamsPostEinladung = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLEinladungMintResponse> => {
  return adminKeyTransport<FLEinladungMintResponse>(getTeamsPostEinladungUrl(teamId, saisonId), {
    ...options,
    method: "POST",
  });
};

export const getTeamsPatchSaisonTeamKontakteUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/kontakte`;
};

/**
 * Rewrite the three people this team is reached through for one season. Null clears the block.
 *
 * Its own endpoint so the contacts editor and the club editor cannot clobber one row. The one
 * rule's refusal is `REQ-KONTAKT-001`: the body echoes back the `kontakte_stand` its caller was served
 * beside the block, and a row whose block answers to another token is refused rather than
 * overwritten, an erasure between the caller's read and this write being what moves it. A clearing,
 * which nothing restores, is refused `REQ-AUTH-009` from a sign-in or confirmation older than
 * `STEP_UP_WINDOW_HOURS`. A `past` season's contacts stay correctable. Each seat's `eingetragen_von` and
 * `bestaetigt_am` are the server's: a seat keeping its person keeps both, and a seat newly filled or handed
 * on is stored as the league's entry, unconfirmed.
 *
 * **Each person the save newly seats is minted a confirmation link**, answered raw once in `bestaetigungen` for the
 * caller to mail: one per person, covering both seats where the Trainer holds a second. A seat keeping its person
 * keeps their link, and a seat emptied or handed on loses the one it held and its links on the team's open match
 * confirmations, so the person who left it holds nothing live. A save newly seating an address the ban list holds is
 * refused `REQ-KONTAKT-003`, as the re-send to one is. On a row of a `past` season, or of a team that has left it, the
 * link is how its person learns of the entry, and it takes their Widerspruch alone. A save minting a link, emptying
 * or handing on a seat, or voiding a link its person could still answer, is refused `REQ-AUTH-009` as the clearing
 * is; a save doing none of these is not.
 *
 * **Each mailbox the save takes off a seat is answered in `abgaenge`** for the caller to tell, with every seat it
 * lost, a mailbox still holding another seat of the row included. A mailbox the save mints a link is not one: that
 * link's mail names the seats it holds now.
 *
 * **A seat the same person keeps keeps its record whole**, each choice and its evidence included; a seat newly filled
 * or handed to another person is born granting nothing, its media consent off and no choice evidenced, since only a
 * person's own write grants one. Such a seat's label must be the application form's running one
 * (`REQ-EINWILLIGUNG-001`). A kept seat may name its stored label back, whichever page it is a version of, or the
 * running one, and its record is carried either way.
 * @summary Rewrite a team's season contacts, and nothing else on the row
 */
export const teamsPatchSaisonTeamKontakte = async (
  teamId: string,
  saisonId: string,
  fLPatchSaisonTeamKontaktePayload: FLPatchSaisonTeamKontaktePayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLPatchSaisonTeamKontakteResponse> => {
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
  return adminKeyTransport<FLPatchSaisonTeamKontakteResponse>(getTeamsPatchSaisonTeamKontakteUrl(teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLPatchSaisonTeamKontaktePayload),
  });
};

export const getTeamsEinladenKontaktUrl = (teamId: string, saisonId: string, seat: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/kontakte/${seat}/bestaetigung/einladen`;
};

/**
 * Mint a fresh confirmation link for one contact seat and answer it raw once, for the caller to mail.
 *
 * It replaces the seat's link WHOLE, and its pair's where the Trainer holds both and has not confirmed the other:
 * the previous link stops opening anything, the delivery state of the message it went out in goes with it, and the
 * deadline restarts from today.
 *
 * Refused where the season has ended or the team has left it (`REQ-KONTAKT-005`), where the seat holds nobody or its
 * person has already confirmed it (`REQ-KONTAKT-002`), and where its address is on the ban list (`REQ-KONTAKT-003`).
 * 404 for a team and season holding no row, and for a path naming no seat. Every call mints, so every call from a
 * sign-in or confirmation older than `STEP_UP_WINDOW_HOURS` is refused `REQ-AUTH-009`.
 * @summary Send one contact seat a fresh confirmation link
 */
export const teamsEinladenKontakt = async (
  teamId: string,
  saisonId: string,
  seat: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLKontaktEinladenResponse> => {
  return adminKeyTransport<FLKontaktEinladenResponse>(getTeamsEinladenKontaktUrl(teamId, saisonId, seat), {
    ...options,
    method: "POST",
  });
};

export const getTeamsPatchEinwilligungUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/person/einwilligung`;
};

/**
 * Set the signed-in person's two consents on every seat they hold on this team's season row: WhatsApp and media.
 *
 * One answer for all of them: a person holding two of the row's slots answers once, each choice moving only where it
 * differs from the row as the page served it, so seats answered apart keep their answers to a choice not changed. No
 * other slot of the row and no other row is written, each choice moving with its own evidence and leaving the
 * other standing; a press moving no seat writes nothing. A GRANT (`umfang` to `kontaktdaten_whatsapp` or `medien`
 * to `true`) is taken on a row of an `active` or `future` season its team has not left; a withdrawal on any row the
 * person confirmed a seat on, a past season's included.
 *
 * Refuses, in this order: a row on which the address holds no confirmed seat (`REQ-FUNKTION-001`); a
 * `nachweis_stand` other than the held seats' own, either choice having moved since the page was served
 * (`REQ-EINWILLIGUNG-003`); a grant where the row grants no panel (`REQ-EINWILLIGUNG-004`); a `text_version` naming no
 * version of the account page's seat control, or a grant naming any but its running one (`REQ-EINWILLIGUNG-001`);
 * `medien` moving to `true` where a held seat's stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is
 * missing (`REQ-EINWILLIGUNG-002`); and a grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`),
 * which counts grants alone, so a withdrawal is never refused for it. Each refusal writes nothing.
 * @summary Change a seat holder's own WhatsApp and media consent on one team's season
 */
export const teamsPatchEinwilligung = async (
  teamId: string,
  saisonId: string,
  fLSaisonTeamPersonEinwilligungPayload: FLSaisonTeamPersonEinwilligungPayload,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLSaisonTeamPersonEinwilligungResponse> => {
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
  return adminKeyTransport<FLSaisonTeamPersonEinwilligungResponse>(getTeamsPatchEinwilligungUrl(teamId, saisonId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLSaisonTeamPersonEinwilligungPayload),
  });
};

export const getTeamsGetTeamSitzeUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/person/sitze`;
};

/**
 * The team's three seats in this season, each with its holder's name and whether that person has confirmed it.
 *
 * Always three lines, an empty slot answered with no name. No seat's address, telephone number, birthdate or
 * confirmation date is served, whoever asks.
 * @summary A team's seats in one season
 */
export const teamsGetTeamSitze = async (
  teamId: string,
  saisonId: string,
  options?: Parameters<typeof adminKeyTransport>[1],
): Promise<FLTeamSitzeResponse> => {
  return adminKeyTransport<FLTeamSitzeResponse>(getTeamsGetTeamSitzeUrl(teamId, saisonId), {
    ...options,
    method: "GET",
  });
};

export const getTeamsReplaceSaisonTeamUrl = (teamId: string, saisonId: string) => {
  return `/api/v0/teams/${teamId}/saisons/${saisonId}/replace`;
};

/**
 * Hand this season's junction row, and every fixture on it, to another club.
 *
 * Its `team_id`, identity copy, `austritt` and every fixture side move, and the outgoing club's
 * live squad rows are retired, in ONE transaction: the schedule survives.
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

export const getZustellungPostZustellungUrl = () => {
  return `/api/v0/zustellung`;
};

/**
 * Record what the mail provider reported about one message, on the record that message was sent about.
 *
 * Applied only where the event names the message the record still holds AND is stamped strictly later than the state it holds: a
 * re-send mints a new message, so the old one's bounce must not mark the fresh link, and a redelivery or an event overtaken by a
 * later one changes nothing. Both are answered with `angewendet: false` rather than with a refusal, because the provider retries
 * anything but a success and would resend a settled event for hours.
 *
 * 404 where no document of that kind has the id, which a record erased between the send and the event is: a caller that must not
 * retry maps it rather than repeating the call.
 *
 * A `kontakt` or `spielbestaetigung` record sits under each contact seat, so its report names in `rollen` every seat the one message
 * reached, each judged and written on its own, and `angewendet` is true where any was; every other kind names none, a mismatch being a
 * 422.
 * @summary Apply one delivery event to the record its message was sent about
 */
export const zustellungPostZustellung = async (
  fLZustellungEreignisPayload: FLZustellungEreignisPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLZustellungResponse> => {
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
  return systemKeyTransport<FLZustellungResponse>(getZustellungPostZustellungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLZustellungEreignisPayload),
  });
};

export const getZustellungAbgewiesenZustellungUrl = () => {
  return `/api/v0/zustellung/abgewiesen`;
};

/**
 * Record that the mail provider refused the send itself, so no message about this record exists.
 *
 * The send is where a refused address is learnt at all: nothing is minted, no delivery event ever follows, and a record left without
 * this state is one the reminder clocks chase and the deadline clocks erase as though the link had been read.
 *
 * Judged as an accepted send is, both stamps being this sender's: applied only where this refusal is newer than the ACCEPT the record
 * already holds, so a call retried after the re-send that repaired the address writes nothing, and a delivery state the provider
 * stamped never blocks it. A record whose document carries no delivery bookkeeping at all is skipped rather than refused. 404 where no
 * document of that kind has the id.
 *
 * A `kontakt` or `spielbestaetigung` record sits under each contact seat, so its report names in `rollen` every seat the one message
 * reached, each judged and written on its own, and `angewendet` is true where any was; every other kind names none, a mismatch being a
 * 422.
 * @summary Record the send the provider refused for this record
 */
export const zustellungAbgewiesenZustellung = async (
  fLZustellungAbgewiesenPayload: FLZustellungAbgewiesenPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLZustellungResponse> => {
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
  return systemKeyTransport<FLZustellungResponse>(getZustellungAbgewiesenZustellungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLZustellungAbgewiesenPayload),
  });
};

export const getZustellungAngenommenZustellungUrl = () => {
  return `/api/v0/zustellung/angenommen`;
};

/**
 * Record that the mail provider accepted one message about the record named, under the id it answered with.
 *
 * That id is the only join between a send and any later delivery event, so a record carrying none is a record every event about it
 * is discarded for. Accepting a request is not delivering it: what this records is that the provider took the message, and
 * `POST /zustellung` is where the recipient's own mail server is heard from.
 *
 * Applied only where this send is newer than the ACCEPT the record already holds, so a call retried after a later one landed
 * writes nothing, and the answer says whether anything was written; a delivery state the provider stamped never blocks it, that
 * stamp being the provider's clock rather than this sender's. A record whose document carries no delivery bookkeeping at all --
 * never mailed, or emptied by an erasure -- is skipped rather than refused. 404 where no document of that kind has the id.
 *
 * A `kontakt` or `spielbestaetigung` record sits under each contact seat, so its report names in `rollen` every seat the one message
 * reached, each judged and written on its own, and `angewendet` is true where any was; every other kind names none, a mismatch being a
 * 422.
 * @summary Record the message the provider accepted for this record
 */
export const zustellungAngenommenZustellung = async (
  fLZustellungAngenommenPayload: FLZustellungAngenommenPayload,
  options?: Parameters<typeof systemKeyTransport>[1],
): Promise<FLZustellungResponse> => {
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
  return systemKeyTransport<FLZustellungResponse>(getZustellungAngenommenZustellungUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...getHeaders(options?.headers) },
    body: JSON.stringify(fLZustellungAngenommenPayload),
  });
};
