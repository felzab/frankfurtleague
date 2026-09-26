import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the harness registers the
   resolver the icon package's bare `./x` imports need as it evaluates, and a static import resolves first. */
const { DashboardShell } = await import("./DashboardShell.tsx");
const { DASHBOARD_SIDEMENU_STRUCTURE } = await import("../../constants.ts");
const { ShellNotFound } = await import("@/shared/components/ui/ShellNotFound.tsx");

const ENTRIES = DASHBOARD_SIDEMENU_STRUCTURE.flatMap((group) => group.sub_options).length;

describe("the season the dashboard shell links under", () => {
  /* Every dashboard page reads its season off the live url, so an entry or a 404's way out dropping it
     returns the whole shell to the running season (`fl_frontend/src/shared/utils/saisonHref.ts`). */
  it("carries the season onto every entry and onto its 404's way out", () => {
    const html = renderTree(
      underNext(
        h(DashboardShell, {
          saisonMetadataDisplay: null,
          children: h(ShellNotFound, { message: "Probe.", href: "/dashboard/probe", linkLabel: "Probe" }),
        }),
        { pathname: "/dashboard/zorbanax", search: "saison_id=2526" },
      ),
    );
    const hrefs = [...html.matchAll(/href="(\/dashboard\/[^"]*)"/g)].map((hit) => hit[1]!);

    assert.ok(hrefs.includes("/dashboard/probe?saison_id=2526"), "the 404's way out drops the season");
    assert.equal(hrefs.length, ENTRIES + 1, `the shell links ${String(hrefs.length)} dashboard addresses for its entries and one way out`);
    assert.deepEqual(
      hrefs.filter((href) => !href.endsWith("?saison_id=2526")),
      [],
      "these dashboard links drop the season",
    );
  });
});
