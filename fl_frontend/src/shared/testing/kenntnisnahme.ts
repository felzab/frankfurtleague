/**
 * The fields of a stored seat's Kenntnisnahme no fixture varies. A field the read model gains is
 * defaulted here once rather than in every fixture of a contact person.
 */
const UNVARIED = {
  umfang: "kontaktdaten",
  medien: false,
  eingetragen_von: null,
  nachweis: { umfang: null, medien: null },
} as const;

// Typed by its call site rather than by `FLKontaktKenntnisnahme`: `shared` imports no `features`, and the
// assignment to a fixture's declared type is where a field the schema adds is missed.
/** A seat's Kenntnisnahme as a read stores it, over the fields a case varies. */
export function kenntnisnahme<const T extends object>(varied: T): Omit<typeof UNVARIED, keyof T> & T {
  return { ...UNVARIED, ...varied };
}
