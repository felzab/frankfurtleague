import "server-only";

import { getAuthenticatorName } from "@better-auth/passkey";

import { PASSKEY_LIMIT } from "@/core/auth";

import type { auth } from "@/core/auth";
import type { KontoSession } from "@/shared/utils/kontoMutation";
import type { PasskeyKarte } from "./types";

/** One row as the plugin's own list answers it, which is the holder's alone. */
export type PasskeyRow = Awaited<ReturnType<typeof auth.api.listPasskeys>>[number];

/** What the „Sicherheit“ section draws of the holder's passkeys, and whether it may offer another. */
export type PasskeyBestand = { readonly karten: readonly PasskeyKarte[]; readonly kannHinzufuegen: boolean };

/**
 * Projected rather than handed over: the row carries the public key and the credential id, and the
 * card draws neither (`docs/frontend/spec.md :: I315`).
 */
export function passkeyBestandOf(held: readonly PasskeyRow[], served: KontoSession): PasskeyBestand {
  const karten = held
    .map((row): PasskeyKarte => ({
      id: row.id,
      ...passkeyNamenOf(row),
      eingerichtetAm: new Date(row.createdAt).toISOString(),
      // Not on the plugin's declared row: `fl_frontend/src/core/passkeyLastUse.ts` adds the field.
      zuletztVerwendetAm: isoOrNull(Reflect.get(row, "lastUsedAt")),
      // Compared on the server, so the credential id the session recorded never reaches the page.
      diesesGeraet: served.session.passkeyCredentialId === row.credentialID,
    }))
    // Oldest first, so a card keeps its place when another is added or renamed.
    .sort((a, b) => a.eingerichtetAm.localeCompare(b.eingerichtetAm));

  // The cap is judged again at the enrolment itself; this is what closes the control so the reader
  // meets a sentence rather than a refused browser prompt (`docs/frontend/spec.md :: I311`).
  return { karten: karten, kannHinzufuegen: held.length < PASSKEY_LIMIT };
}

/** The two names a passkey can go by: its holder's, and its maker's off the AAGUID. */
export function passkeyNamenOf(row: PasskeyRow): Pick<PasskeyKarte, "name" | "anbieter"> {
  return { name: row.name ?? null, anbieter: getAuthenticatorName(row.aaguid) ?? null };
}

function isoOrNull(stamp: unknown): string | null {
  if (!(stamp instanceof Date) && typeof stamp !== "string") return null;
  const time = new Date(stamp).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
