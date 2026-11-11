import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { describe, expect, it, vi } from "vitest";

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
const { setSession } = doubleActionRequest();

/** Every cache declaration a read made, which the request's own double answers by recording nothing. */
const declared: string[] = [];
// Registered after the request's doubles, so its `next/cache` answers before theirs.
vi.doMock("next/cache", () => ({ cacheTag: () => void declared.push("cacheTag"), cacheLife: () => void declared.push("cacheLife") }));

// Replaced at the module boundary rather than the season code being reshaped to admit a seam: the
// real client reaches a backend no test process runs, at a base URL no test run holds.
/** Every request the doubled client was asked for, cumulative across this file. */
const reads = doubleApiClient(() => ({ saison: { id: "2627" } }));

const { getAdminSaison } = await import("./queries.ts");

describe("the season editor's read", () => {
  /* Cached, the read would key on the season id alone: every administrator would share one slot, and a version from
     before another administrator's save would refuse every save as stale. */
  it("is read on the admin tier every time, declaring no cache", async () => {
    const before = reads.length;

    await getAdminSaison("2627");
    await getAdminSaison("2627");

    expect(reads.slice(before).map(({ endpoint, authType }) => [endpoint, authType])).toStrictEqual([
      ["/saisons/2627/admin", "admin"],
      ["/saisons/2627/admin", "admin"],
    ]);
    expect(declared, "the administrator's read is declared into a cache every caller shares").toStrictEqual([]);
  });

  /* The admin tier's guard, which the page's layout does not give a page's own read. */
  it("sends nothing for a session holding no administrator", async () => {
    setSession(null);
    const before = reads.length;

    await expect(getAdminSaison("2627")).rejects.toThrow();

    expect(reads.length, "the season was read for a session the guard turns away").toBe(before);
  });
});
