import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { cardOf, gruppenFor, openRows, outcomeOf, takenFor } from "./run.ts";

import type { FLBewerbungListRow } from "@/core/generated/client/types.ts";
import type { Draft, Run } from "./run.ts";

const row = (id: string) => ({ id }) as FLBewerbungListRow;
const ROWS = [row("a"), row("b"), row("c")];
const draft = (gruppe: string): Draft => ({ gruppe, trikot_farbe: "", shorthand: "" });
const run = (overrides: Partial<Run> = {}): Run => ({ drafts: {}, skipped: new Set(), outcomes: {}, ...overrides });

describe("which card a run stands at", () => {
  it("takes the first application still to be chosen", () => {
    expect(cardOf(ROWS, run({ drafts: { a: draft("A") } }), null)?.id).toBe("b");
  });

  /* The way back from a refused row: a card already chosen, which „the first still to be chosen“ would pass over. */
  it("opens the card the address names, even one already chosen", () => {
    expect(cardOf(ROWS, run({ drafts: { a: draft("A"), b: draft("A"), c: draft("B") } }), "a")?.id).toBe("a");
  });

  /* Back to a skipped card would otherwise change the address and leave the same card standing. */
  it("opens a skipped card the address names", () => {
    expect(cardOf(ROWS, run({ skipped: new Set(["a"]) }), "a")?.id).toBe("a");
  });

  it("leaves an entered card, and stands at the check page once every one is chosen", () => {
    const chosen = { a: draft("A"), c: draft("B") };

    expect(cardOf(ROWS, run({ drafts: chosen, outcomes: { b: { kind: "accepted" } } }), "b")).toBe(null);
  });
});

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

describe("the colours a card may not take", () => {
  const colour = (trikot_farbe: string): Draft => ({ gruppe: "A", trikot_farbe, shorthand: "" });

  it("adds the run's other picks to the season's, leaving a card its own and an empty box none", () => {
    const picked = run({ drafts: { a: colour("rot"), b: colour("blau"), c: colour("") } });

    expect(takenFor(["gelb"], ROWS, picked, "b")).toStrictEqual(["gelb", "rot"]);
  });

  it("gives a colour back once its application left the run", () => {
    const skipped = run({ drafts: { a: colour("rot") }, skipped: new Set(["a"]) });

    expect(takenFor([], ROWS, skipped, "b")).toStrictEqual([]);
  });
});

describe("what a write's answer leaves on its row", () => {
  it("names a taken code by its chip alone, a refused box keeping its message for the card", () => {
    const fieldErrors = { shorthand: COPY.shared.field.taken };

    expect(outcomeOf({ ok: false, errorCode: "duplicate_key", fieldErrors })).toStrictEqual({
      kind: "refused",
      taken: true,
      line: undefined,
      fieldErrors,
    });
  });

  it("keeps any other refusal's line for the row", () => {
    const reason = COPY.shared.failure.stale;

    expect(outcomeOf({ ok: false, errorCode: "version_stale", reason })).toMatchObject({ taken: false, line: reason });
  });
});
