import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import type { FLSpieltagAdmin, FLSpieltagWriteResponse } from "@/core/generated/client/types";

const SPIELTAG_ID = "64b000000000000000000002";

/** A dated matchday, read again at a version newer than the editor's: someone re-dated it since. */
const STORED: FLSpieltagAdmin = {
  id: SPIELTAG_ID,
  saison_id: "2027",
  saison_phase: "gruppenphase",
  position: 2,
  count_spieltage_in_phase: 5,
  count_spiele: 4,
  beginn: "2027-03-13",
  ende: "2027-03-15",
  version: 4,
};

/** The editor's read, one version behind the stored matchday. */
const EDITOR_VERSION = 3;

const WRITTEN: FLSpieltagWriteResponse = { spieltag_id: SPIELTAG_ID, version: 5 };

/** The matchday the save reads before its write, and every payload it writes. */
const state = vi.hoisted(() => ({ read: null as unknown, sent: [] as unknown[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/spieltage/queries", () => ({ getAdminSpieltag: async () => ({ saison_status: "active", spieltag: state.read }) }));

doubleApiClient((call) => {
  state.sent.push(JSON.parse(call.body ?? "null"));
  return WRITTEN;
});

const { saveSpieltag } = await import("./saveSpieltag");

beforeEach(() => {
  state.read = STORED;
  state.sent = [];
});

describe("a matchday's save", () => {
  // The write takes both days and is judged on the version sent: the stored one in its place would write over a
  // re-dating someone else made since the editor was read, and the save would still answer „Gespeichert“.
  it("sends the day it changes with the other as stored, on the version the editor read", async () => {
    const answer = await saveSpieltag({ id: SPIELTAG_ID, version: EDITOR_VERSION, changes: { ende: "2027-03-16" } });

    expect(state.sent).toStrictEqual([{ beginn: "2027-03-13", ende: "2027-03-16", version: EDITOR_VERSION }]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });

  it("refuses an emptied day on its own box, writing nothing", async () => {
    const answer = await saveSpieltag({ id: SPIELTAG_ID, version: EDITOR_VERSION, changes: { beginn: null } });

    expect(answer).toStrictEqual({ ok: false, fieldErrors: { "changes.beginn": COPY.shared.field.required } });
    expect(state.sent).toStrictEqual([]);
  });
});
