import "server-only";

import { headers } from "next/headers";

import { isUserAdmin } from "@/core/allowlist";
import { auth, CODE_FACTOR, isWithinOwnLifetime, ownLifetime, PASSKEY_FACTOR } from "@/core/auth";
import { passkeyBestandOf, passkeyNamenOf } from "@/features/passkeys/bestand";
import { passkeyAnzeigename } from "@/features/passkeys/utils";
import { bestaetigtBis } from "@/shared/utils/kontoMutation";

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
 * Through the store's own adapter rather than the library's `/list-sessions`, which answers every row
 * whole, `token` included, and that value is the session cookie (`docs/frontend/spec.md :: I411`).
 */
export async function readSicherheit(served: KontoSession): Promise<Sicherheit> {
  const [held, rows] = await Promise.all([
    auth.api.listPasskeys({ headers: await headers() }),
    auth.$context.then(({ adapter }) =>
      adapter.findMany<SessionRow>({ model: "session", where: [{ field: "userId", value: served.user.id }] }),
    ),
  ]);

  const { karten, kannHinzufuegen } = passkeyBestandOf(held, served);

  return {
    passkeys: karten,
    kannHinzufuegen: kannHinzufuegen,
    anmeldungen: anmeldungenOf(rows, held, served),
    verwaltung: isUserAdmin(served.user.email),
    bestaetigtBis: bestaetigtBis(served),
  };
}

function anmeldungenOf(rows: readonly SessionRow[], held: readonly PasskeyRow[], served: KontoSession): Anmeldung[] {
  const { absolute } = ownLifetime(served.user.email);
  const now = Date.now();

  return (
    rows
      // Judged as the guards judge the served session, so a row the next request would refuse, or the
      // library's own expiry has passed, is never offered as a device still signed in.
      .filter((row) => isWithinOwnLifetime(served.user.email, row) && new Date(row.expiresAt).getTime() > now)
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
            endetSpaetestensAm: new Date(new Date(row.createdAt).getTime() + absolute).toISOString(),
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
