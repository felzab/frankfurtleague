import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { serveBackend } from "@/test-support/backend";
import { posted } from "@/test-support/posted";
import { signedInRequest } from "@/test-support/session";

const ID = "64b000000000000000000002";

// The acceptance alone is answered, so the real guard, generated call and dispatch run, and any other request fails
// the case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === `/bewerbungen/${ID}/accept` ? new Response(null, { status: 204 }) : undefined,
);
// An administrator's session, made by passkey, which the act's guard admits.
signedInRequest();

const { acceptBewerbung } = await import("./acceptBewerbung");
const { boxRulesOf } = await import("@/core/action");

/** An acceptance as the dialog posts it: a closed box posts nothing at all. */
function acceptance(fields: Readonly<Record<string, string>>): FormData {
  return posted({ id: ID, version: "3", gruppe: "A", ...fields });
}

describe("an acceptance", () => {
  /* A known club's closed box posts nothing: read as a missing field, every known club's acceptance would fail on a box
     nobody can touch, and the write refuses a code sent for one. */
  it("sends no code for a known club and the wish's blank as no colour", async () => {
    expect(await acceptBewerbung(acceptance({ trikot_farbe: "" }))).toStrictEqual({ ok: true, value: undefined });

    expect(backend.sent.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "POST", path: `/bewerbungen/${ID}/accept`, body: { gruppe: "A", trikot_farbe: null, shorthand: null, version: 3 } },
    ]);
  });

  /* The dialog and every bulk card hold their boxes to these rules: without the mark, a bulk card moves on with a new
     school's Kürzel empty, and the miss shows only once the whole run is confirmed. */
  it("requires a new school's Kürzel, and refuses its box left empty", async () => {
    expect(boxRulesOf(acceptBewerbung)["shorthand"]?.required).toBe(true);

    expect(await acceptBewerbung(acceptance({ trikot_farbe: "", shorthand: "" }))).toStrictEqual({
      ok: false,
      fieldErrors: { shorthand: COPY.shared.field.required },
    });
    expect(backend.sent).toHaveLength(0);
  });
});
