import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "@/core/refusalRegister.ts";

// Source text because the table is module-private, and a test-only export of it would be a seam in a
// route handler.
const ROUTE = readFileSync(path.resolve(import.meta.dirname, "route.ts"), "utf8");

/** What `fl_frontend/src/features/spiele/mutations.ts :: patchAdminSpielPaarung` sends, as the backend's register spells it. */
const REPLAY_OPERATION = "PATCH /spiele/{spiel_id}/paarung";

/* The table alone: the handler below it reads a row by code and words two outcomes of its own, and a
   search over the whole route is satisfied by either. */
const TABLE = sliceBetween(ROUTE, "const REPLAY_REFUSALS", "const CHANGE_STANDS");

/** Each row opens its own line with the code it answers; a wrapped German value opens none. */
const KEYED_ROW = /^\s+"(?<code>[A-Z][A-Z0-9-]*)":/gm;

const rowCodes = [...TABLE.matchAll(KEYED_ROW)].map((row) => row.groups?.code).filter((code) => code !== undefined);

describe("the undo route's replay refusals against the endpoint it replays", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the replay table out of the route before reading it", () => {
    assert.notEqual(TABLE, "", "the table's opening or the declaration closing it stopped matching");
    assert.ok(!TABLE.includes("export async function POST"), "the cut runs on into the handler, whose lines this reader would take for rows");
  });

  /* Both sides, because the comparison below holds of two empty lists: a register that stopped naming
     this operation and a reader that stopped finding rows would each pass it in silence. */
  it("reads rows out of the route and rules out of the register", () => {
    assert.ok(rowCodes.length > 0, "no row was read out of the replay table");
    assert.ok(declaredCodes(REPLAY_OPERATION).length > 0, `no rule is declared against ${REPLAY_OPERATION}`);
  });

  /* The whole set rather than a floor: a code this table misses reaches the admin as the 409 fallback
     in `fl_frontend/src/shared/utils/actionError.ts`, which tells them an equivalent entry exists. */
  it("words exactly the refusals the replayed endpoint declares", () => {
    assert.deepEqual([...rowCodes].sort(), declaredCodes(REPLAY_OPERATION));
  });

  // The operation above is that mutation's endpoint, so a replay routed anywhere else would be graded
  // against refusals it cannot meet; the mutation's own path is held to a published one by
  // `fl_frontend/src/core/apiRequests.test.ts`.
  it("replays through the endpoint those rules are declared against", () => {
    assert.ok(ROUTE.includes("patchAdminSpielPaarung("), `the replay sends something other than ${REPLAY_OPERATION}`);
  });
});
