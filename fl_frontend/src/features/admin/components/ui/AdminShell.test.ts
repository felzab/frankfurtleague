import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries any of the three — `usePathname` reads the first, the nav's links and the
   bar's controls the other two. A Next release that moves one fails this file at import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the harness registers the
   resolver the icon package's bare `./x` imports need as it evaluates, and a static import resolves first. */
const { AdminShell } = await import("./AdminShell.tsx");
const { ADMIN_SHELL_FALLBACK, ADMIN_SIDEMENU_STRUCTURE } = await import("../../constants.ts");

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** The shell as the admin layout mounts it at one address, with nothing but a marker in its page slot. */
const shellAt = (pathname: string): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        PathnameContext.Provider,
        { value: pathname },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams("") },
          h(AdminShell, { saisonMetadataDisplay: null, children: h("p", null, "Seiteninhalt") }),
        ),
      ),
    ),
  );

/** The page's one heading, which is what a screen reader lands on first and what WCAG 2.4.6 judges. */
function heading(html: string): string {
  const found = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)];
  assert.equal(found.length, 1, `the shell renders ${String(found.length)} h1 elements`);

  // The hint's glyph sits inside the heading and is named „Hinweis zu …“, which is not the heading's text.
  return textOf((found[0]?.[1] ?? "").replace(/<button[\s\S]*?<\/button>/g, ""), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every label a nav entry carries, so no case below can pass by naming a section the menu does. */
const LISTED = ADMIN_SIDEMENU_STRUCTURE.flatMap((group) => group.sub_options.map((option) => option.label));

describe("the heading the admin shell puts over a page", () => {
  it("names a listed section by its nav entry, a detail route beneath it included", () => {
    assert.equal(heading(shellAt("/admin/teams")), "Teams");
    assert.equal(heading(shellAt("/admin/teams/6890a1b2c3d4e5f607190001")), "Teams");
  });

  /* The match editor has a route and no nav entry, there being no fixture index to link to. */
  it("names the match editor, which no nav entry lists", () => {
    assert.equal(heading(shellAt("/admin/spiele/6890a1b2c3d4e5f607190001")), "Spiele");
  });

  /* The catch-all's 404. Headed as a section, the page tells a screen reader it is somewhere it is not. */
  it("names no section over an address that belongs to none", () => {
    const html = shellAt("/admin/zorbanax");
    const title = heading(html);

    // First: an empty heading passes every absence below.
    assert.notEqual(title, "", "the page is headed with nothing");
    assert.notEqual(title, "Spiele", "an unknown address is headed as the match editor");
    assert.ok(!LISTED.includes(title), `an unknown address is headed as the listed section „${title}“`);
    assert.equal(title, ADMIN_SHELL_FALLBACK.label, "an unknown address is headed with something other than the area's name");
    assert.ok(html.includes("Seiteninhalt"), "the shell does not render the page it heads");
  });

  /* The segment is the address bar's, so a name `Object.prototype` holds must not select a member. */
  it("heads a prototype member's name as the unknown address it is", () => {
    assert.equal(heading(shellAt("/admin/constructor")), heading(shellAt("/admin/zorbanax")));
  });
});
