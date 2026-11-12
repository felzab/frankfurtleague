import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { GET as spielplan } from "./route";

/** The season the site is on, which each case sets. */
const frame = vi.hoisted(() => ({ active_saison_id: null as string | null }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/features/saisons/queries", () => ({ getSaisonFrame: async () => ({ saisons: [], ...frame }) }));

/** Where the handler sends the request, as Next's redirect names it in what it throws. */
async function sentTo(handler: () => Promise<never>): Promise<string> {
  const thrown: unknown = await handler().catch((error: unknown) => error);
  const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";
  const [kind, , address] = digest.split(";");
  if (kind !== "NEXT_REDIRECT" || address === undefined) throw thrown;
  return address;
}

// The harm: every address naming no season answers through one redirect, and a throw on a league without a season is
// an error page where the landing was meant.
describe("an address naming no season", () => {
  it("leads to the landing while the league has no season", async () => {
    frame.active_saison_id = null;
    expect(await sentTo(spielplan)).toBe(ROUTES.home.path());
  });
});
