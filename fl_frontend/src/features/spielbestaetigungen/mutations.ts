import {
  spielbestaetigungenAngefragtSpielbestaetigungen,
  spielbestaetigungenEintragenSpielbestaetigung,
  spielbestaetigungenGetSpielbestaetigungAnsicht,
  spielbestaetigungenGetSpielSweepSaisons,
  spielbestaetigungenMitgeteiltSpielbestaetigungen,
  spielbestaetigungenPostSchiedsrichterAntwort,
  spielbestaetigungenPostSpielbestaetigung,
  spielbestaetigungenSweepSpielbestaetigungen,
  spielbestaetigungenVerwerfenSpielbestaetigung,
} from "@/core/generated/client/sdk";

import type {
  FLSpielbestaetigungAnsichtResponse,
  FLSpielbestaetigungAntwortPayload,
  FLSpielbestaetigungAntwortResponse,
  FLSpielbestaetigungSchiedsrichterAntwortPayload,
  FLSpielbestaetigungSchiedsrichterAntwortResponse,
  FLSpielbestaetigungSweepAngefragtPayload,
  FLSpielbestaetigungSweepAngefragtResponse,
  FLSpielbestaetigungSweepMitgeteiltPayload,
  FLSpielbestaetigungSweepMitgeteiltResponse,
  FLSpielbestaetigungSweepResponse,
  FLSpielbestaetigungSweepSaisonsResponse,
  FLSpielbestaetigungWriteResponse,
  FLTokenPayload,
} from "@/core/generated/client/types";
import type { FLSpielbestaetigungEintragenPayload, FLSpielbestaetigungVerwerfenPayload } from "./schemas";

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postSpielbestaetigungAnsicht(payload: FLTokenPayload): Promise<FLSpielbestaetigungAnsichtResponse> {
  return spielbestaetigungenGetSpielbestaetigungAnsicht(payload, { readOnly: true });
}

/** One club's answer, at the base tier: the token authorises, and an over-declared tier succeeds silently. */
export async function postSpielbestaetigung(payload: FLSpielbestaetigungAntwortPayload): Promise<FLSpielbestaetigungAntwortResponse> {
  return spielbestaetigungenPostSpielbestaetigung(payload);
}

/** A referee's answer to a row of their own, on the person lane: the signed-in address is what the backend authorises. */
export async function postSpielbestaetigungAntwort(
  spielbestaetigungId: string,
  payload: FLSpielbestaetigungSchiedsrichterAntwortPayload,
): Promise<FLSpielbestaetigungSchiedsrichterAntwortResponse> {
  return spielbestaetigungenPostSchiedsrichterAntwort(spielbestaetigungId, payload);
}

/**
 * The seasons the confirmation pass visits. Here rather than in a `queries.ts` because every read there is
 * cached for a render, and this one answers a timer. The system tier, not admin: the timer holds no session, and an
 * invented actor for a machine is what `fl_backend/app/core/recording.py :: SYSTEM_ACTOR` exists to avoid.
 */
export async function getSpielbestaetigungSweepSaisons(): Promise<FLSpielbestaetigungSweepSaisonsResponse> {
  return spielbestaetigungenGetSpielSweepSaisons();
}

/** One season's pass: rows closed, minted and reminded, the reminders already stamped and the requests not. */
export async function postSpielbestaetigungSweep(saisonId: string): Promise<FLSpielbestaetigungSweepResponse> {
  return spielbestaetigungenSweepSpielbestaetigungen(saisonId);
}

/**
 * Stamps the rows whose first messages went, after they went: a row a failed send leaves unstamped reads as never
 * asked rather than as a silence.
 */
export async function postSpielbestaetigungSweepAngefragt(
  saisonId: string,
  payload: FLSpielbestaetigungSweepAngefragtPayload,
): Promise<FLSpielbestaetigungSweepAngefragtResponse> {
  return spielbestaetigungenAngefragtSpielbestaetigungen(saisonId, payload);
}

/** Stamps the rows whose notices went, after they went: a notice no stamp names is answered again by the next pass. */
export async function postSpielbestaetigungSweepMitgeteilt(
  saisonId: string,
  payload: FLSpielbestaetigungSweepMitgeteiltPayload,
): Promise<FLSpielbestaetigungSweepMitgeteiltResponse> {
  return spielbestaetigungenMitgeteiltSpielbestaetigungen(saisonId, payload);
}

export async function eintragenSpielbestaetigung({
  id,
  ...fields
}: FLSpielbestaetigungEintragenPayload): Promise<FLSpielbestaetigungWriteResponse> {
  return spielbestaetigungenEintragenSpielbestaetigung(id, fields);
}

export async function verwerfenSpielbestaetigung({ id }: FLSpielbestaetigungVerwerfenPayload): Promise<FLSpielbestaetigungWriteResponse> {
  return spielbestaetigungenVerwerfenSpielbestaetigung(id);
}
