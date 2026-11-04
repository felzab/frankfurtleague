import "server-only";

import { getAuthenticatorName } from "@better-auth/passkey";

import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { passkeysOf } from "@/core/auth/passkeys";
import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";

/** One passkey as its row shows it: never its public key or credential id, which no row draws. */
export type PasskeyRow = {
  readonly id: string;
  /** Its holder's name for it, else its maker's off the AAGUID, else the catalogue's „Passkey“. */
  readonly name: string;
  /** When it was set up, and when it last signed in where it has. */
  readonly dates: Copy;
  /** Whether the session the page runs in was made by it, which its removal then ends. */
  readonly thisDevice: boolean;
};

/** The person's passkeys as Sicherheit lists them, and whether another may be set up. */
export type HeldPasskeys = { readonly rows: readonly PasskeyRow[]; readonly canAdd: boolean };

/** A stamp the adapter answered, a `Date` or its ISO text, or `null` where it holds none it can read. */
function dateOf(stamp: unknown): Date | null {
  if (!(stamp instanceof Date) && typeof stamp !== "string") return null;
  const date = new Date(stamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * The person's passkeys, oldest first, so a row keeps its place when another is added or renamed. Compared with the
 * session's credential on the server, so the credential id the session recorded never reaches the page.
 */
export async function heldPasskeysOf(served: {
  readonly user: { readonly id: string };
  readonly session: { readonly passkeyCredentialId?: unknown };
}): Promise<HeldPasskeys> {
  const held = await passkeysOf(served.user.id);
  const rows = held
    .map((row) => ({
      row,
      created: dateOf(row.createdAt) ?? new Date(0),
    }))
    .sort((a, b) => a.created.getTime() - b.created.getTime())
    .map(({ row, created }): PasskeyRow => ({
      id: row.id,
      name: row.name ?? getAuthenticatorName(row.aaguid) ?? COPY.signIn.passkeyTitle,
      // Not on the plugin's declared row: `fl_frontend/src/core/passkeyLastUse.ts` adds the field.
      dates: COPY.account.passkeys.dates(created, dateOf(Reflect.get(row, "lastUsedAt"))),
      thisDevice: served.session.passkeyCredentialId === row.credentialID,
    }));
  // The cap is judged again at the set-up itself; this closes the act, so the person meets a sentence rather than a
  // refused prompt.
  return { rows, canAdd: held.length < PASSKEY_LIMIT };
}
