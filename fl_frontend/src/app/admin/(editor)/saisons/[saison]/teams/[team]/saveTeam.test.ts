import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

const TEAM_ID = "64b000000000000000000002";
const SAISON = "2027";

/** The club read again at a count newer than the editor's: someone saved since. */
const STORED = {
  team: {
    name: "Goethe",
    shorthand: "GOE",
    full_name: "Goethe-Gymnasium",
    schulform: "gymnasium",
    website_url: "https://goethe.example",
    description: "Im Westend",
    address: { street: "Friedrichstraße", house_number: "1", postcode: "60323", district: "Westend", city: "Frankfurt" },
  },
  membership: { gruppe: "A", trikot_farbe: "rot" },
};

/** The editor's read, behind the stored club. */
const EDITOR_VERSION = 8;

/** Every payload the save writes. */
const state = vi.hoisted(() => ({ sent: [] as unknown[], refusal: null as unknown }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/teams/queries", () => ({ getTeamSaisonAdmin: async () => STORED }));

doubleApiClient((call) => {
  state.sent.push(JSON.parse(call.body ?? "null"));
  if (state.refusal !== null) throw state.refusal;
  return { version: 11 };
});

const { saveTeam } = await import("./saveTeam");

beforeEach(() => {
  state.sent = [];
  state.refusal = null;
});

describe("a club's save", () => {
  // The write replaces both documents whole: a field left alone sent as anything but stored erases a club's address or
  // its description, and the bar still says „Gespeichert“. The stored count in the editor's place would write over
  // someone else's save.
  it("sends what it changes with the rest as stored, on the count the editor read", async () => {
    const answer = await saveTeam({ id: TEAM_ID, saison_id: SAISON, version: EDITOR_VERSION, changes: { name: "Goethe 2" } });

    expect(state.sent).toStrictEqual([
      {
        name: "Goethe 2",
        shorthand: "GOE",
        full_name: "Goethe-Gymnasium",
        description: "Im Westend",
        schulform: "gymnasium",
        website_url: "https://goethe.example",
        address: { street: "Friedrichstraße", house_number: "1", postcode: "60323", district: "Westend", city: "Frankfurt" },
        gruppe: "A",
        trikot_farbe: "rot",
        version: EDITOR_VERSION,
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: 11 });
  });

  // An emptied select or box is a value the person chose to clear, never one left alone.
  it("clears what the editor emptied", async () => {
    await saveTeam({ id: TEAM_ID, saison_id: SAISON, version: EDITOR_VERSION, changes: { schulform: "", website_url: "", trikot_farbe: "" } });

    expect(state.sent).toMatchObject([{ schulform: null, website_url: null, trikot_farbe: null, gruppe: "A", name: "Goethe" }]);
  });

  // The list of codes the screen words is held by nothing else: the shared failure line sends a retry the same rule refuses.
  it("answers a colour another row holds on its box", async () => {
    state.refusal = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/",
      statusCode: 409,
      serverErrorCode: "trikot_farbe_taken",
      endpoint: "/",
      traceId: "0",
      refusedFields: [{ path: ["trikot_farbe"], kind: "trikot_farbe_taken", ctx: {}, in: "body" }],
    });

    expect(await saveTeam({ id: TEAM_ID, saison_id: SAISON, version: EDITOR_VERSION, changes: { trikot_farbe: "blau" } })).toMatchObject({
      ok: false,
      fieldErrors: { "changes.trikot_farbe": COPY.shared.field.taken },
    });
  });
});
