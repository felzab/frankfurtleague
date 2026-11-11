import { NEXT_HEADERS_DOUBLE } from "@/test-support/actionDoubles.ts";
import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { describe, expect, it, vi } from "vitest";

import type * as AdminRead from "@/shared/utils/adminRead.ts";

// The admin check is the pass's collaborator, never its subject: each read runs as an admitted
// administrator's, and only what it sends is judged. Doubled where `queries.ts`
// imports it, so nothing on the path loads the sign-in store.
vi.doMock("@/shared/utils/adminRead.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminRead>()),
  runAdminRead: <T>(read: () => Promise<T>): Promise<T> => read(),
}));
// The public reads forward the visitor's headers, which Next answers only inside a request it serves.
vi.doMock("next/headers", () => NEXT_HEADERS_DOUBLE);

const calls = doubleApiClient(() => ({}));

const { getBewerbungById } = await import("./queries.ts");

const ONE_ID = "0123456789abcdef01234567";

describe("the one path segment a caller interpolates", () => {
  /* `fl_frontend/src/core/api.ts :: isPathAsSpelled` cannot see an id carrying a plain `/`: it
     survives parsing untouched and reads as a nested endpoint, so the generated path builder
     percent-encodes it before the client sees it. */
  it("encodes the id rather than letting it open a path segment", async () => {
    await getBewerbungById(`${ONE_ID}/../teams`);

    expect(calls.at(-1)?.endpoint).toBe(`/bewerbungen/${ONE_ID}%2F..%2Fteams`);
  });
});
