import {
  grantsDeleteApprovalRequest,
  grantsDeleteGrant,
  grantsPatchGrant,
  grantsPostApprovalRequestApproval,
  grantsPostGrant,
  grantsPostGrantsReconciliation,
} from "@/core/generated/client/sdk";

import type {
  FLGrantApprovalRequestDeclinedResponse,
  FLGrantReconciliationResponse,
  FLGrantStufeResponse,
  FLGrantWriteResponse,
  FLPostGrantPayload,
  FLPostGrantResponse,
} from "@/core/generated/client/types";
import type { FLBerechtigungAntragKeyPayload, FLBerechtigungKeyPayload, FLPatchGrantPayload } from "./schemas";

export async function postBerechtigung(payload: FLPostGrantPayload): Promise<FLPostGrantResponse> {
  return grantsPostGrant(payload);
}

// Hard, as the ban's removal is: a revoked grant keeps nothing to restore.
export async function deleteBerechtigung({ id }: FLBerechtigungKeyPayload): Promise<FLGrantWriteResponse> {
  return grantsDeleteGrant(id);
}

export async function patchBerechtigung({ id, verwaltung }: FLPatchGrantPayload): Promise<FLGrantStufeResponse> {
  return grantsPatchGrant(id, { verwaltung: verwaltung });
}

export async function postAntragGenehmigung({ id }: FLBerechtigungAntragKeyPayload): Promise<FLGrantWriteResponse> {
  return grantsPostApprovalRequestApproval(id);
}

// Hard, as the revoke is: a refused or withdrawn request keeps nothing to restore.
export async function deleteAntrag({ id }: FLBerechtigungAntragKeyPayload): Promise<FLGrantApprovalRequestDeclinedResponse> {
  return grantsDeleteApprovalRequest(id);
}

/** The comparison, system tier: it writes, owing a notice of every change made in the database directly. */
export async function postBerechtigungenAbgleich(): Promise<FLGrantReconciliationResponse> {
  return grantsPostGrantsReconciliation();
}
