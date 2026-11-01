import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk.ts";
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";

import { RAIL_GROUPS } from "./VerwaltungFrame";

const APP = path.resolve(import.meta.dirname, "..", "..");
const VERWALTUNG = import.meta.dirname;

const shown = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");

// The phone's band and bar are a route group's, not the page's: a page in neither group is drawn with no band,
// and an editor in the lists' group with the logo and the bottom bar, its way back gone. Neither fails anything
// else, so the tree is held here.
describe("the administration's route groups", () => {
  it("hold every page, an editor's in `(editor)` and every other in `(liste)`", () => {
    const pages = filesUnder(VERWALTUNG, (name) => name === "page.tsx", 2).map((file) => shown(VERWALTUNG, file));
    expect(pages.filter((page) => !page.startsWith("(editor)/") && !page.startsWith("(liste)/"))).toStrictEqual([]);
  });

  // An editor's „Zurück“ leads to the rail entry its address lies under (`EditorBack`), so an editor under
  // none is drawn with no way back and nothing fails.
  it("place every editor under a rail entry, its way back", () => {
    // An address as its segments, any dynamic one as `[]`, so a page's folder and a route's placeholder match.
    const segments = (address: string) =>
      address
        .split("/")
        .filter((segment) => segment !== "" && !/^\(.+\)$/.test(segment))
        .map((segment) => (segment.startsWith("[") ? "[]" : segment));
    const entries = RAIL_GROUPS.flatMap((group) => group.entries).map((entry) =>
      segments(entry.saison === undefined ? entry.href : ROUTES[entry.saison].path("[saison]")),
    );
    const editors = filesUnder(path.join(VERWALTUNG, "(editor)"), (name) => name === "page.tsx", 1).map((file) =>
      shown(APP, path.dirname(file)),
    );
    const lost = editors.filter((editor) => !entries.some((entry) => entry.every((segment, at) => segments(editor)[at] === segment)));
    expect(lost).toStrictEqual([]);
  });
});
