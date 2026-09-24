import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { blankComments } from "@/core/blankComments.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { doubleActions, doubleToasts } from "./actionDoubles.ts";

const SRC = path.resolve(import.meta.dirname, "..", "..");

const { raised } = doubleToasts();

/* One slice's real module, replaced whole: what the double has to derive is that module's own export
   list, so a stub written here would prove nothing about the derivation. */
const { calls, answerWith } = doubleActions({ modules: ["/src/features/spieltage/actions.ts"] });

/* `await import`, never a static import beside the doubles: each hook is registered as its call
   above evaluates, and a static import would have resolved the real module before then. */
const { appToast, UNDO_TIMEOUT_MS } = await import("@/shared/utils/appToast.ts");
const spieltage = await import("@/features/spieltage/actions.ts");

/**
 * Every member the tree actually calls, read off the call sites rather than off the module the
 * double mirrors: a second route to the same set, which is what makes disagreement visible
 * (`docs/_standard/standard.md` PRE-4).
 */
const CALLED = new Set(
  filesUnder(SRC, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 500).flatMap((file) =>
    [...blankComments(readFileSync(file, "utf8")).matchAll(/\bappToast\.(\w+)\(/g)].map(([, member]) => member ?? ""),
  ),
);

describe("the actions double", () => {
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
});

describe("the toast double", () => {
  it("carries every member the tree raises through it", () => {
    assert.ok(CALLED.size > 0, "no call site was found, so this compares the double against nothing");

    const missing = [...CALLED].filter((member) => typeof Reflect.get(appToast, member) !== "function");
    assert.deepEqual(missing, [], `the double answers undefined for: ${missing.join(", ")}`);
  });

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
