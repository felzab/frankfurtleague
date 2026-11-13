import { serveBackend } from "@/test-support/backend.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { describe, expect, it, vi } from "vitest";

/** Every request the backend was sent, with the key it carried, cumulative across this file. */
const reads: { path: string; authorization: string | null }[] = [];
serveBackend(({ path, headers }) => {
  reads.push({ path, authorization: headers.get("authorization") });
  return { saison: { id: "2627" } };
});
// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
signedInRequest();

/** Every cache declaration a read made, which the request's own double answers by recording nothing. */
const declared: string[] = [];
// Registered after the request's doubles, so its `next/cache` answers before theirs.
vi.doMock("next/cache", () => ({ cacheTag: () => void declared.push("cacheTag"), cacheLife: () => void declared.push("cacheLife") }));

const { getAdminSaison, getAdminSaisons } = await import("./queries.ts");
const { internalApiKeyAdmin } = await import("@/core/config.ts");

/** The key tier a request went out on, read off its key: the config double gives each tier a key of its own. */
const tierOf = (authorization: string | null): string =>
  authorization === `Bearer ${internalApiKeyAdmin()}` ? "admin" : String(authorization);

describe("the admin season list's read", () => {
  /* Kept past one request, the list would serve every administrator the first request's seasons, `next_saison_id`
     and create refusal until the server restarts, and no journey creates a season to notice. */
  it("is read on the admin tier every time, declaring no cache", async () => {
    const before = reads.length;

    await getAdminSaisons();
    await getAdminSaisons();

    expect(reads.slice(before).map(({ path, authorization }) => [path, tierOf(authorization)])).toStrictEqual([
      ["/saisons/list/admin", "admin"],
      ["/saisons/list/admin", "admin"],
    ]);
    expect(declared, "the administrators' season list is declared into a cache every caller shares").toStrictEqual([]);
  });
});

describe("the season editor's read", () => {
  /* Cached, the read would key on the season id alone: every administrator would share one slot, and a version from
     before another administrator's save would refuse every save as stale. */
  it("is read on the admin tier every time, declaring no cache", async () => {
    const before = reads.length;

    await getAdminSaison("2627");
    await getAdminSaison("2627");

    expect(reads.slice(before).map(({ path, authorization }) => [path, tierOf(authorization)])).toStrictEqual([
      ["/saisons/2627/admin", "admin"],
      ["/saisons/2627/admin", "admin"],
    ]);
    expect(declared, "the administrator's read is declared into a cache every caller shares").toStrictEqual([]);
  });
});
