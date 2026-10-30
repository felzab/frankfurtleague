import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk.ts";
import { describe, expect, it } from "vitest";

import { ROUTES } from "./routes.ts";

const APP = path.resolve(import.meta.dirname, "..", "app");

/** The address each page file answers at: its folders below `app`, a route group's folder left out. */
const PAGES = new Set(
  filesUnder(APP, (name) => name === "page.tsx", 20).map((file) => {
    const folders = path.relative(APP, path.dirname(file)).split(path.sep);
    return `/${folders.filter((folder) => folder !== "" && !/^\(.*\)$/.test(folder)).join("/")}`;
  }),
);

describe("the links every rail frame writes", () => {
  // The rail's foot signed out, and the strip's and „Mehr“'s two legal pages.
  it.each(["signIn", "legalNotice", "privacyNotice"] as const)("lead to a page answering at the %s row's address", (row) => {
    expect(PAGES.has(ROUTES[row].path())).toBe(true);
  });
});
