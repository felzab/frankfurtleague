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
 * The request a server action or a server page runs in, signed in through the REAL sign-in library over its in-memory
 * store: the session's cookie on the doubled `next/headers` (`fl_frontend/src/test-support/nextRequest.ts`), an
 * administrator's session made by passkey as every admin guard asks, and the visitor's lookups answered on the file's
 * backend (`fl_frontend/src/test-support/backend.ts`), whose `serveBackend` answers the rest.
 * Every case arrives as `visitor` until `arriveAs` names another for the rest of it. Called before the subject's
 * `await import`: the doubles reach only the modules imported after it.
 */
export function signedInRequest(visitor: Visitor = ADMINISTRATOR): {
  /** Signs a fresh session in for `next` and arrives with its cookie, or with none for nobody. */
  arriveAs: (next: Visitor) => Promise<void>;
  store: MemoryStore;
} {
  let current: Visitor = visitor;
  // The visitor's own address alone: any other read goes on to the case's answer, which names it.
  answerTheLookup((email) => (current !== null && email === asSignInIdentifier(current.email) ? fixtureOf(current) : undefined));
  doubleNextRequest();
  registerAuthDoubles({ specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) } });
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

  // After `doubleNextRequest`'s own, which empties the request first.
  beforeEach(() => arriveAs(visitor));

  return { arriveAs, store };
}
