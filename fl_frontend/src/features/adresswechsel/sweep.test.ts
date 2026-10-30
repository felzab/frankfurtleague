import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it } from "vitest";

import type { FLAddressChangeSweepResponse } from "@/core/generated/client/types.ts";

/** One call's answer, `nach` the place the next call starts after. */
const antwort = (entfernt: number, verbleibend: number, nach: string | null = null): FLAddressChangeSweepResponse => ({
  removed: entfernt,
  discarded: 0,
  effective: 0,
  remaining: verbleibend,
  nach: nach,
});

/** The pass's answers in turn; past the last, a place-free answer ends any loop rather than hanging it. */
let antworten: (FLAddressChangeSweepResponse | Error)[] = [];
/** Every call in the order sent: the sweep's place, or the carry's list. */
const calls: string[] = [];

/** Places in the `_id` order, as the mirror demands them. */
const ORT = `${"d".repeat(23)}4`;

doubleApiClient((call) => {
  if (call.endpoint.endsWith("/moves")) {
    calls.push("umzuege");
    return { umzuege: [] };
  }
  // A generated call carries its query in its endpoint.
  calls.push(new URL(call.endpoint, "http://backend").searchParams.get("nach") ?? "-");
  const next = antworten.shift() ?? antwort(0, 0);
  if (next instanceof Error) throw next;
  return next;
});

const { sweepAdresswechsel } = await import("./sweep.ts");

beforeEach(() => {
  calls.length = 0;
});

describe("the address changes' hourly pass", () => {
  /* The pass is the caller's to hold: each call carries the place the call before it answered, and the first answer
     naming none ends it; the owed carries follow it. */
  it("hands each call the place the last answer named, ends on one naming none, then carries", async () => {
    antworten = [antwort(2, 1, ORT), antwort(1, 1), antwort(4, 4)];

    await sweepAdresswechsel();

    expect(calls).toStrictEqual(["-", ORT, "umzuege"]);
  });

  /* Each call counts every lapsed change standing, an earlier page's failures among them, so the remainder is the last
     call's: a sum would count the first page's unreached rows as left behind. */
  it("answers the last call's remainder, never a sum, beside the pages' summed counts", async () => {
    antworten = [antwort(2, 5, ORT), antwort(3, 1)];

    expect(await sweepAdresswechsel()).toStrictEqual({ entfernt: 5, wirksam: 0, verworfen: 0, verbleibend: 1 });
  });

  /* A place not past the one sent would hold the pass, and every clock behind it, for ever. */
  it("rejects where a call answers a place not past the one sent, carrying nothing", async () => {
    antworten = [antwort(2, 5, ORT), antwort(1, 4, ORT)];

    await expect(sweepAdresswechsel()).rejects.toThrow("not past the one they were sent");
    expect(calls).toStrictEqual(["-", ORT]);
  });

  /* The scheduler names a job only where it rejects. */
  it("rejects where a call fails", async () => {
    antworten = [new TypeError("fetch failed")];

    await expect(sweepAdresswechsel()).rejects.toThrow(TypeError);
  });
});
