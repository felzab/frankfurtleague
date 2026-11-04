import type { FLAddressChangeValidHours, FLAddressChangeWaitingPeriodDays } from "./generated/client/types";

/**
 * How long an address change's link stays open, so a page and a mail state the instant the backend refuses at;
 * checked against the bound `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_VALID_HOURS` publishes, so
 * the backend moving it fails the type check here.
 */
export const ADDRESS_CHANGE_VALID_HOURS = 24 satisfies FLAddressChangeValidHours;

/**
 * The days a change started with a reason waits after its confirmation, so the address on file can still stop it;
 * checked against `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_WAITING_PERIOD_DAYS` as the link's hours are.
 */
export const ADDRESS_CHANGE_WAIT_DAYS = 7 satisfies FLAddressChangeWaitingPeriodDays;

// Indexed by the constant, so a waiting time this map has no words for fails the type check rather
// than printing a numeral beside every other duration the pages spell out.
export const ADDRESS_CHANGE_WAIT_SPAN = ({ 7: "eine Woche" } as const)[ADDRESS_CHANGE_WAIT_DAYS];
