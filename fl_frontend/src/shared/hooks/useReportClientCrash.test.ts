// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useReportClientCrash } from "./useReportClientCrash.ts";

const { POST } = await import("@/app/api/client-error/route.ts");
const { NextRequest } = await import("next/server");

afterEach(() => void vi.restoreAllMocks());

// The route refuses an empty message, and a refused report is a crash recorded nowhere: `throw new Error()` and a
// thrown empty string each reach the boundary with one. The route's own test holds what it logs once it accepts.
it("reports a crash with an empty message as one the route accepts", async () => {
  const sent = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
  renderHook(() => useReportClientCrash(new Error("")));
  const body = sent.mock.calls[0]?.[1]?.body;

  const report = new NextRequest("http://localhost/api/client-error", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: typeof body === "string" ? body : null,
  });

  expect((await POST(report)).status).toBe(204);
});
