// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ReadPage } from "./ReadPage";

import type { ComponentProps } from "react";
import type { ReadContent, ReadWait } from "./ReadPage";

// The strip's own links and the rail's toggle, which need no router to be read.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/area/spieler/2027", useRouter: () => ({ replace: vi.fn() }) }));

const TILES = [
  { label: COPY.shared.facts.team, value: { record: "Ahorn" }, words: true },
  { label: COPY.admin.spieler.nummer, value: { record: "9" } },
  { label: COPY.admin.spieler.position, value: { record: "Angriff" }, words: true },
  { label: COPY.admin.spieler.stufe, value: { record: "Q2" }, words: true },
] as const;

/** A club's match against `opponent`, numbered `n`. */
const spiel = (n: number, opponent: string) => ({
  id: `64b00000000000000000000${String(n)}`,
  href: `/saisons/2027/spiele/64b00000000000000000000${String(n)}` as const,
  when: COPY.spielplan.when("2027-03-13", "18:00"),
  team1: { name: { record: "Ahorn" }, plaque: { record: "AHO" } },
  team2: { name: { record: opponent }, plaque: { record: opponent.slice(0, 3).toUpperCase() } },
});

const WAIT: ReadWait = {
  groups: [
    { kind: "tiles", layout: "four", line: false },
    { title: COPY.page.spiele, kind: "spiele", count: 2 },
  ],
};

/** A pupil's page as a browser holds it while its one read runs, and once the read has landed. */
async function drawn(content: ReadContent) {
  const page = (record: Promise<ReadContent>) => (
    <ReadPage
      scope="area"
      title={{ route: "spielerOverview" }}
      width="content"
      wait={WAIT}
      record={record}
    />
  );
  const waiting = document.createElement("div");
  waiting.innerHTML = renderToString(page(new Promise(() => undefined)));

  const { prelude } = await prerender(
    page(Promise.resolve(content)),
    // Every boundary in its place, where React would otherwise leave it for a script no parsed page runs.
    { progressiveChunkSize: Number.MAX_SAFE_INTEGER },
  );
  const landed = document.createElement("div");
  landed.innerHTML = await new Response(prelude).text();
  return { waiting, landed };
}

const filled = (spiele: ReadContent["groups"][number]) => ({
  groups: [{ kind: "tiles", tiles: { layout: "four", items: TILES } }, spiele] as const,
});

describe("a read page naming itself before its read", () => {
  it("draws its title in the strip at once, with no bar in its place", async () => {
    const { waiting } = await drawn(filled({ kind: "spiele", spiele: [], empty: { kind: "none", plural: COPY.page.spiele } }));
    expect(waiting.querySelector("h1")?.textContent).toBe(COPY.shared.overview);
    expect(waiting.querySelector("header [aria-busy]")).toBe(null);
  });
});

describe("matches under their matchdays", () => {
  const MATCHDAYS = [COPY.shared.spieltag(1), COPY.shared.spieltag(2)] as const;

  it("heads each match's card with its matchday, ahead of the match's row", async () => {
    const { landed } = await drawn(
      filled({
        title: COPY.page.spiele,
        kind: "spiele",
        spiele: [
          { head: MATCHDAYS[0], spiel: spiel(1, "Kastanie") },
          { head: MATCHDAYS[1], spiel: spiel(2, "Ulme") },
        ],
        empty: { kind: "none", plural: COPY.page.spiele },
      }),
    );
    const heads = [...landed.querySelectorAll("main h3")];
    expect(heads.map((head) => head.textContent)).toStrictEqual(MATCHDAYS);
    heads.forEach((head, index) => {
      const row = head.parentElement?.querySelector("a");
      expect(row?.getAttribute("href")).toBe(spiel(index + 1, "").href);
      expect(row?.textContent).not.toContain(MATCHDAYS[index]);
    });
  });

  it("says there are none yet in the list's place", async () => {
    const { landed } = await drawn(
      filled({ title: COPY.page.spiele, kind: "spiele", spiele: [], empty: { kind: "none", plural: COPY.page.spiele } }),
    );
    expect(landed.querySelector("main")?.textContent).toContain(COPY.shared.empty.none(COPY.page.spiele));
    expect(landed.querySelector("main h3")).toBe(null);
  });

  // The wait stands as the page lands: as many cards as it states, and tiles with no line where none carries one.
  it("waits with as many cards as it states, each a head over a row, and tiles of a label and a value", async () => {
    const { waiting } = await drawn(filled({ kind: "spiele", spiele: [], empty: { kind: "none", plural: COPY.page.spiele } }));
    const wait = waiting.querySelector("main [aria-busy]");
    const cards = wait?.querySelectorAll("[class~='lg:grid-cols-2'] > *");
    expect(cards).toHaveLength(2);
    const tile = wait?.querySelector("[class~='lg:grid-cols-4'] > *");
    expect(tile?.children).toHaveLength(2);
  });
});
