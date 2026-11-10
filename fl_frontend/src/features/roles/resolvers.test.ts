import path from "node:path";

import { refused } from "@/test-support/refusals.ts";
import { person, seat } from "@/test-support/subjectFixtures.ts";
import { filesUnder } from "@/test-support/treeWalk.ts";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes.ts";
import { SERVER_COPY } from "@/core/serverCopy.ts";

import { readAsRoleHolder } from "./resolvers.ts";

// A person holding a seat on one club, at the address of another.
vi.mock("@/core/subject", () => ({ getSubjectSession: () => Promise.resolve(person({ seats: [seat()] })) }));

const TEAM_DIR = path.join(import.meta.dirname, "../../app/area/team");

/** Every team page, each reached at another club's address with every segment of its own named. */
const TEAM_PAGES = filesUnder(TEAM_DIR, (name) => name === "page.tsx", 5).map((file) => {
  const names = path
    .relative(TEAM_DIR, file)
    .split(path.sep)
    .flatMap((segment) => /^\[(.+)\]$/.exec(segment)?.[1] ?? []);
  return {
    file,
    params: Object.fromEntries(names.map((name) => [name, name === "team" ? "6890a1b2c3d4e5f607250099" : "6890a1b2c3d4e5f607250031"])),
  };
});

type Page = { generateMetadata: (props: unknown, parent: unknown) => Promise<{ title?: unknown }> };

// The page's card on such an address is „Kein Zugang“ (`app/area/team/not-found.tsx`), and a tab reading „Seite nicht
// gefunden“ over it still reads as a finished page.
describe("a team page at an address the person holds no seat on", () => {
  it("titles the tab as its card", async () => {
    for (const { file, params } of TEAM_PAGES) {
      const { generateMetadata } = (await import(/* @vite-ignore */ file)) as Page;
      const metadata = await generateMetadata({ params: Promise.resolve(params) }, Promise.resolve({}));

      expect(metadata.title, file).toBe(SERVER_COPY.area.forbidden);
    }
  });
});

// The harm: a pupil or a referee whose Funktion went between the page's check and the backend's meets the error card,
// which says something broke, where every other place of theirs sends them on to the landing.
describe("a person place's read the backend refuses for a Funktion gone", () => {
  it("sends the person on to the landing", async () => {
    const thrown: unknown = await readAsRoleHolder("spieler", () => Promise.reject(refused("role_not_held"))).catch((error: unknown) => error);
    const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";

    expect(digest.split(";").slice(0, 3)).toStrictEqual(["NEXT_REDIRECT", "replace", ROUTES.area.path()]);
  });
});
