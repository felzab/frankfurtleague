import type { FLWithdrawalChoice } from "@/core/generated/client/types";

/**
 * The choices in the boxes' order, each box posting under the choice's own name, so that a box's name and the key its
 * value is read under are one spelling. It stands outside the acts' module, which may export async functions alone.
 */
export const WITHDRAWAL_CHOICES = ["name", "whatsapp", "media"] as const satisfies readonly FLWithdrawalChoice[];
