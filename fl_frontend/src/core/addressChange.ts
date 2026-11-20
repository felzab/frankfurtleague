import { GRANT_WAIT, OWNER_WAIT } from "./grant";

import type { Wait } from "./copy";
import type { FLAddressChangeValidHours, FLAddressChangeWaitingPeriodDays, FLAdminTier } from "./generated/client/types";

/**
 * How long an address change's link stays open, so a page and a mail state the instant the backend refuses at. Each
 * bound here `satisfies` the one the backend publishes, so the backend moving it fails the type check here.
 */
export const ADDRESS_CHANGE_VALID_HOURS = 24 satisfies FLAddressChangeValidHours;

/** How long a lost-mailbox change waits after its confirmation, so the address on file can still stop it. */
export const ADDRESS_CHANGE_WAITING_PERIOD = { days: 7 } as const satisfies { days: FLAddressChangeWaitingPeriodDays };

/** How long a holder's own change waits once both addresses confirmed, by their tier: what taking the tier waits. */
export const HOLDER_WAIT: Readonly<Record<FLAdminTier, Wait>> = { administration: GRANT_WAIT, owner: OWNER_WAIT };
