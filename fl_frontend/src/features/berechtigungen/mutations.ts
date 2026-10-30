import {
  berechtigungenDeleteAntrag,
  berechtigungenDeleteBerechtigung,
  berechtigungenPatchBerechtigung,
  berechtigungenPostAntragGenehmigung,
  berechtigungenPostBerechtigung,
  berechtigungenPostBerechtigungenAbgleich,
  berechtigungenPostBerechtigungenAngekuendigt,
} from "@/core/generated/client/sdk";

import type {
  FLBerechtigungAbgleichResponse,
  FLBerechtigungAngekuendigtPayload,
  FLBerechtigungAngekuendigtResponse,
  FLBerechtigungAntragAbgelehntResponse,
  FLBerechtigungStufeResponse,
  FLBerechtigungWriteResponse,
  FLPostBerechtigungPayload,
  FLPostBerechtigungResponse,
} from "@/core/generated/client/types";
import type { FLBerechtigungAntragKeyPayload, FLBerechtigungKeyPayload, FLPatchBerechtigungPayload } from "./schemas";

export async function postBerechtigung(payload: FLPostBerechtigungPayload): Promise<FLPostBerechtigungResponse> {
  return berechtigungenPostBerechtigung(payload);
}

// Hard, as the ban's removal is: a revoked grant keeps nothing to restore.
export async function deleteBerechtigung({ id }: FLBerechtigungKeyPayload): Promise<FLBerechtigungWriteResponse> {
  return berechtigungenDeleteBerechtigung(id);
}

export async function patchBerechtigung({ id, verwaltung }: FLPatchBerechtigungPayload): Promise<FLBerechtigungStufeResponse> {
  return berechtigungenPatchBerechtigung(id, { verwaltung: verwaltung });
}

export async function postAntragGenehmigung({ id }: FLBerechtigungAntragKeyPayload): Promise<FLBerechtigungWriteResponse> {
  return berechtigungenPostAntragGenehmigung(id);
}

// Hard, as the revoke is: a refused or withdrawn request keeps nothing to restore.
export async function deleteAntrag({ id }: FLBerechtigungAntragKeyPayload): Promise<FLBerechtigungAntragAbgelehntResponse> {
  return berechtigungenDeleteAntrag(id);
}

/**
 * The pass's claim, system tier: it writes, turning a change made in the database directly into an
 * outbox row and claiming the rows no live claim holds, so it is never marked `readOnly`.
 */
export async function postBerechtigungenAbgleich(): Promise<FLBerechtigungAbgleichResponse> {
  return berechtigungenPostBerechtigungenAbgleich();
}

export async function postBerechtigungenAngekuendigt(payload: FLBerechtigungAngekuendigtPayload): Promise<FLBerechtigungAngekuendigtResponse> {
  return berechtigungenPostBerechtigungenAngekuendigt(payload);
}
