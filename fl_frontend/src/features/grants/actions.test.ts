import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

import type { Code } from "@/core/generated/client/types";

const OWNER = "owner@example.org";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({
  judgeAdminRequest: async () => {
    (await import("@/core/requestScope")).setRequestActor({ email: OWNER, lane: "admin", authTime: 0, factor: "passkey" });
    return { session: {} };
  },
  passesPasskeyTouch: async () => true,
}));

/** What the doubled client throws next, and how many calls reached it. */
const state = vi.hoisted(() => ({ refusal: null as unknown, sent: 0 }));

doubleApiClient(() => {
  state.sent += 1;
  if (state.refusal !== null) throw state.refusal;
  return { grant_id: "64b000000000000000000002" };
});

const { addAdministrator } = await import("./actions");

/** The refusal the client raises, naming the box it judged. */
const refusal = (serverErrorCode: Code, path: readonly string[] = []) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/",
    statusCode: 409,
    serverErrorCode,
    endpoint: "/",
    traceId: "0",
    refusedFields: path.length === 0 ? [] : [{ path: [...path], kind: serverErrorCode, ctx: {}, in: "body" }],
  });

const add = (email: string) => addAdministrator({ email, holder: OWNER });

beforeEach(() => {
  state.refusal = null;
  state.sent = 0;
});

describe("adding an administrator", () => {
  /* The API takes every atext character and the sign-in library does not, so the grant would stand and admit nobody. */
  it("refuses an address the sign-in library refuses, reaching no backend", async () => {
    expect(await add("a~b@example.de")).toStrictEqual({
      ok: false,
      fieldErrors: { email: COPY.shared.field.format(COPY.shared.field.exampleAddress) },
    });
    expect(state.sent).toBe(0);
  });

  it("says a held address on its box", async () => {
    state.refusal = refusal("grant_exists", ["email"]);

    expect(await add("neu@example.org")).toStrictEqual({
      ok: false,
      errorCode: "grant_exists",
      fieldErrors: { email: SERVER_COPY.refusal.grant_exists },
    });
  });

  it("says a banned address on the status line", async () => {
    state.refusal = refusal("grant_barred");

    expect(await add("neu@example.org")).toStrictEqual({
      ok: false,
      errorCode: "grant_barred",
      reason: SERVER_COPY.refusalLine.grant_barred,
    });
  });
});
