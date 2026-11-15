import { serveBackend } from "@/test-support/backend.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { describe, expect, it } from "vitest";

const backend = serveBackend(() => ({}));
// An administrator's session: the read runs behind the real admin check, and only what it sends is judged.
signedInRequest();

const { getBewerbungById } = await import("./queries.ts");

const ONE_ID = "0123456789abcdef01234567";

describe("the one path segment a caller interpolates", () => {
  /* `fl_frontend/src/core/api.ts :: isPathAsSpelled` cannot see an id carrying a plain `/`: it
     survives parsing untouched and reads as a nested endpoint, so the generated path builder
     percent-encodes it before the client sees it. */
  it("encodes the id rather than letting it open a path segment", async () => {
    await getBewerbungById(`${ONE_ID}/../teams`);

    expect(backend.sent.at(-1)?.path).toBe(`/bewerbungen/${ONE_ID}%2F..%2Fteams`);
  });
});
