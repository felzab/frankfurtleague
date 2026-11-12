import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FLPatchSpielerSaisonResponse, FLSpielerSaisonAdminResponse } from "@/core/generated/client/types";

const SPIELER_ID = "64b000000000000000000002";
const SAISON = "2027";

/** The player read again at a count newer than the editor's: someone saved since. */
const STORED = {
  version: 9,
  person: { first_name: "Max", last_name: "Mustermann", birth_date: "2009-05-04" },
  kader: { nummer: "7", position: "Abwehr", stufe: "Q2", rolle: "kapitaen" },
} as FLSpielerSaisonAdminResponse;

/** The editor's read, behind the stored player. */
const EDITOR_VERSION = 8;

const WRITTEN: FLPatchSpielerSaisonResponse = { version: 11 };

/** Every payload the save writes. */
const state = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/spieler/queries", () => ({ getSpielerSaison: async () => STORED }));

doubleApiClient((call) => {
  state.sent.push(JSON.parse(call.body ?? "null"));
  return WRITTEN;
});

const { saveSpieler } = await import("./saveSpieler");

beforeEach(() => {
  state.sent = [];
});

describe("a player's save", () => {
  // The write replaces both documents whole: a field left alone sent as anything but stored erases it, and the save
  // still answers „Gespeichert“. The stored count in the editor's place would write over someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveSpieler({ id: SPIELER_ID, saison: SAISON, version: EDITOR_VERSION, changes: { first_name: "Maximilian" } });

    expect(state.sent).toStrictEqual([
      {
        first_name: "Maximilian",
        last_name: "Mustermann",
        birth_date: "2009-05-04",
        nummer: "7",
        position: "Abwehr",
        stufe: "Q2",
        rolle: "kapitaen",
        version: EDITOR_VERSION,
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });

  // An emptied select or box is a value the person chose to clear, never one left alone.
  it("clears what the editor emptied", async () => {
    await saveSpieler({ id: SPIELER_ID, saison: SAISON, version: EDITOR_VERSION, changes: { last_name: "", nummer: "", rolle: "" } });

    expect(state.sent).toMatchObject([{ last_name: null, nummer: null, rolle: null, position: "Abwehr" }]);
  });
});
