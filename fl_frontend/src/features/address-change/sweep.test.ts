import { describe, expect, it } from "vitest";

import { APINetworkError } from "@/core/errors";
import { networkFailure, serveBackend } from "@/test-support/backend";

import type { FLAddressChangeSweepResponse } from "@/core/generated/client/types";

const ANSWER: FLAddressChangeSweepResponse = { removed: 2, discarded: 0, effective: 1, failed: 1 };

const SWEEP = "/address_change/sweep";
const MOVES = "/address_change/sweep/moves";

/** The pass's call's answer, which a case sets. */
let answer: FLAddressChangeSweepResponse | Response = ANSWER;

// The sweep's call and the carry's list, and nothing else: any other request fails the case.
const backend = serveBackend(({ method, path }) => {
  if (method === "GET" && path === MOVES) return { moves: [] };
  if (method === "POST" && path === SWEEP) return answer;
  return undefined;
});

const { runAddressChangeSweep } = await import("./sweep");

/** Every request in the order sent, by its path. */
const calls = (): string[] => backend.sent.map(({ path }) => path);

describe("the address changes' hourly pass", () => {
  /* An effect whose carry no pass makes keeps the replaced address's account, which the account sweep then never deletes. */
  it("ends the changes, then carries what their effects owe, answering what the call did", async () => {
    answer = ANSWER;

    expect(await runAddressChangeSweep()).toStrictEqual({
      count: { address_change_removed: 2, address_change_effective: 1, address_change_discarded: 0, address_change_failed: 1 },
      open: 1,
    });
    expect(calls()).toStrictEqual([SWEEP, MOVES]);
  });

  /* The scheduler names a job only where it rejects. */
  it("rejects where the call fails, carrying nothing", async () => {
    answer = networkFailure();

    await expect(runAddressChangeSweep()).rejects.toThrow(APINetworkError);
    expect(calls()).toStrictEqual([SWEEP]);
  });
});
