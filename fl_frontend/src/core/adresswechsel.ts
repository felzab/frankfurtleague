/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: how long an address change's link stays open,
 * so a page and a mail state the instant the backend refuses at.
 */
export const ADRESSWECHSEL_GUELTIG_STUNDEN = 24;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days a change started with a reason waits after its
 * confirmation, so the address on file can still stop it.
 */
export const ADRESSWECHSEL_WARTEZEIT_TAGE = 7;

// Indexed by the constant, so a waiting time this map has no words for fails the type check rather
// than printing a numeral beside every other duration the pages spell out.
export const ADRESSWECHSEL_WARTEZEIT_DAUER = ({ 7: "eine Woche" } as const)[ADRESSWECHSEL_WARTEZEIT_TAGE];
