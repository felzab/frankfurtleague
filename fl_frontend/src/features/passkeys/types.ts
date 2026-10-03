/**
 * One passkey as its card renders it. `publicKey` and `credentialID` stay on the server: nothing the
 * card draws needs either, and I198's argument is that what a script cannot read it cannot leak.
 */
export interface PasskeyKarte {
  readonly id: string;
  /** The name its holder gave it on this page, `null` until they do. */
  readonly name: string | null;
  /** The maker its AAGUID names, `null` for every Apple passkey and any model the library does not know. */
  readonly anbieter: string | null;
  /** ISO 8601, because a server action answers JSON and a `Date` arrives as one anyway. */
  readonly eingerichtetAm: string;
  /** `null` for a passkey enrolled before its uses were stamped, and not used since. */
  readonly zuletztVerwendetAm: string | null;
  /** Whether the session this page runs in was made by this passkey, which its removal then ends. */
  readonly diesesGeraet: boolean;
}
