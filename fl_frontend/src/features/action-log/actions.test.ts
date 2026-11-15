import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import { logParams } from "./filters";

import type { FLActionLogListResponse } from "@/core/generated/client/types";

// The log's read alone is answered, with an empty last page, so the real guard, query, generated call and dispatch
// run, and any other request fails the case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/action_log/view"
    ? ({ action_log: [], by_options: [], cursor: null } satisfies FLActionLogListResponse)
    : undefined,
);
// An administrator's session, made by passkey, which the act's guard admits.
signedInRequest();

const { loadActionLog } = await import("./actions");

describe("the Protokoll's next page", () => {
  /* A page read past the filters runs on with rows the list above it left out, and only a long enough log shows it. */
  it("reads inside the filters the page carried", async () => {
    const carried = { by: "system", type: "ban", time: "30-days" } as const;
    const cursor = "a".repeat(24);

    expect(await loadActionLog({ ...carried, query: "Birke", cursor })).toStrictEqual({ ok: true, value: { rows: [], cursor: null } });

    expect(backend.sent.map(({ body }) => body)).toStrictEqual([{ ...logParams(carried), q: "Birke", cursor }]);
  });
});
