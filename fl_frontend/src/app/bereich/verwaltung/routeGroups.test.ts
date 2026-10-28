import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder, isTestFile } from "@/test-support/treeWalk.ts";
import { describe, expect, it } from "vitest";

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

  it("place the editor template inside an editors' group alone", () => {
    const sources = filesUnder(APP, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 50);
    const outside = sources
      .filter((file) => readFileSync(file, "utf8").includes('from "@/kit/EditorPage"'))
      .map((file) => shown(APP, file))
      .filter((file) => !file.split("/").includes("(editor)"));
    expect(outside).toStrictEqual([]);
  });
});
