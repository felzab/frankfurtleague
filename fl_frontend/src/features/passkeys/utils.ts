import type { PasskeyKarte } from "./types";

/** What a card and a sign-in list call a passkey whose holder named it nothing and whose maker is unknown. */
const PASSKEY_FALLBACK_NAME = "Passkey";

/** The one name a passkey goes by on the page: its holder's, else its maker's, else the fallback. */
export function passkeyAnzeigename(karte: Pick<PasskeyKarte, "name" | "anbieter">): string {
  return karte.name ?? karte.anbieter ?? PASSKEY_FALLBACK_NAME;
}
