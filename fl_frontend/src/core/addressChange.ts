import type { Wait } from "./copy";
import type {
  FLAddressChangeValidHours,
  FLAddressChangeWaitingPeriodDays,
  FLAdminTier,
  FLGrantWaitHours,
  FLOwnerWaitDays,
} from "./generated/client/types";

/**
 * How long an address change's link stays open, so a page and a mail state the instant the backend refuses at;
 * checked against the bound `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_VALID_HOURS` publishes, so
 * the backend moving it fails the type check here.
 */
export const ADDRESS_CHANGE_VALID_HOURS = 24 satisfies FLAddressChangeValidHours;

/**
 * The days a lost-mailbox change waits after its confirmation, so the address on file can still stop it;
 * checked against `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_WAITING_PERIOD_DAYS` as the link's hours are.
 */
export const ADDRESS_CHANGE_WAIT_DAYS = 7 satisfies FLAddressChangeWaitingPeriodDays;

/**
 * How long an addition waits, and a handover, each checked against the bound `fl_backend/app/shared/schemas/bounds.py`
 * publishes, so the backend moving one fails the type check here.
 */
export const GRANT_WAIT = { hours: 24 } as const satisfies { hours: FLGrantWaitHours };
export const OWNER_WAIT = { days: 7 } as const satisfies { days: FLOwnerWaitDays };

/** How long a holder's own change waits once both addresses confirmed, by their tier: what taking the tier waits. */
export const HOLDER_WAIT: Readonly<Record<FLAdminTier, Wait>> = { administration: GRANT_WAIT, owner: OWNER_WAIT };
