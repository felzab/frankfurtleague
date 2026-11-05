import { doubleApiClient } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

import type { Code, FLPatchSaisonPayload, FLRefusedField, FLSaisonAdmin } from "@/core/generated/client/types";

/** A season with both windows and every rule set, so a save dropping one is seen. */
const STORED: FLSaisonAdmin = {
  id: "2027",
  start_date: "2027-03-06",
  end_date: "2027-07-03",
  rules: {
    win_points: 3,
    draw_points: 1,
    tiebreak_order: "tordifferenz",
    number_of_gruppen: 4,
    teams_per_gruppe: 4,
    qualifiers_per_gruppe: 2,
    max_kadergroesse: 18,
    allowed_stufen: ["E1", "E2", "Q1"],
    forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  },
  bewerbung: { start: "2027-01-10", end: "2027-02-07" },
  registrierung: { end: "2027-03-05", offen: false },
  schedule: [],
  spielplan: null,
  status: "future",
  begun: false,
  taken_place: false,
  decided: false,
  version: 3,
};

/** Every payload the save sends, and how the write answers it. */
const stand = vi.hoisted(() => ({ sent: [] as unknown[], refusal: null as unknown }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a save clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("@/features/saisons/queries", () => ({ getAdminSaison: async () => ({ saison: STORED }) }));

// The backend client itself is replaced, so the write runs through the real generated call and the real dispatch.
doubleApiClient((call) => {
  stand.sent.push(JSON.parse(call.body ?? "null"));
  if (stand.refusal !== null) throw stand.refusal;
  return { version: 4 };
});

const { saveSaison } = await import("./saveSaison");

/** The write's refusal of the fields it names, each with the bounds its rule names. */
const refusal = (serverErrorCode: Code, fields: readonly FLRefusedField[]) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/saisons/2027",
    statusCode: 409,
    serverErrorCode,
    refusedFields: fields,
    endpoint: "/saisons/2027",
    method: "PATCH",
    readOnly: false,
    traceId: "0",
  });

beforeEach(() => {
  stand.sent = [];
  stand.refusal = null;
});

describe("the season editor's save", () => {
  /* The write replaces the season whole: a field the editor left alone and the save dropped would reset in silence. */
  it("sends its changes over every stored field, on the version it read, and answers the one the write stored", async () => {
    const answer = await saveSaison({ id: "2027", version: 3, changes: { gruppen: "2", registrierungPaused: false } });

    expect(answer).toEqual({ ok: true, value: 4 });
    expect(stand.sent).toEqual([
      {
        start_date: "2027-03-06",
        end_date: "2027-07-03",
        rules: { ...STORED.rules, number_of_gruppen: 2 },
        bewerbung: { start: "2027-01-10", end: "2027-02-07" },
        registrierung: { end: "2027-03-05", offen: true },
        version: 3,
      } satisfies FLPatchSaisonPayload,
    ]);
  });

  /* A bound moved on the server moves the phrase under the box; one written from the page's own figure would go stale. */
  it("words a rule refusal on its box from the bound the server sends with it", async () => {
    stand.refusal = refusal("rules_gruppen_in_use", [bodyField(["rules", "number_of_gruppen"], "rules_gruppen_in_use", { min: 3 })]);

    const answer = await saveSaison({ id: "2027", version: 3, changes: { gruppen: "2" } });

    expect(answer).toEqual({ ok: false, errorCode: "rules_gruppen_in_use", fieldErrors: { "changes.gruppen": COPY.shared.field.min(3) } });
  });

  it("words the span the matchdays need on the side of the season that falls short", async () => {
    const span = { start: "2027-03-13", end: "2027-06-26" };
    stand.refusal = refusal("saison_span_below_spieltage", [bodyField(["end_date"], "saison_span_below_spieltage", span)]);

    const answer = await saveSaison({ id: "2027", version: 3, changes: { end: "2027-06-01" } });

    expect(answer).toEqual({
      ok: false,
      errorCode: "saison_span_below_spieltage",
      fieldErrors: { "changes.end": COPY.shared.field.earliest("2027-06-26") },
    });
  });
});
