import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";

import type { RequestActor } from "@/core/requestScope.ts";

const ADMINISTRATOR: RequestActor = { email: "vorstand@example.org", lane: "admin", token: "admin-token-double" };

/* Its own sign-in double rather than `doubleActionRequest`'s, so a case can count the reads. It records
   the actor on every call, as the real guard does: into whichever scope is open, or none. */
const store: { session: { user: { email: string } } | null; reads: number } = { session: null, reads: 0 };
const AUTH = {
  getAdminSession: async () => {
    store.reads += 1;
    if (store.session !== null) {
      const { setRequestActor } = await import("@/core/requestScope.ts");
      setRequestActor(ADMINISTRATOR);
    }
    return store.session;
  },
};

registerDoubles({ modules: { "core/auth.ts": AUTH }, specifiers: { "next/headers": NEXT_HEADERS_DOUBLE } });

const { runAdminRead } = await import("./adminRead.ts");
const { getRequestActor, runWithRequestScope } = await import("@/core/requestScope.ts");
const { AdminReadWithoutAdministratorError } = await import("@/core/errors.ts");

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);

beforeEach(() => {
  store.session = null;
  store.reads = 0;
});

describe("an admin-tier read's scope", () => {
  /* The guard is asked inside the scope the read opens: asked before it, the guard's record would land
     in no scope and the read's admin call would go out naming nobody. */
  it("runs the read under the administrator the guard records in the read's own scope", async () => {
    store.session = { user: { email: ADMINISTRATOR.email } };

    const actor = await runAdminRead(() => Promise.resolve(getRequestActor()));

    assert.deepEqual(actor, ADMINISTRATOR);
    assert.equal(store.reads, 1);
  });

  it("keeps an actor a guard recorded where it is this session's administrator", async () => {
    store.session = { user: { email: ADMINISTRATOR.email } };

    const actor = await runWithRequestScope({ traceId: TRACE, spanId: SPAN, actor: ADMINISTRATOR }, () =>
      runAdminRead(() => Promise.resolve(getRequestActor())),
    );

    assert.deepEqual(actor, ADMINISTRATOR);
  });

  /* An actor already recorded proves nothing about the admin session: a person's lookup records its
     own identifier, which may hold a grant as well. */
  it("refuses an actor already recorded that is not this session's administrator, the read never running", async () => {
    store.session = { user: { email: ADMINISTRATOR.email } };
    let ran = 0;

    await assert.rejects(
      runWithRequestScope(
        { traceId: TRACE, spanId: SPAN, actor: { email: "someone@else.example", lane: "person", token: "person-token-double" } },
        () =>
          runAdminRead(() => {
            ran += 1;
            return Promise.resolve(undefined);
          }),
      ),
    );
    assert.equal(ran, 0, "the read ran under an actor that is not the session's administrator");
  });

  /* Thrown rather than answered: a read has no failure value, and only a caller outside the admin
     guards reaches this, which must be loud rather than a page that renders empty. */
  it("throws for a session that is no administrator's, the read never running", async () => {
    let ran = 0;

    await assert.rejects(
      runAdminRead(() => {
        ran += 1;
        return Promise.resolve(undefined);
      }),
      AdminReadWithoutAdministratorError,
    );
    assert.equal(ran, 0, "the read ran for a session nobody authorized");
  });
});
