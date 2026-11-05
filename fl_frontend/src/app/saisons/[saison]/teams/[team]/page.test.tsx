import { describe, expect, it, vi } from "vitest";

import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import { generateMetadata } from "./page";

import type { ResolvingMetadata } from "next";

/** Each club id the read was asked for, so a case can tell that none was. */
const read = vi.hoisted(() => ({ teams: [] as string[] }));

vi.mock("@/features/saisons/queries", () => ({
  getSaisonFrame: async () => ({ saisons: [{ id: "2027" }], active_saison_id: "2027" }),
  getTeamPage: async (_saison: string, team: string) => {
    read.teams.push(team);
    return null;
  },
}));

describe("the club page's server render", () => {
  // The backend answers a malformed id as a route it does not know, which the read takes for a failure: the page
  // would show the error page, and every such address would key a cache entry of its own.
  it("answers a malformed club id as not-found before any read", async () => {
    const metadata = generateMetadata(
      { params: Promise.resolve({ saison: "2027", team: "not-an-id" }), searchParams: Promise.resolve({}) },
      Promise.resolve({}) as unknown as ResolvingMetadata,
    );

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(metadata).resolves.toBe(NOT_FOUND_METADATA);
    expect(read.teams).toStrictEqual([]);
  });
});
