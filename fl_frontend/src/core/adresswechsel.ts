/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: how long an address change's link stays open,
 * so a page and a mail state the instant the backend refuses at.
 */
export const ADDRESS_CHANGE_VALID_HOURS = 24;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days a change started with a reason waits after its
 * confirmation, so the address on file can still stop it.
 */
export const ADDRESS_CHANGE_WAIT_DAYS = 7;

// Indexed by the constant, so a waiting time this map has no words for fails the type check rather
// than printing a numeral beside every other duration the pages spell out.
export const ADDRESS_CHANGE_WAIT_SPAN = ({ 7: "eine Woche" } as const)[ADDRESS_CHANGE_WAIT_DAYS];
