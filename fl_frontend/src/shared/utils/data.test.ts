import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { joinCollections } from "./data.ts";

const spieltage = [
  { id: "st1", nr: 1 },
  { id: "st2", nr: 2 },
  { id: "st3", nr: 3 },
];

const spiele = [
  { id: "s1", spieltag_id: "st1" },
  { id: "s2", spieltag_id: "st1" },
  { id: "s3", spieltag_id: "st2" },
];

describe("joinCollections", () => {
  it("groups right rows under the named target key", () => {
    const result = joinCollections({ left: spieltage, right: spiele, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });

    assert.deepEqual(result[0]?.spiele, [spiele[0], spiele[1]]);
    assert.deepEqual(result[1]?.spiele, [spiele[2]]);
  });

  // A Spieltag with no matches must still render, so an unmatched left row gets [] and not undefined.
  it("gives unmatched left rows an empty array", () => {
    const result = joinCollections({ left: spieltage, right: spiele, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });
    assert.deepEqual(result[2]?.spiele, []);
  });

  it("preserves left order and left fields", () => {
    const result = joinCollections({ left: spieltage, right: spiele, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });
    assert.deepEqual(
      result.map((x) => x.nr),
      [1, 2, 3],
    );
  });

  it("preserves right order within a group", () => {
    const reversed = [spiele[1]!, spiele[0]!];
    const result = joinCollections({ left: spieltage, right: reversed, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });
    assert.deepEqual(result[0]?.spiele, [spiele[1], spiele[0]]);
  });

  it("does not mutate the left rows", () => {
    joinCollections({ left: spieltage, right: spiele, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });
    assert.deepEqual(spieltage[0], { id: "st1", nr: 1 });
  });

  it("drops right rows whose key matches no left row", () => {
    const orphaned = [{ id: "s9", spieltag_id: "st-missing" }];
    const result = joinCollections({ left: spieltage, right: orphaned, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });
    assert.deepEqual(
      result.flatMap((x) => x.spiele),
      [],
    );
  });

  it("handles empty inputs", () => {
    const noLeft = joinCollections({
      left: [] as typeof spieltage,
      right: spiele,
      leftIdKey: "id",
      rightIdKey: "spieltag_id",
      targetKey: "spiele",
    });
    assert.deepEqual(noLeft, []);
    const noRight = joinCollections({
      left: spieltage,
      right: [] as typeof spiele,
      leftIdKey: "id",
      rightIdKey: "spieltag_id",
      targetKey: "spiele",
    });
    assert.deepEqual(
      noRight.map((x) => x.spiele),
      [[], [], []],
    );
  });
});
