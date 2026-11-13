/**
 * The request a server action or a server page runs in, signed in through the real sign-in library, the real guards
 * and the real config.
 *
 * What a test file does:
 * - At module level, `serveBackend(answer)` for the backend the subject reads and writes, then `signedInRequest()` for
 *   the administrator, signed in by passkey, or `signedInRequest(visitor)` for another, then `await import` of the
 *   subject: the doubles reach only the modules imported after the call.
 * - A case arriving as someone else awaits `arriveAs(visitor)`, `null` for nobody. A case reads what the code owed
 *   by mail off `outbox.sent`, and the rows the library holds off `store`.
 *
 * What the helper guarantees:
 * - Each case arrives as the file's visitor, on an empty store, with no cookie the code wrote before it, and with the
 *   file's own lookup answer.
 * - The lookup answers the visitor's address alone; a read for any other address fails the case unless the case
 *   answered it, and `answerTheLookup(() => null)` inside a case names an outage for that case alone.
 * - Every lookup and mail the helper answers is on the backend's `served`, beside the case's own `sent`.
 */
import {
  ADMIN_EMAIL,
  answerTheLookup,
  GRANTED,
  HOLDS_NOTHING,
  madeByPasskey,
  memoryAdapterDouble,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/test-support/authDoubles.ts";
import { arriveWith, doubleNextRequest } from "@/test-support/nextRequest.ts";
import { beforeEach } from "vitest";

import { asSignInIdentifier } from "@/core/emailAddress.ts";

import type { SubjectSession } from "@/core/subject.ts";
import type { MemoryStore } from "@/test-support/authDoubles.ts";
import type { LookupFixture } from "@/test-support/subjectFixtures.ts";

/**
 * Who a request arrives as: nobody, or a person signed in at `email` holding `records`, an administrator's grant
 * beside them where `admin` is set.
 */
export type Visitor = null | { email: string; records?: Partial<SubjectSession["records"]>; admin?: boolean };

/** The administrator every case arrives as unless the suite names another. */
const ADMINISTRATOR: Visitor = { email: ADMIN_EMAIL, admin: true };

/** Where the library's in-memory store is held for `memoryAdapterDouble`. */
const STORE = "__flSignedInRequestStore";

/** What the backend holds for `visitor`: an account, its records, and the grant where it is an administrator's. */
const fixtureOf = ({ records = {}, admin = false }: NonNullable<Visitor>): LookupFixture => ({
  ...(admin ? GRANTED : HOLDS_NOTHING),
  ...records,
  account: true,
});

/**
 * Signs every case in as `visitor` over the library's in-memory store, its cookie on the doubled `next/headers`, an
 * administrator's session made by passkey as every admin guard asks, until `arriveAs` names another for the rest of it.
 */
export function signedInRequest(visitor: Visitor = ADMINISTRATOR): {
  /** Signs a fresh session in for `next` and arrives with its cookie, or with none for nobody. */
  arriveAs: (next: Visitor) => Promise<void>;
  store: MemoryStore;
  /** Every sign-in mail the code owed through the Postausgang since the case began, rendered as the drain sends it. */
  outbox: ReturnType<typeof registerAuthDoubles>;
} {
  let current: Visitor = visitor;
  // The visitor's own address alone: any other read goes on to the case's answer, which names it.
  answerTheLookup((email) => (current !== null && email === asSignInIdentifier(current.email) ? fixtureOf(current) : undefined));
  doubleNextRequest();
  const outbox = registerAuthDoubles({ specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) } });
  const store = memoryStore(STORE);

  const arriveAs = async (next: Visitor): Promise<void> => {
    current = next;
    if (next === null) {
      arriveWith(ORIGIN);
      return;
    }

    // Imported at the arrival, after every double above, so the library is the one the subject loads.
    const { auth } = await import("@/core/auth/library.ts");
    const { cookie, row } = await sessionByCode(auth, store, next.email);
    if (next.admin === true) madeByPasskey(store, row);
    arriveWith({ ...ORIGIN, cookie });
  };

  // After `doubleNextRequest`'s own, which empties the request first, and on an empty store, so no row of an earlier
  // case answers this one.
  beforeEach(async () => {
    for (const rows of Object.values(store)) rows.length = 0;
    await arriveAs(visitor);
  });

  return { arriveAs, store, outbox };
}
