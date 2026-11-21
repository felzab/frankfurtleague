import { FLWithdrawalChoice } from "@/core/generated/client/types";

/**
 * Every choice the contract names, in its order, which the boxes keep, each box posting under the choice's own name, so
 * that a box's name and the key its value is read under are one spelling. It stands outside the acts' module, which may
 * export async functions alone.
 */
export const WITHDRAWAL_CHOICES: readonly FLWithdrawalChoice[] = Object.values(FLWithdrawalChoice);
