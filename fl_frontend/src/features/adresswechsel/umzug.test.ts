import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FLAdresswechselUmzuegeErledigtPayload, FLAdresswechselUmzuegeResponse } from "@/core/generated/client/types.ts";

/** The owed carries the backend lists, page after page; a case sets them. */
let seiten: FLAdresswechselUmzuegeResponse["umzuege"][] = [];
/** Every pair `carryAccount` was handed, in order. */
const carried: [string, string][] = [];
/** Every list of ids reported carried, in order. */
const erledigt: string[][] = [];

// Replaced at the module boundary: the real client reaches a backend no test process runs.
doubleApiClient((call) => {
  if (call.method === "GET") return { umzuege: seiten.shift() ?? [] } satisfies FLAdresswechselUmzuegeResponse;
  const { ids } = JSON.parse(call.body ?? "{}") as FLAdresswechselUmzuegeErledigtPayload;
  erledigt.push(ids);
  return { erledigt: ids.length };
});

vi.doMock("@/core/auth.ts", () => ({
  carryAccount: (von: string, nach: string) => {
    carried.push([von, nach]);
    return Promise.resolve("umgezogen");
  },
}));

const { runAdresswechselUmzuege } = await import("./umzug.ts");

const umzug = (n: number) => ({ id: n.toString(16).padStart(24, "0"), von: `alt${String(n)}@schule.de`, nach: `neu${String(n)}@schule.de` });

beforeEach(() => {
  carried.length = 0;
  erledigt.length = 0;
});

/* Owed on the ended record and listed until reported: a carry never reported is listed, and carried, every pass. */
describe("the owed carries", () => {
  it("carries every listed account, reports each page carried, and ends once the list is empty", async () => {
    seiten = [[umzug(1), umzug(2)], [umzug(3)]];

    await runAdresswechselUmzuege();

    expect(carried).toStrictEqual([
      ["alt1@schule.de", "neu1@schule.de"],
      ["alt2@schule.de", "neu2@schule.de"],
      ["alt3@schule.de", "neu3@schule.de"],
    ]);
    expect(erledigt).toStrictEqual([[umzug(1).id, umzug(2).id], [umzug(3).id]]);
  });
});
