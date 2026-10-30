/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: how long an address change's link stays open,
 * so a page and a mail state the instant the backend refuses at.
 */
export const ADRESSWECHSEL_GUELTIG_STUNDEN = 24;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days a change started with a reason waits after its
 * confirmation, so the address on file can still stop it.
 */
const ADRESSWECHSEL_WARTEZEIT_TAGE = 7;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days an ended change's record, holding no address,
 * stays so either link can still say how it ended; the privacy notice states it.
 */
export const ADRESSWECHSEL_NACHLAUF_TAGE = 30;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days a write waits for a second administrator's approval
 * before it lapses, which the notice states for a moved grant and a grant request.
 */
const GENEHMIGUNG_TAGE = 7;

// Indexed by the constant, so a waiting time this map has no words for fails the type check rather
// than printing a numeral beside every other duration the pages spell out.
export const ADRESSWECHSEL_WARTEZEIT_DAUER = ({ 7: "eine Woche" } as const)[ADRESSWECHSEL_WARTEZEIT_TAGE];
export const GENEHMIGUNG_DAUER = ({ 7: "eine Woche" } as const)[GENEHMIGUNG_TAGE];
