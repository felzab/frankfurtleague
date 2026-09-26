import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { exportingModule, REQUEST_PACKAGES } from "@/shared/testing/actionDoubles.ts";

/* Its own sign-in double rather than `doubleActionRequest`'s, which records the actor on every call
   as an action's lookup does: a render's lookup answered from its cache records nobody, and that is
   the case `runAdminRead` exists for. */
const store: { session: { user: { email: string } } | null; reads: number } = { session: null, reads: 0 };
const AUTH = exportingModule({
  getAdminSession: () => {
    store.reads += 1;
    return Promise.resolve(store.session);
  },
});

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = REQUEST_PACKAGES[specifier];
    return double === undefined
      ? nextResolve(specifier, context)
      : { url: `data:text/javascript,${encodeURIComponent(double)}`, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    return nextLoad(url, context);
  },
});

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
  it("names the administrator where the session lookup recorded nobody", async () => {
    store.session = { user: { email: "Vorstand@Example.org" } };

    const actor = await runAdminRead(() => Promise.resolve(getRequestActor()));

    // Folded as the real lookup folds it, so the backend's allowlist and the audit log read one spelling.
    assert.equal(actor, "vorstand@example.org");
    assert.equal(store.reads, 1);
  });

  it("keeps an actor a guard recorded where it is this session's administrator", async () => {
    store.session = { user: { email: "Vorstand@Example.org" } };

    const actor = await runWithRequestScope({ traceId: TRACE, spanId: SPAN, actor: "vorstand@example.org" }, () =>
      runAdminRead(() => Promise.resolve(getRequestActor())),
    );

    assert.equal(actor, "vorstand@example.org");
  });

  /* An actor already recorded proves nothing about the admin session: a person's lookup records its
     own identifier, which the backend's allowlist may still hold. */
  it("refuses an actor already recorded that is not this session's administrator, the read never running", async () => {
    store.session = { user: { email: "vorstand@example.org" } };
    let ran = 0;

    await assert.rejects(
      runWithRequestScope({ traceId: TRACE, spanId: SPAN, actor: "someone@else.example" }, () =>
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
