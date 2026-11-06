// Redesign: goes with its last importer, `features/bewerbungen/utils.ts :: mediaNotYet`, the old registration's refusal.

/**
 * `age` is the media floor the record's entry serves, never a number of the page's own: one would name
 * another age the day the backend's rule moves.
 */
export const mediaTooYoung = (age: number): string => `Fotos, Videos und Interviews kannst Du erst ab ${String(age)} Jahren erlauben.`;
