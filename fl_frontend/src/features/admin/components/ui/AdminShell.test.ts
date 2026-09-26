import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness: the harness registers the
   resolver the icon package's bare `./x` imports need as it evaluates, and a static import resolves first. */
const { AdminShell } = await import("./AdminShell.tsx");
const { ADMIN_SHELL_FALLBACK, ADMIN_SIDEMENU_STRUCTURE } = await import("../../constants.ts");

/** The shell as the admin layout mounts it at one address, with nothing but a marker in its page slot. */
const shellAt = (pathname: string): string =>
  renderTree(underNext(h(AdminShell, { saisonMetadataDisplay: null, children: h("p", null, "Seiteninhalt") }), { pathname }));

/** The page's one heading, which is what a screen reader lands on first and what WCAG 2.4.6 judges. */
function heading(html: string): string {
  const found = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)];
  assert.equal(found.length, 1, `the shell renders ${String(found.length)} h1 elements`);

  return textOf(found[0]?.[1] ?? "", " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every label a nav entry carries, so no case below can pass by naming a section the menu does. */
const LISTED = ADMIN_SIDEMENU_STRUCTURE.flatMap((group) => group.sub_options.map((option) => option.label));

describe("the heading the admin shell puts over a page", () => {
  it("names a listed section by its nav entry, a detail route beneath it included", () => {
    assert.equal(heading(shellAt("/bereich/admin/teams")), "Teams");
    assert.equal(heading(shellAt("/bereich/admin/teams/6890a1b2c3d4e5f607190001")), "Teams");
  });

  /* A heading names itself from its contents, so a hint inside it is read out as part of the page's name. */
  it("renders the page's hint beside the heading rather than inside it", () => {
    const [, inside = "", after = ""] = /<h1[^>]*>([\s\S]*?)<\/h1>([\s\S]*)/.exec(shellAt("/bereich/admin/teams")) ?? [];

    // Booleans rather than a match over `after`: a failing match prints the whole rendered page.
    assert.ok(!/<button|role="button"/.test(inside), "the heading holds a control");
    assert.ok(
      /^<[a-z]+ [^>]*role="button"[^>]*aria-label="Was auf „Teams“ zu finden ist"/.test(after),
      "the hint's control does not follow the heading",
    );
  });

  /* The match editor has a route and no nav entry, there being no fixture index to link to. */
  it("names the match editor, which no nav entry lists", () => {
    assert.equal(heading(shellAt("/bereich/admin/spiele/6890a1b2c3d4e5f607190001")), "Spiele");
  });

  /* The catch-all's 404. Headed as a section, the page tells a screen reader it is somewhere it is not. */
  it("names no section over an address that belongs to none", () => {
    const html = shellAt("/bereich/admin/zorbanax");
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
    assert.equal(heading(shellAt("/bereich/admin/constructor")), heading(shellAt("/bereich/admin/zorbanax")));
  });
});
