import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { cacheCalls, doubleActionRequest, doubleActions, doubleToasts } from "./actionDoubles.ts";

const SRC = path.resolve(import.meta.dirname, "..", "..");

const { raised } = doubleToasts();

/* One slice's real module, replaced whole: what the double has to derive is that module's own export
   list, so a stub written here would prove nothing about the derivation. */
const { calls, answerWith, answerPending, leavePending } = doubleActions({ modules: ["/src/features/spieltage/actions.ts"] });
const { setSession } = doubleActionRequest();
// A module a real action writes through, which the double refuses rather than stands in for.
doubleActions({ modules: ["/src/features/spielorte/mutations.ts"] });

/* `await import`, never a static import beside the doubles: each hook is registered as its call
   above evaluates, and a static import would have resolved the real module before then. */
const { appToast, UNDO_TIMEOUT_MS } = await import("@/shared/utils/appToast.ts");
const spieltage = await import("@/features/spieltage/actions.ts");
const nextCache = await import("next/cache");
const { getAdminSession, getSignInDestination } = await import("@/core/auth.ts");

describe("the actions double", () => {
  /* Stood in for, a module a real action writes through records no write, and the admin spine then
     answers a press that wrote as one that did not. */
  it("refuses a module a real action sends its writes through", async () => {
    await assert.rejects(import("@/features/spielorte/mutations.ts"), /double its client with doubleApiAnswers instead/);
  });

  /* The names come off the real module's source: a double listing them by hand answers `undefined`
     for an action a slice added, and the component reaches that rather than the stub. */
  it("carries every action the module exports, and records the payload each one was handed", async () => {
    calls.length = 0;
    const exported = Object.keys(spieltage).filter((name) => typeof Reflect.get(spieltage, name) === "function");

    assert.ok(exported.includes("patchSpieltagAction"), `the double exports ${exported.join(", ")}`);
    const payload = { id: "s1", beginn: "2026-03-12", ende: "2026-03-12" };
    await spieltage.patchSpieltagAction(payload);

    assert.deepEqual(calls, [{ action: "patchSpieltagAction", payload }]);
  });

  it("answers as landed until a case says otherwise, and then as that case says", async () => {
    assert.deepEqual(await spieltage.patchSpieltagAction({ id: "s1", beginn: "2026-03-12", ende: "2026-03-12" }), {
      success: true,
      message: "Gespeichert.",
    });

    answerWith(() => Promise.resolve({ success: false, error: "Der Spieltag ist gesperrt." }));

    assert.deepEqual(await spieltage.patchSpieltagAction({ id: "s1", beginn: "2026-03-12", ende: "2026-03-12" }), {
      success: false,
      error: "Der Spieltag ist gesperrt.",
    });
  });

  /* After the case above, which names a refusal and leaves it standing: a write here meeting that
     refusal would pass every case that expects one without the case ever naming it. */
  it("answers the next case as landed again, whatever the case before it named", async () => {
    assert.deepEqual(await spieltage.patchSpieltagAction({ id: "s1", beginn: "2026-03-12", ende: "2026-03-12" }), {
      success: true,
      message: "Gespeichert.",
    });
  });

  /* A case holding a write open asserts the running state, then answers it, or the check after it fails. */
  it("answers a write still running with what the case names", async () => {
    answerWith(() => new Promise(() => undefined));
    const running = spieltage.patchSpieltagAction({ id: "s1", beginn: "2026-03-12", ende: "2026-03-12" });

    answerPending({ success: false, error: "Der Spieltag ist gesperrt." });

    assert.deepEqual(await running, { success: false, error: "Der Spieltag ist gesperrt." });
  });

  /* The refusal is an `afterEach` failing the case that left the write, which no case in this file can
     observe of itself: a file that leaves one, run in a child, is where it shows. */
  it("fails a case that leaves a write running without naming why", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "fl-pending-"));
    const fixture = path.join(scratch, "leftPending.test.mjs");
    const urlOf = (relative: string) => JSON.stringify(pathToFileURL(path.join(SRC, relative)).href);
    writeFileSync(
      fixture,
      `import { it } from "node:test";
import { doubleActions } from ${urlOf("shared/testing/actionDoubles.ts")};
const { answerWith } = doubleActions({ modules: ["/src/features/spieltage/actions.ts"] });
const spieltage = await import(${urlOf("features/spieltage/actions.ts")});
it("leaves a write running", () => {
  answerWith(() => new Promise(() => undefined));
  void spieltage.patchSpieltagAction({ id: "s1" });
});
`,
    );

    // Without `NODE_TEST_CONTEXT`, which this runner sets and under which a child refuses to run a file;
    // and without the gate's shard, which `NODE_OPTIONS` carries and which leaves a one-file child no file.
    const env = { ...process.env, NODE_OPTIONS: (process.env.NODE_OPTIONS ?? "").replace(/--test-shard=\S+/g, "") };
    Reflect.deleteProperty(env, "NODE_TEST_CONTEXT");

    try {
      const run = spawnSync(
        process.execPath,
        ["--import", pathToFileURL(path.join(SRC, "..", "tsconfig-alias-hook.mjs")).href, "--test", "--test-reporter=spec", fixture],
        { encoding: "utf8", timeout: 120_000, env },
      );

      // First, so a child that ran nothing says so rather than passing or failing for another reason.
      assert.ok(run.stdout.includes("leaves a write running"), `the child ran no case of the fixture:\n${run.stdout}${run.stderr}`);
      assert.equal(run.status, 1, `the file left a write running and exited ${String(run.status)}:\n${run.stdout}${run.stderr}`);
      assert.ok(run.stdout.includes("the case left these actions pending"), run.stdout);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("lets a case that names why leave a write running", () => {
    answerWith(() => new Promise(() => undefined));
    void spieltage.patchSpieltagAction({ id: "s1", beginn: "2026-03-12", ende: "2026-03-12" });

    leavePending("the opt-out's own case, which nothing renders a transition for");
  });
});

describe("the request double", () => {
  it("records each invalidation a write makes, in order, with what it was handed", () => {
    nextCache.updateTag("teams");
    nextCache.refresh();

    assert.deepEqual(cacheCalls, [
      { name: "updateTag", args: ["teams"] },
      { name: "refresh", args: [] },
    ]);
  });

  /* After the case above, whose invalidations would otherwise stand in for the ones this case's write owes. */
  it("starts each case with no invalidation recorded", () => {
    assert.deepEqual(cacheCalls, []);
  });

  it("answers the session a case names, for the rest of that case", async () => {
    setSession(null);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin", "a caller with no session is sent somewhere other than to sign in");

    setSession(null, "/");

    assert.equal(await getSignInDestination(), "/", "the destination a case named went unanswered");
  });

  /* After the case above, whose signed-out request would otherwise stand in for this case's caller. */
  it("signs the next case in as the request's own session again", async () => {
    assert.deepEqual(await getAdminSession(), { user: { email: "vorstand@example.org" } });
    assert.equal(await getSignInDestination(), "/admin", "the previous case's destination outlived its case");
  });
});

describe("the toast double", () => {
  it("records the severity, the title and the description of each announcement", () => {
    raised.length = 0;
    appToast.success("Gespeichert.", { description: "Die Änderung steht." });
    appToast.danger("Nicht gespeichert.");

    assert.deepEqual(
      raised.map(({ variant, title, description }) => ({ variant, title, description })),
      [
        { variant: "success", title: "Gespeichert.", description: "Die Änderung steht." },
        { variant: "danger", title: "Nicht gespeichert.", description: undefined },
      ],
    );
  });

  /* A closure is not an announcement: recording it would move the index every case reading `raised`
     by position works from, and an editor closes its pending toast on every save. */
  it("records nothing for a close or a clear", () => {
    raised.length = 0;
    appToast.close("1");
    appToast.clear();

    assert.deepEqual(raised, []);
  });

  /* The offer's own timeout, which a case pressing an undo has to outlive: the real fifteen seconds
     would be fifteen seconds of every file that raises one. */
  it("shortens the undo offer", () => {
    assert.equal(UNDO_TIMEOUT_MS, 1);
  });
});
