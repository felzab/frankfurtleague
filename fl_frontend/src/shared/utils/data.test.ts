import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { joinCollections } from "./data.ts";

const spieltage = [
  { id: "st1", nr: 1 },
  { id: "st2", nr: 2 },
  { id: "st3", nr: 3 },
];

// Named rather than indexed off the array, so no test needs a non-null assertion to
// reference one — those would become load-bearing under Wave 4's noUncheckedIndexedAccess.
const spielA = { id: "s1", spieltag_id: "st1" };
const spielB = { id: "s2", spieltag_id: "st1" };
const spielC = { id: "s3", spieltag_id: "st2" };
const spiele = [spielA, spielB, spielC];

describe("joinCollections", () => {
  it("groups right rows under the named target key", () => {
    const result = joinCollections({ left: spieltage, right: spiele, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });

    assert.deepEqual(result[0]?.spiele, [spielA, spielB]);
    assert.deepEqual(result[1]?.spiele, [spielC]);
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
    const reversed = [spielB, spielA];
    const result = joinCollections({ left: spieltage, right: reversed, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "spiele" });
    assert.deepEqual(result[0]?.spiele, [spielB, spielA]);
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

describe("joinCollections — duplicate left ids", () => {
  const left = [
    { id: "st1", label: "first" },
    { id: "st1", label: "second copy of the same id" },
  ];
  const right = [{ spieltag_id: "st1", n: 1 }];

  // Without .slice() every row sharing an id receives the SAME array instance, so an in-place sort
  // or push in one consumer silently reorders another's list. This is the test that fails if the
  // .slice() is removed -- the original fixtures all use distinct ids, so nothing caught it.
  it("gives each row its own array instance", () => {
    const [a, b] = joinCollections({ left, right, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "items" });

    assert.deepEqual(a!.items, b!.items);
    assert.notEqual(a!.items, b!.items, "rows sharing an id must not share one array");
  });

  it("does not let a mutation of one row's group reach another", () => {
    const [a, b] = joinCollections({ left, right, leftIdKey: "id", rightIdKey: "spieltag_id", targetKey: "items" });

    a!.items.push({ spieltag_id: "st1", n: 99 });

    assert.equal(a!.items.length, 2);
    assert.equal(b!.items.length, 1);
  });
});
