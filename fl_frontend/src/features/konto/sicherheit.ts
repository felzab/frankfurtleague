import "server-only";

import { headers } from "next/headers";

import { isUserAdmin } from "@/core/allowlist";
import { auth, CODE_FACTOR, isWithinPersonLifetime, PASSKEY_FACTOR } from "@/core/auth";
import { PERSON_LIFETIME } from "@/core/sessionLifetimes";
import { passkeyBestandOf, passkeyNamenOf } from "@/features/passkeys/bestand";
import { passkeyAnzeigename } from "@/features/passkeys/utils";
import { freshUntil } from "@/shared/utils/kontoMutation";

import type { PasskeyRow } from "@/features/passkeys/bestand";
import type { KontoSession } from "@/shared/utils/kontoMutation";
import type { Anmeldung, AnmeldungFaktor, Sicherheit } from "./types";

/** The fields of a stored session row this read touches; `token` is deliberately not among them. */
type SessionRow = {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly authFactor?: unknown;
  readonly passkeyCredentialId?: unknown;
};

/**
 * How many live sign-ins the list reads, the most recently active first. A person holds one per device,
 * so no one reaches it; any beyond it are still ended by „Alle anderen abmelden“.
 */
const ANMELDUNGEN_LIMIT = 100;

/**
 * Through the store's own adapter rather than the library's `/list-sessions`, which answers every row
 * whole, `token` included, and that value is the session cookie (`docs/frontend/spec.md :: I411`).
 */
export async function readSicherheit(served: KontoSession): Promise<Sicherheit> {
  const [held, rows] = await Promise.all([
    auth.api.listPasskeys({ headers: await headers() }),
    auth.$context.then(({ adapter }) =>
      adapter.findMany<SessionRow>({
        model: "session",
        // Past the library's own expiry a row is dead whatever else holds, so it spends none of the limit.
        where: [
          { field: "userId", value: served.user.id },
          { field: "expiresAt", operator: "gt", value: new Date() },
        ],
        sortBy: { field: "updatedAt", direction: "desc" },
        limit: ANMELDUNGEN_LIMIT,
      }),
    ),
  ]);

  const { karten, kannHinzufuegen } = passkeyBestandOf(held, served);

  return {
    passkeys: karten,
    kannHinzufuegen: kannHinzufuegen,
    anmeldungen: anmeldungenOf(rows, held, served),
    verwaltung: isUserAdmin(served.user.email),
    inhaberId: served.user.id,
    freshUntil: freshUntil(served),
  };
}

function anmeldungenOf(rows: readonly SessionRow[], held: readonly PasskeyRow[], served: KontoSession): Anmeldung[] {
  return (
    rows
      // The person lifetime for an administrator's address too: the person area admits their session
      // that long and only the administration for less, so the widest guard decides (`docs/frontend/spec.md :: I451`).
      .filter((row) => isWithinPersonLifetime(row))
      .flatMap((row): Anmeldung[] => {
        const faktor = faktorOf(row, held);
        // A row made by a factor this league does not mint, which no browser can present again.
        if (faktor === null) return [];

        return [
          {
            id: row.id,
            diesesGeraet: row.id === served.session.id,
            angemeldetAm: new Date(row.createdAt).toISOString(),
            zuletztAktivAm: new Date(row.updatedAt).toISOString(),
            endetSpaetestensAm: new Date(new Date(row.createdAt).getTime() + PERSON_LIFETIME.absolute).toISOString(),
            faktor: faktor,
          },
        ];
      })
      // This device first, then the most recently active, which is the order a reader looks for a
      // device they do not recognise in.
      .sort((a, b) => Number(b.diesesGeraet) - Number(a.diesesGeraet) || b.zuletztAktivAm.localeCompare(a.zuletztAktivAm))
  );
}

function faktorOf(row: SessionRow, held: readonly PasskeyRow[]): AnmeldungFaktor | null {
  if (row.authFactor === CODE_FACTOR) return { art: "code" };
  if (row.authFactor !== PASSKEY_FACTOR) return null;

  // A removal ends the sessions its passkey made in the same transaction, so a row naming none held
  // is one a removal is racing; it still names the factor, under the fallback name.
  const passkey = held.find((candidate) => candidate.credentialID === row.passkeyCredentialId);
  return { art: "passkey", name: passkeyAnzeigename(passkey === undefined ? { name: null, anbieter: null } : passkeyNamenOf(passkey)) };
}
