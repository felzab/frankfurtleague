import { doubleApiClient, requestsOf } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FLSaisonRules } from "@/core/generated/client/types";

/** The rules the newest season holds, which no starting value of the create's own matches. */
const NEWEST_RULES: FLSaisonRules = {
  win_points: 2,
  draw_points: 1,
  qualifiers_per_gruppe: 1,
  number_of_gruppen: 4,
  teams_per_gruppe: 4,
  tiebreak_order: "direkter_vergleich",
  max_kadergroesse: 22,
  forfeit_ergebnis: { sieger_tore: 2, verlierer_tore: 0 },
  allowed_stufen: ["Q1", "Q2"],
};

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a create clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

// The backend client itself is replaced, so the list read and the create run through the real generated calls.
const calls = doubleApiClient(({ method }) =>
  method === "POST" ? { created_id: "2029" } : { saisons: [{ id: "2028", rules: NEWEST_RULES }] },
);

const { createSaison } = await import("./createSaison");

const posted = () => {
  const formData = new FormData();
  formData.set("id", "2029");
  formData.set("start_date", "2029-03-03");
  formData.set("end_date", "2029-06-30");
  return formData;
};

beforeEach(() => {
  calls.length = 0;
});

describe("the season create", () => {
  /* A list read on its default order would hand a new season an older season's rules, and nothing on screen says so. */
  it("carries on the rules of the season the list names newest, by the order it asks for", async () => {
    expect(await createSaison(posted())).toStrictEqual({ ok: true, value: undefined });

    const [read, write] = requestsOf(calls);
    expect(new URL(read?.endpoint ?? "", "http://backend").searchParams.toString()).toBe("sort_by=_id&order=desc&limit=1");
    expect(write?.body).toStrictEqual({
      id: "2029",
      start_date: "2029-03-03",
      end_date: "2029-06-30",
      rules: NEWEST_RULES,
      bewerbung: null,
      registrierung: null,
    });
  });
});
