import assert from "node:assert/strict";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { serverActionModules } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { PERSON_ACTION_MODULES, srcPathOf } from "@/shared/testing/actionLanes.ts";

const { setRefusal } = doubleActionRequest({ session: null });

const { ADMIN_FORBIDDEN } = await import("./adminMutation.ts");
const { KONTO_FORBIDDEN } = await import("./kontoMutation.ts");

/**
 * The two actions that authorize nobody, named by export rather than by their slice, so an admin action added
 * beside them is called too: `handleSignIn` is reachable without a session, and `signOutAction` ends the one it
 * would check.
 */
const AUTHORIZES_NOBODY: ReadonlySet<string> = new Set(["auth :: handleSignIn", "auth :: signOutAction"]);

/**
 * The account page's actions, which admit either lane and so answer a caller nobody signed in as the
 * account's own guard does. Named by export for `AUTHORIZES_NOBODY`'s reason.
 */
const ACCOUNT_ACTIONS: ReadonlySet<string> = new Set([
  "konto :: endAndereAnmeldungenAction",
  "konto :: endAnmeldungAction",
  "konto :: pruefeInhaberAction",
  "konto :: sendeBestaetigungscodeAction",
  "passkeys :: readPasskeyStandAction",
  "passkeys :: removePasskeyAction",
  "passkeys :: renamePasskeyAction",
]);

/**
 * Every action of every server action module but a person's called with no payload, by
 * `<slice> :: <export>`, and what each answered; the actions authorizing nobody are left uncalled, and
 * returned as met.
 */
async function answerOfEveryAction(): Promise<{ answers: Map<string, unknown>; exempted: Set<string> }> {
  const answers = new Map<string, unknown>();
  const exempted = new Set<string>();
  const fetched = mock.method(globalThis, "fetch", () => Promise.reject(new Error("an admin action reached the network for nobody")));

  try {
    for (const file of serverActionModules(20).filter((module) => !PERSON_ACTION_MODULES.has(srcPathOf(module)))) {
      const slice = path.basename(path.dirname(file));
      const actions = Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>);
      assert.ok(actions.length > 0, `${slice}'s actions module exports nothing, so nothing here holds it`);

      for (const [name, action] of actions) {
        assert.equal(typeof action, "function", `${slice} :: ${name} is exported from a "use server" module and is no action`);
        if (AUTHORIZES_NOBODY.has(`${slice} :: ${name}`)) {
          exempted.add(`${slice} :: ${name}`);
          continue;
        }

        answers.set(`${slice} :: ${name}`, await (action as () => Promise<unknown>)());
      }
    }
  } finally {
    fetched.mock.restore();
  }

  assert.equal(fetched.mock.callCount(), 0, "an admin action reached the network for a caller nobody authorized");
  return { answers, exempted };
}

/** `adminLane` for every administrator's action, the account page's actions answering by their own guard. */
const expectedOf = (answers: Map<string, unknown>, adminLane: string): Map<string, unknown> =>
  new Map([...answers.keys()].map((action) => [action, { success: false, error: ACCOUNT_ACTIONS.has(action) ? KONTO_FORBIDDEN : adminLane }]));

describe("every admin server action", () => {
  /* Each export called, never its source read: an action outside `runAdminMutation`, or one the spine
     does not guard, validates the missing payload or reaches the backend, and answers something else. */
  it("answers a caller with no admin session through the spine's guard, before any work", async () => {
    const { answers, exempted } = await answerOfEveryAction();

    assert.deepEqual(answers, expectedOf(answers, ADMIN_FORBIDDEN), "an action did work for a caller nobody authorized");
    // Each exemption met its export, so one outliving its action cannot stand ready for a later one of that name.
    assert.deepEqual([...exempted].sort(), [...AUTHORIZES_NOBODY].sort());
    assert.deepEqual(
      [...ACCOUNT_ACTIONS].filter((action) => !answers.has(action)),
      [],
      "an account action named here is exported nowhere",
    );
  });

  /* The backend did not answer the grant lookup: a sign-in meets the same unread grant, so no admin
     action sends its caller there. */
  it("answers a caller whose grant the backend left unread with the retry, never the sign-in", async () => {
    setRefusal("unread");
    const { answers } = await answerOfEveryAction();

    assert.deepEqual(answers, expectedOf(answers, "Dein Zugang zur Verwaltung ließ sich gerade nicht prüfen. Versuche es erneut."));
  });
});
