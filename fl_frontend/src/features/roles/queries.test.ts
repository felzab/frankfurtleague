import { serveBackend } from "@/test-support/backend.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { beforeEach, describe, expect, it } from "vitest";

import type { FLOwnSaisonsResponse, FLSaisonFrameResponse } from "@/core/generated/client/types.ts";

const SAISONS = {
  "2027": { id: "2027", start_date: "2026-09-01", end_date: "2027-07-31" },
  "2026": { id: "2026", start_date: "2025-09-01", end_date: "2026-07-31" },
  "2025": { id: "2025", start_date: "2024-09-01", end_date: "2025-07-31" },
} as const;

/** What the backend holds for the case: the referee's own seasons and the season the site is on. */
const held = { own: [] as FLOwnSaisonsResponse["saisons"], running: null as string | null };

// The two reads the frame's seasons make, each answered only at its own method and path: the referee's own seasons,
// and the public frame naming the season the site is on.
serveBackend(({ method, path }) => {
  if (method !== "GET") return undefined;
  if (path === "/schiedsrichter/self/saisons") return { saisons: held.own } satisfies FLOwnSaisonsResponse;
  return path === "/saisons/frame" ? ({ saisons: [], active_saison_id: held.running } satisfies FLSaisonFrameResponse) : undefined;
});
// A referee's session: the real subject read, the real person's read and the real frame read run beneath the query.
signedInRequest({ email: "pia@example.org", records: { schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250021" }] } });

const { getOwnSaisons } = await import("./queries.ts");

beforeEach(() => {
  held.own = [SAISONS["2027"], SAISONS["2026"], SAISONS["2025"]];
  held.running = "2026";
});

describe("the seasons a referee's frame offers", () => {
  // The newest is often a season still planned: opening on it shows a referee an empty list while this season's
  // fixtures wait one switch away.
  it("open on the season the site is on where the referee has fixtures in it", async () => {
    expect((await getOwnSaisons("schiedsrichter"))?.standard).toBe("2026");
  });

  it("open on the referee's newest season where they have none in the season the site is on", async () => {
    held.own = [SAISONS["2027"], SAISONS["2025"]];

    expect((await getOwnSaisons("schiedsrichter"))?.standard).toBe("2027");
  });
});
