import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { austrittZustand } from "@/features/teams/constants";

import TeamPage from "./page";

import type { FLAustritt, FLTeamPageResponse } from "@/core/generated/client/types";
import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

/** The club's page as the read serves it, with no match, no squad and no standing, its exit as a case gives it. */
const page = (austritt: FLAustritt | null): FLTeamPageResponse => ({
  team: {
    id: "0".repeat(24),
    name: "Ernst-Reuter-Schule",
    shorthand: "ERS",
    full_name: "Ernst-Reuter-Schule Frankfurt",
    schulform: null,
    gruppe: "A",
    description: "",
    website_url: null,
    address: { strasse: "Hammarskjöldring", hausnummer: "17a", plz: "60439", stadt: "Frankfurt", stadtteil: "" },
    austritt,
  },
  spiele: [],
  kader: [],
  standing: null,
});

const read = vi.hoisted(() => ({ page: null as FLTeamPageResponse | null }));

vi.mock("@/features/saisons/queries", () => ({ getTeamPage: async () => read.page }));

/** The page's whole server render, the document a browser shows before hydrating. */
async function rendered(served: FLTeamPageResponse) {
  read.page = served;
  const stream = await renderToReadableStream(
    <TeamPage
      params={Promise.resolve({ saison: "2027", team: served.team.id })}
      searchParams={Promise.resolve({})}
    />,
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("the club page's server render", () => {
  // The record as served, either route out of the season: the note states the exit, its day and its reason as written.
  it("states the club's exit from the season under its head, from the record the read serves", async () => {
    for (const austritt of [
      { type: "rueckzug", datum: "2027-03-20", grund: "Zu wenige Spieler" },
      { type: "disqualifikation", datum: "2027-04-02", grund: "Nicht angetreten" },
    ] as const) {
      const html = await rendered(page(austritt));
      expect(html, austritt.type).toContain(COPY.shared.austrittSeit(austrittZustand(austritt.type), austritt.datum));
      expect(html, austritt.type).toContain(austritt.grund);
    }
  });

  it("states no exit for a club still in the season", async () => {
    const html = await rendered(page(null));
    for (const type of ["rueckzug", "disqualifikation"] as const) expect(html).not.toContain(austrittZustand(type));
  });
});
