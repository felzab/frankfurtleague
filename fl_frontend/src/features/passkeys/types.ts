/**
 * One passkey as the dialog renders it. `publicKey` and `credentialID` stay on the server: nothing
 * the page draws needs either, and I198's argument is that what a script cannot read it cannot leak.
 */
export interface PasskeyEintrag {
  readonly id: string;
  /** ISO 8601, because a server action answers JSON and a `Date` arrives as one anyway. */
  readonly createdAt: string;
  /**
   * The authenticator model the AAGUID names, and the only name a row carries here: the one the
   * enrolling CALLER chose is refused at `fl_frontend/src/core/auth.ts :: ENROLMENT_FIELDS_REFUSED`.
   */
  readonly label: string | null;
}
