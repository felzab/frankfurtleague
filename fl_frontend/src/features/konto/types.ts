import type { PasskeyKarte } from "@/features/passkeys/types";

/** Which factor made a sign-in; a passkey's by the name its card shows. */
export type AnmeldungFaktor = { readonly art: "passkey"; readonly name: string } | { readonly art: "code" };

/**
 * One live sign-in of the holder's, projected off its session row. The row's `token` is the cookie's
 * own value and never leaves the server (`docs/frontend/spec.md :: I411`); the id alone addresses it.
 */
export interface Anmeldung {
  readonly id: string;
  readonly diesesGeraet: boolean;
  /** ISO 8601, each of the three. */
  readonly angemeldetAm: string;
  readonly zuletztAktivAm: string;
  /** The lane's absolute cap from the sign-in, which no activity moves. */
  readonly endetSpaetestensAm: string;
  readonly faktor: AnmeldungFaktor;
}

/** Everything the „Sicherheit“ section draws, read on the server in one pass. */
export interface Sicherheit {
  readonly passkeys: readonly PasskeyKarte[];
  readonly kannHinzufuegen: boolean;
  readonly anmeldungen: readonly Anmeldung[];
  /** An administrator's address, whose last passkey is kept and whose confirmation is a passkey's alone. */
  readonly verwaltung: boolean;
  /** Until when the page's session counts as confirmed, in epoch milliseconds; `null` where it already does not. */
  readonly bestaetigtBis: number | null;
}
