import "server-only";

import { grantsPostHandoverPass } from "@/core/generated/client/sdk";

/**
 * Hourly: a handover whose wait has ended completes late rather than early where a pass is missed. A failure rejects,
 * for the heartbeat to name.
 */
export async function runHandoverPass(): Promise<{ readonly count: { readonly handed_over: number }; readonly open: 0 }> {
  const { handed_over } = await grantsPostHandoverPass();

  return { count: { handed_over }, open: 0 };
}
