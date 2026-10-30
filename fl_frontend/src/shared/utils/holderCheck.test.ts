import { NEXT_CACHE_DOUBLE } from "@/test-support/actionDoubles.ts";
import {
  ADMIN_EMAIL,
  configDouble,
  GATE_BACKEND_CONFIG,
  madeByPasskey,
  memoryAdapterDouble,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  seatEveryAddress,
  sessionByCode,
} from "@/test-support/authDoubles.ts";
import { beforeEach, describe, expect, it } from "vitest";

const STORE = "__flHolderCheckStore";

/** A second address holding a grant: the only other account whose session the administrator's check is handed. */
const SECOND_ADMIN_EMAIL = "kassenwart@example.org";

const PERSON_EMAIL = "spielerin@example.org";
const OTHER_EMAIL = "schiedsrichter@example.org";

/** What the request a case arrives as carries. */
let requestHeaders: Headers | undefined;

const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

const LOGGING_DOUBLE = { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } };

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress([ADMIN_EMAIL, SECOND_ADMIN_EMAIL]);

registerAuthDoubles({
  core: {
    logging: LOGGING_DOUBLE,
    config: configDouble(GATE_BACKEND_CONFIG),
  },
  specifiers: {
    "next/headers": HEADERS_DOUBLE,
    "next/cache": NEXT_CACHE_DOUBLE,
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
  },
});

const store = memoryStore(STORE);

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
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
  const { cookie, row } = await sessionByCode(auth, store, email);
  if (byPasskey) madeByPasskey(store, row);

  requestHeaders = new Headers({ ...ORIGIN, cookie });
  return row.userId;
}

// Each answer is compared whole: a guard's refusal carries no `gleich`, and a case reading that
// field alone would pass on a refusal.
describe("which session a holder check calls the holder's", () => {
  it("answers held for the account page's holder, and not held for another person's session", async () => {
    const holder = await arriveSignedIn(PERSON_EMAIL);
    expect(await pruefeInhaberAction(holder)).toStrictEqual({ success: true, same: true });

    await arriveSignedIn(OTHER_EMAIL);
    expect(await pruefeInhaberAction(holder)).toStrictEqual({ success: true, same: false });
  });

  it("answers held for the administrator who asked, and not held for another administrator's session", async () => {
    const holder = await arriveSignedIn(ADMIN_EMAIL, { byPasskey: true });
    expect(await pruefeAdministratorAction(holder)).toStrictEqual({ success: true, same: true });

    await arriveSignedIn(SECOND_ADMIN_EMAIL, { byPasskey: true });
    expect(await pruefeAdministratorAction(holder)).toStrictEqual({ success: true, same: false });
  });
});
