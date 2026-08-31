import type { FLAktion } from "./schemas";

/**
 * One row of the change log. The pre-image never reaches this type because the API's list never
 * serves one — the row carries `stand_gesichert` in its place (`docs/backend/spec.md :: I43`).
 */
export type AdminAktionRow = FLAktion;
