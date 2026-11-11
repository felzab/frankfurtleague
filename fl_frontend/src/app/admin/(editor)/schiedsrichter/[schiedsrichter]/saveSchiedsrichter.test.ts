import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FLPatchSchiedsrichterResponse, FLSchiedsrichterSingleResponse } from "@/core/generated/client/types";

const SCHIEDSRICHTER_ID = "64b000000000000000000002";

/** The referee read again at a count newer than the editor's: someone saved since. */
const STORED = {
  schiedsrichter: {
    id: SCHIEDSRICHTER_ID,
    name: "Erika Muster",
    schule: "Goethe-Gymnasium",
    kontakt: { email: "erika@example.de", phone: "069 1234567" },
    default_payment: 25,
    version: 9,
  },
} as FLSchiedsrichterSingleResponse;

/** The editor's read, behind the stored referee. */
const EDITOR_VERSION = 8;

const WRITTEN: FLPatchSchiedsrichterResponse = { version: 11, confirmation: null };

/** Every payload the save writes. */
const state = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/schiedsrichter/queries", () => ({ getSchiedsrichterById: async () => STORED }));

doubleApiClient((call) => {
  state.sent.push(JSON.parse(call.body ?? "null"));
  return WRITTEN;
});

const { saveSchiedsrichter } = await import("./saveSchiedsrichter");

beforeEach(() => {
  state.sent = [];
});

describe("a referee's save", () => {
  // The write replaces the record whole: a field left alone sent as anything but stored erases it, and the save still
  // answers „Gespeichert“. The stored count in the editor's place would write over someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveSchiedsrichter({ id: SCHIEDSRICHTER_ID, version: EDITOR_VERSION, changes: { name: "Erika Neu" } });

    expect(state.sent).toStrictEqual([
      {
        name: "Erika Neu",
        schule: "Goethe-Gymnasium",
        kontakt: { email: "erika@example.de", phone: "069 1234567" },
        default_payment: 25,
        version: EDITOR_VERSION,
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });
});
