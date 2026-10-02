import "server-only";

import { CODE_FACTOR, endedByItsAccount, isWithinPersonLifetime, liveSessionsOf, PASSKEY_FACTOR, passkeysOf } from "@/core/auth";
import { PERSON_LIFETIME } from "@/core/sessionLifetimes";
import { passkeyBestandOf, passkeyNamenOf } from "@/features/passkeys/bestand";
import { passkeyAnzeigename } from "@/features/passkeys/utils";
import { confirmedUntil } from "@/shared/utils/kontoMutation";

import type { LiveSessionRow } from "@/core/auth";
import type { PasskeyRow } from "@/features/passkeys/bestand";
import type { KontoSession } from "@/shared/utils/kontoMutation";
import type { Anmeldung, AnmeldungFaktor, Sicherheit } from "./types";

export async function readSicherheit(served: KontoSession): Promise<Sicherheit> {
  const [held, rows] = await Promise.all([passkeysOf(served.user.id), liveSessionsOf(served.user.id)]);

  const { karten, kannHinzufuegen } = passkeyBestandOf(held, served);

  return {
    passkeys: karten,
    kannHinzufuegen: kannHinzufuegen,
    anmeldungen: anmeldungenOf(rows, held, served),
    verwaltung: served.verwaltung,
    inhaberId: served.user.id,
    inhaberAdresse: served.user.email,
    ...confirmedUntil(served),
  };
}

function anmeldungenOf(rows: readonly LiveSessionRow[], held: readonly PasskeyRow[], served: KontoSession): Anmeldung[] {
  return (
    rows
      // The person lifetime for an administrator's address too: the person area admits their session
      // that long and only the administration for less, so the widest guard decides (`docs/frontend/spec.md :: I425`).
      .filter((row) => isWithinPersonLifetime(row))
      // A row the account's last ending stamped, whose deletion failed: no lane serves it again, so
      // listed it reads as somebody else's device (`docs/frontend/spec.md :: I528`).
      .filter((row) => !endedByItsAccount({ user: served.user, session: row }))
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

function faktorOf(row: LiveSessionRow, held: readonly PasskeyRow[]): AnmeldungFaktor | null {
  if (row.authFactor === CODE_FACTOR) return { art: "code" };
  if (row.authFactor !== PASSKEY_FACTOR) return null;

  // A removal ends the sessions its passkey made in the same transaction, so a row naming none held
  // is one a removal is racing; it still names the factor, under the fallback name.
  const passkey = held.find((candidate) => candidate.credentialID === row.passkeyCredentialId);
  return { art: "passkey", name: passkeyAnzeigename(passkey === undefined ? { name: null, anbieter: null } : passkeyNamenOf(passkey)) };
}
