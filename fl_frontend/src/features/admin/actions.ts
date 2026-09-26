"use server";

import { runAdminMutation } from "@/shared/utils/adminMutation";
import { isHeldBy } from "@/shared/utils/kontoMutation";

import type { QueryResult } from "@/shared/types/types";

/**
 * Whether the session a step-up just made is the administrator's who asked: another account's
 * passkey would otherwise run the waiting write as that account (`docs/frontend/spec.md :: I428`).
 */
export async function pruefeAdministratorAction(inhaberId: string): Promise<QueryResult<{ gleich: boolean }>> {
  return runAdminMutation("pruefeAdministratorAction", async (served) => ({ success: true, gleich: isHeldBy(served, inhaberId) }));
}
