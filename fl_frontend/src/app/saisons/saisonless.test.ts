import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { GET as kORunde } from "./ko-runde/route";
import { GET as spielplan } from "./route";
import { GET as spielSearch } from "./search/route";
import { GET as tabelle } from "./tabelle/route";
import { GET as teams } from "./teams/route";

/** The season the site is on, which each case sets. */
const frame = vi.hoisted(() => ({ active_saison_id: null as string | null }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/features/saisons/queries", () => ({ getSaisonFrame: async () => ({ saisons: [], ...frame }) }));

/** Each address naming no season, by the page of the season the site is on it leads to. */
const HANDLERS = [
  { address: ROUTES.saisons.path(), handler: spielplan, page: "spielplan" },
  { address: ROUTES.saisonsKORunde.path(), handler: kORunde, page: "kORunde" },
  { address: ROUTES.saisonsTabelle.path(), handler: tabelle, page: "tabelle" },
  { address: ROUTES.saisonsTeams.path(), handler: teams, page: "teams" },
  { address: ROUTES.saisonsSpielSearch.path(), handler: spielSearch, page: "spielSearch" },
] as const;

/** Where the handler sends the request, as Next's redirect names it in what it throws. */
async function sentTo(handler: () => Promise<never>): Promise<string> {
  const thrown: unknown = await handler().catch((error: unknown) => error);
  const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";
  const [kind, , address] = digest.split(";");
  if (kind !== "NEXT_REDIRECT" || address === undefined) throw thrown;
  return address;
}

// The harm: the handler answers before anything renders, so a wrong address is the page a footer link opens, and a
// throw on a league without a season is an error page where the landing was meant.
describe("an address naming no season", () => {
  it.each(HANDLERS)("$address leads to its page in the season the site is on", async ({ handler, page }) => {
    frame.active_saison_id = "2027";
    expect(await sentTo(handler)).toBe(ROUTES[page].path("2027"));
  });

  it.each(HANDLERS)("$address leads to the landing while the league has no season", async ({ handler }) => {
    frame.active_saison_id = null;
    expect(await sentTo(handler)).toBe(ROUTES.home.path());
  });
});
