import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FLPatchSpielortResponse, FLSpielort } from "@/core/generated/client/types";

const SPIELORT_ID = "64b000000000000000000002";

/** The venue read again at a count newer than the editor's: someone saved since. */
const STORED = {
  id: SPIELORT_ID,
  name: "Sportpark West",
  address: { street: "Am Sportfeld", house_number: "3", postcode: "60489", district: "Rödelheim", city: "Frankfurt" },
  default_mietpreis: 40,
  version: 9,
} as FLSpielort;

/** The editor's read, behind the stored venue. */
const EDITOR_VERSION = 8;

const WRITTEN: FLPatchSpielortResponse = { version: 11 };

/** Every payload the save writes. */
const state = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/spielorte/queries", () => ({ getSpielort: async () => STORED }));

doubleApiClient((call) => {
  state.sent.push(JSON.parse(call.body ?? "null"));
  return WRITTEN;
});

const { saveSpielort } = await import("./saveSpielort");

beforeEach(() => {
  state.sent = [];
});

describe("a venue's save", () => {
  // The write replaces the record whole: a field left alone sent as anything but stored erases it, and the save still
  // answers „Gespeichert“. The stored count in the editor's place would write over someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveSpielort({ id: SPIELORT_ID, version: EDITOR_VERSION, changes: { name: "Sportpark Nord" } });

    expect(state.sent).toStrictEqual([
      {
        name: "Sportpark Nord",
        default_mietpreis: 40,
        address: { street: "Am Sportfeld", house_number: "3", postcode: "60489", district: "Rödelheim", city: "Frankfurt" },
        version: EDITOR_VERSION,
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: WRITTEN.version });
  });
});
