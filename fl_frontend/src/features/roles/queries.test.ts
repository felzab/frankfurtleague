import { person } from "@/test-support/subjectFixtures.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FLOwnSaisonsResponse, FLSaisonFrameResponse } from "@/core/generated/client/types.ts";
import type { SubjectSession } from "@/core/subject.ts";

const SAISONS = {
  "2027": { id: "2027", start_date: "2026-09-01", end_date: "2027-07-31" },
  "2026": { id: "2026", start_date: "2025-09-01", end_date: "2026-07-31" },
  "2025": { id: "2025", start_date: "2024-09-01", end_date: "2025-07-31" },
} as const;

/** What the backend holds for the case: the signed-in person, their own seasons and the season the site is on. */
const held = vi.hoisted(() => ({
  subject: null as SubjectSession | null,
  own: [] as FLOwnSaisonsResponse["saisons"],
  running: null as string | null,
}));

vi.mock("@/core/subject", () => ({ getSubjectSession: () => Promise.resolve(held.subject) }));
// The trace and the actor a person's read runs under are its own module's and its own test's.
vi.mock("@/shared/utils/personRead", () => ({ runPersonRead: <Read>(read: () => Promise<Read>) => read() }));
vi.mock("@/features/saisons/queries", () => ({
  getSaisonFrame: () => Promise.resolve({ saisons: [], active_saison_id: held.running } satisfies FLSaisonFrameResponse),
}));
vi.mock("@/core/generated/client/sdk", () => {
  const read = () => Promise.resolve({ saisons: held.own } satisfies FLOwnSaisonsResponse);
  return { spielerGetSelfSaisons: read, schiedsrichterGetSelfSaisons: read };
});

const { getOwnSaisons } = await import("./queries.ts");

const REFEREE = person({ schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250021" }] });

beforeEach(() => {
  held.subject = REFEREE;
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
