import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";

import { gruppenFor, openRows, outcomeOf, takenFor } from "./run";

import type { FLBewerbungListRow } from "@/core/generated/client/types";
import type { Draft, Run } from "./run";

const row = (id: string) => ({ id }) as FLBewerbungListRow;
const ROWS = [row("a"), row("b"), row("c")];
const draft = (gruppe: string): Draft => ({ gruppe, trikot_farbe: "", shorthand: "" });
const run = (overrides: Partial<Run> = {}): Run => ({ drafts: {}, skipped: new Set(), outcomes: {}, ...overrides });

describe("what a run still has to write", () => {
  /* A second confirm over an entered row would answer `bewerbung_already_decided` on an application that is fine. */
  it("leaves out what was skipped and what was entered, keeping what was refused", () => {
    const answered = run({
      skipped: new Set(["a"]),
      outcomes: { b: { kind: "accepted" }, c: { kind: "refused", taken: true, line: undefined, fieldErrors: undefined } },
    });

    expect(openRows(ROWS, answered).map(({ id }) => id)).toStrictEqual(["c"]);
  });
});

describe("the groups a card offers", () => {
  const GRUPPEN = [{ gruppe: "A", free: 1 } as const, { gruppe: "B", free: 2 } as const];

  /* Greyed on the server's figure alone, the run could pick one group past its room, each extra row refused at the end. */
  it("takes the run's other picks off a group's places", () => {
    const offered = gruppenFor(GRUPPEN, ROWS, run({ drafts: { a: draft("A"), b: draft("B") } }), "c");

    expect(offered.map(({ free }) => free)).toStrictEqual([0, 1]);
  });

  it("leaves a card's own pick its place, so it can stay on it", () => {
    expect(gruppenFor(GRUPPEN, ROWS, run({ drafts: { a: draft("A") } }), "a")[0]?.free).toBe(1);
  });

  it("gives a place back once its application left the run", () => {
    const skipped = run({ drafts: { a: draft("A") }, skipped: new Set(["a"]) });

    expect(gruppenFor(GRUPPEN, ROWS, skipped, "b")[0]?.free).toBe(1);
  });
});

// The harm: a row refused for its colour and its Kürzel together reads without its Kürzel chip, the colour's fault
// coming first, and the administrator never learns the code is taken.
describe("a refused row's Kürzel chip", () => {
  const { field } = COPY.shared;

  it("is read off the Kürzel's own fault, whichever fault the refusal names first", () => {
    const outcome = outcomeOf({
      ok: false,
      errorCode: "trikot_farbe_taken",
      fieldErrors: { trikot_farbe: field.taken, shorthand: field.taken },
      kinds: { trikot_farbe: "trikot_farbe_taken", shorthand: "duplicate_key" },
    });

    expect(outcome).toMatchObject({ kind: "refused", taken: true });
  });

  it("stands for no other fault of the Kürzel's box", () => {
    expect(outcomeOf({ ok: false, fieldErrors: { shorthand: field.required }, kinds: { shorthand: "payload_refused" } })).toMatchObject({
      taken: false,
    });
  });
});

describe("the colours a card may not take", () => {
  const colour = (trikot_farbe: string): Draft => ({ gruppe: "A", trikot_farbe, shorthand: "" });

  it("adds the run's other picks to the season's, leaving a card its own and an empty box none", () => {
    const picked = run({ drafts: { a: colour("rot"), b: colour("blau"), c: colour("") } });

    expect(takenFor(["gelb"], ROWS, picked, "b")).toStrictEqual(["gelb", "rot"]);
  });
});
