import { networkFailure, serveBackend } from "@/test-support/backend.ts";
import { describe, expect, it } from "vitest";

import { APINetworkError } from "@/core/errors.ts";

import type { FLAddressChangeSweepResponse } from "@/core/generated/client/types.ts";

/** One call's answer, `after` the place the next call starts after. */
const antwort = (removed: number, remaining: number, after: string | null = null): FLAddressChangeSweepResponse => ({
  removed,
  discarded: 0,
  effective: 0,
  remaining,
  after,
});

/** Places in the `_id` order, as the mirror demands them. */
const ORT = `${"d".repeat(23)}4`;

const SWEEP = "/address_change/sweep";
const MOVES = "/address_change/sweep/moves";

/** The pass's answers in turn; past the last, a place-free answer ends any loop rather than hanging it. */
let antworten: (FLAddressChangeSweepResponse | Response)[] = [];

// The sweep's calls and the carry's list, and nothing else: any other request fails the case.
const backend = serveBackend(({ method, path }) => {
  if (method === "GET" && path === MOVES) return { moves: [] };
  if (method === "POST" && path === SWEEP) return antworten.shift() ?? antwort(0, 0);
  return undefined;
});

const { sweepAddressChange } = await import("./sweep.ts");

/** Every request in the order sent: the sweep's by the place it carried, the carry's list by its name. */
const calls = (): string[] => backend.sent.map(({ path, search }) => (path === MOVES ? "moves" : (search.get("after") ?? "-")));

describe("the address changes' hourly pass", () => {
  /* The pass is the caller's to hold: each call carries the place the call before it answered, and the first answer
     naming none ends it; the owed carries follow it. */
  it("hands each call the place the last answer named, ends on one naming none, then carries", async () => {
    antworten = [antwort(2, 1, ORT), antwort(1, 1), antwort(4, 4)];

    await sweepAddressChange();

    expect(calls()).toStrictEqual(["-", ORT, "moves"]);
    // A first call carrying no `after` at all, never a null one: present, the server reads it as an id.
    expect(backend.sent[0]?.search.has("after"), "the first call carried a place").toBe(false);
  });

  /* A place not past the one sent would hold the pass, and every clock behind it, for ever. */
  it("rejects where a call answers a place not past the one sent, carrying nothing", async () => {
    antworten = [antwort(2, 5, ORT), antwort(1, 4, ORT)];

    await expect(sweepAddressChange()).rejects.toThrow("not past the one they were sent");
    expect(calls()).toStrictEqual(["-", ORT]);
  });

  /* The scheduler names a job only where it rejects. */
  it("rejects where a call fails", async () => {
    antworten = [networkFailure()];

    await expect(sweepAddressChange()).rejects.toThrow(APINetworkError);
    expect(calls()).toStrictEqual(["-"]);
  });
});
