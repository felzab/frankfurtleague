import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";
import { sliceBetween } from "@/shared/testing/refusalRegister.ts";

// Source text because the runner cannot import this module at all: `next/server` resolves to no file
// through `fl_frontend/tsconfig-alias-hook.mjs`, so nothing here can call the spine and read what it did.
const SPINE = readFileSync(path.resolve(import.meta.dirname, "undoRoute.ts"), "utf8");

const ADMIN_API = path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin");

/** Every undo route, walked rather than listed, so one added is swept with the rest. */
const UNDO_ROUTES = filesUnder(ADMIN_API, (name) => name === "route.ts", 8).filter((file) => path.basename(path.dirname(file)) === "undo");

/**
 * The slices whose replay commits in parts, each named by the sentence it answers when it stops. A
 * replay the backend commits whole words no such sentence and takes no row.
 */
const PART_WAY: Record<string, RegExp> = {
  spieler: /Nur die Personendaten wurden zurückgesetzt/,
  teams: /Nur die Stammdaten wurden zurückgesetzt/,
};

describe("what the undo spine clears when a replay stops part-way", () => {
  /* First: an empty walk, or a route that stopped wording a part-way outcome, would leave the case
     below reading a guard over no reachable path. */
  it("walks the replays that can leave rows behind", () => {
    assert.ok(UNDO_ROUTES.length >= 8, `the walk found ${String(UNDO_ROUTES.length)} undo routes`);

    for (const [slice, sentence] of Object.entries(PART_WAY)) {
      const route = UNDO_ROUTES.find((file) => file.includes(path.join(slice, "undo")));

      assert.ok(route, `no undo route was walked for ${slice}`);
      assert.match(readFileSync(route, "utf8"), sentence, `${slice}: nothing reports a restore that stopped part-way`);
    }
  });

  /* The defect: an invalidation reached only past the refusal's own return never runs for those
     outcomes, so a cached fixture serves the pre-undo state for a day and a cached club for a week. */
  it("clears the caches before it reports a refusal, and where the restore throws", () => {
    assert.equal((SPINE.match(/route\.invalidate\(/g) ?? []).length, 1, "a second invalidation site would satisfy this reading on its own");

    const pastTheRestore = sliceBetween(SPINE, "await route.restore(", "if (report.refusal !== undefined)");

    assert.ok(pastTheRestore.includes("route.invalidate("), "the invalidation sits past the refusal's return, which a part-way restore takes");
    assert.ok(pastTheRestore.includes("} finally {"), "a restore that throws leaves the caches serving the rows it had already written");
  });
});
