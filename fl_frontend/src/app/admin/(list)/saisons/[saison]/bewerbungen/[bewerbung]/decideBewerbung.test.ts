import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import type { FLAcceptBewerbungResponse } from "@/core/generated/client/types";

const ID = "64b000000000000000000002";

// The acceptance alone is answered, so the real guard, generated call and dispatch run, and any other request fails
// the case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === `/bewerbungen/${ID}/accept`
    ? ({
        created_team: false,
        gruppe: "A",
        saison_id: "2027",
        team_id: "64b000000000000000000003",
        trikot_farbe: null,
      } satisfies FLAcceptBewerbungResponse)
    : undefined,
);
// An administrator's session, made by passkey, which the act's guard admits.
signedInRequest();

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

describe("an acceptance", () => {
  /* A known club's closed box posts nothing: read as a missing field, every known club's acceptance would fail on a box
     nobody can touch, and the write refuses a code sent for one. */
  it("sends no code for a known club and the wish's blank as no colour", async () => {
    expect(await acceptBewerbung(posted({ trikot_farbe: "" }))).toStrictEqual({ ok: true, value: undefined });

    expect(backend.sent.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "POST", path: `/bewerbungen/${ID}/accept`, body: { gruppe: "A", trikot_farbe: null, shorthand: null, version: 3 } },
    ]);
  });
});
