import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "64b000000000000000000002";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

/** Every call the doubled client was sent. */
const state = vi.hoisted(() => ({ sent: [] as unknown[] }));

doubleApiClient((call) => {
  state.sent.push({ endpoint: call.endpoint, body: JSON.parse(call.body ?? "null") as unknown });
});

const { acceptBewerbung } = await import("./decideBewerbung");

/** An acceptance as the dialog posts it: a closed box posts nothing at all. */
function posted(fields: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  form.set("id", ID);
  form.set("version", "3");
  form.set("gruppe", "A");
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

beforeEach(() => {
  state.sent = [];
});

describe("an acceptance", () => {
  /* A known club's closed box posts nothing: read as a missing field, every known club's acceptance would fail on a box
     nobody can touch, and the write refuses a code sent for one. */
  it("sends no code for a known club and the wish's blank as no colour", async () => {
    await acceptBewerbung(posted({ trikot_farbe: "" }));

    expect(state.sent).toStrictEqual([
      { endpoint: `/bewerbungen/${ID}/accept`, body: { gruppe: "A", trikot_farbe: null, shorthand: null, version: 3 } },
    ]);
  });
});
