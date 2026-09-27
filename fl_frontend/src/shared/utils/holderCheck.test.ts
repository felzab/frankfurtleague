import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  ADMIN_EMAIL,
  asDataUrl,
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  memoryAdapterDouble,
  ORIGIN,
  registerAuthDoubles,
  seatEveryAddress,
  signInByCode,
} from "@/core/authDoubles.ts";
import { exportingModule } from "@/core/exportingModule.ts";
import { NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

const STORE = "__flHolderCheckStore";

/** A second allowlisted address: the only other account whose session the administrator's check is handed. */
const SECOND_ADMIN_EMAIL = "kassenwart@example.org";

const PERSON_EMAIL = "spielerin@example.org";
const OTHER_EMAIL = "schiedsrichter@example.org";

/** What the request a case arrives as carries. */
let requestHeaders: Headers | undefined;

const HEADERS_DOUBLE = exportingModule({ headers: () => Promise.resolve(requestHeaders) });

const LOGGING_DOUBLE = `export const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };`;

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

registerAuthDoubles({
  core: {
    logging: LOGGING_DOUBLE,
    config: configDouble({ ...GATE_BACKEND_CONFIG, ALLOWED_ADMIN_EMAILS: [ADMIN_EMAIL, SECOND_ADMIN_EMAIL] }),
  },
  specifiers: {
    "next/headers": asDataUrl(HEADERS_DOUBLE),
    "next/cache": asDataUrl(NEXT_CACHE_DOUBLE),
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
  },
});

type SessionRow = { userId: string; authFactor?: string };

const store = { user: [], session: [] as SessionRow[], account: [], verification: [], passkey: [] };

(globalThis as unknown as Record<string, unknown>)[STORE] = store;

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { pruefeInhaberAction } = await import("@/features/konto/actions.ts");
const { pruefeAdministratorAction } = await import("@/features/admin/actions.ts");
const { auth } = await import("@/core/auth");

beforeEach(() => {
  store.session.length = 0;
});

/**
 * Signs `email` in by a typed code, stamped with the passkey factor where `byPasskey` asks it, as the
 * administrator's guard admits no other, and arrives as that session. Answers its account's id.
 */
async function arriveSignedIn(email: string, { byPasskey = false } = {}): Promise<string> {
  const cookie = cookieHeader(await signInByCode(auth, email));

  const row = store.session.at(-1);
  assert.ok(row !== undefined, "the verification wrote no session row");
  if (byPasskey) row.authFactor = "passkey";

  requestHeaders = new Headers({ ...ORIGIN, cookie });
  return row.userId;
}

// Each answer is compared whole: a guard's refusal carries no `gleich`, and a case reading that
// field alone would pass on a refusal.
describe("which session a holder check calls the holder's (docs/frontend/spec.md :: I428)", () => {
  it("answers held for the account page's holder, and not held for another person's session", async () => {
    const holder = await arriveSignedIn(PERSON_EMAIL);
    assert.deepEqual(await pruefeInhaberAction(holder), { success: true, gleich: true });

    await arriveSignedIn(OTHER_EMAIL);
    assert.deepEqual(await pruefeInhaberAction(holder), { success: true, gleich: false });
  });

  it("answers held for the administrator who asked, and not held for another administrator's session", async () => {
    const holder = await arriveSignedIn(ADMIN_EMAIL, { byPasskey: true });
    assert.deepEqual(await pruefeAdministratorAction(holder), { success: true, gleich: true });

    await arriveSignedIn(SECOND_ADMIN_EMAIL, { byPasskey: true });
    assert.deepEqual(await pruefeAdministratorAction(holder), { success: true, gleich: false });
  });
});
