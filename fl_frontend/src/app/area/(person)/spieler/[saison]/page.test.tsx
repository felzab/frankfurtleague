// @vitest-environment jsdom
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import SpielerOverviewPage, { generateMetadata } from "./page";

import type { FLSpielerSaisonSelfResponse, FLSpielerSaisonSelfSpiel } from "@/core/generated/client/types";
import type { ComponentProps } from "react";

vi.mock("next/link", async (original) => ({
  ...(await original<object>()),
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/area/spieler/2027", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/features/roles/resolvers", () => ({
  requireRole: async () => ({}),
  readAsRoleHolder: <Read,>(_kind: string, read: () => Promise<Read>) => read(),
}));
vi.mock("@/features/roles/queries", () => ({
  readOwnSaisons: async () => ({ entries: [{ id: "2027", span: "" }], standard: "2027" }),
}));

// The public frame's read, cached for every visitor, which a unit render has no cache for.
vi.mock("@/features/saisons/queries", () => ({ getSaisonFrame: async () => ({ saisons: [{ id: "2027" }] }) }));

const own = vi.hoisted(() => ({ read: null as FLSpielerSaisonSelfResponse | null }));
vi.mock("@/features/spieler/queries", () => ({ getSpielerSaisonSelf: async () => own.read }));

const SPIEL: FLSpielerSaisonSelfSpiel = {
  ansetzung_confirmed: true,
  count_spieltage_in_phase: 3,
  date: "2027-03-13",
  elfmeterschiessen: null,
  ergebnis: null,
  for_third_place: false,
  id: "64b000000000000000000001",
  note: null,
  saison_id: "2027",
  saison_phase: "gruppenphase",
  schiedsrichter: null,
  sonderereignis: null,
  spiel_nr: 1,
  spielort: null,
  spieltag_id: "64b000000000000000000002",
  spieltag_position: 1,
  starts: true,
  team1: { team_id: "64b000000000000000000003", name: "Ahorn", shorthand: "AHO", tore: null, austritt_type: null },
  team1_quelle: null,
  team2: { team_id: "64b000000000000000000004", name: "Kastanie", shorthand: "KAS", tore: null, austritt_type: null },
  team2_quelle: null,
  time: "18:00",
};

/** The page as it lands for a pupil whose squad row of 2027 was deregistered on `inactive_since`. */
async function landed(inactive_since: string | null, spiel: FLSpielerSaisonSelfSpiel = SPIEL) {
  own.read = {
    saison_id: "2027",
    kader: {
      inactive_since,
      is_nachnominiert: false,
      nummer: "9",
      position: "Angriff",
      rolle: null,
      saison_id: "2027",
      stufe: "Q2",
      team_id: "64b000000000000000000003",
      team_name: "Ahorn",
    },
    spiele: [spiel],
  };
  const { prelude } = await prerender(
    <SpielerOverviewPage
      params={Promise.resolve({ saison: "2027" })}
      searchParams={Promise.resolve({})}
    />,
    {
      progressiveChunkSize: Number.MAX_SAFE_INTEGER,
    },
  );
  const page = document.createElement("div");
  page.innerHTML = await new Response(prelude).text();
  return page.querySelector("main")?.textContent ?? "";
}

describe("a pupil's own season", () => {
  // The read still names a deregistered pupil in their club's stored line-ups; the page shows them in none.
  it("shows a deregistered pupil their exit after the club and no place in a line-up", async () => {
    const page = await landed("2027-03-01");
    expect(page).toContain(COPY.admin.spieler.deregistered);
    expect(page).not.toContain(COPY.area.spieler.lineupPlace.starts);
  });

  it("shows a pupil in the squad their place in the line-up", async () => {
    const page = await landed(null);
    expect(page).not.toContain(COPY.admin.spieler.deregistered);
    expect(page).toContain(COPY.area.spieler.lineupPlace.starts);
  });

  // The harm: a tab reading „Übersicht“ over the not-found card, which a season whose read holds no squad row of the
  // pupil's draws; the tab is what a browser's tab list and a screen reader announce of the page.
  it("titles the tab not found where the page's own read finds no squad row", async () => {
    own.read = { saison_id: "2027", kader: null, spiele: [] };
    const metadata = await generateMetadata(
      { params: Promise.resolve({ saison: "2027" }), searchParams: Promise.resolve({}) },
      Promise.resolve({}) as never,
    );

    expect(metadata.title).toBe(SERVER_COPY.notFound);
  });
});
