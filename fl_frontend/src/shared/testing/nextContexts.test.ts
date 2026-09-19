import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h, useContext } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { nextRouter, recordingRouter, underNext } from "./nextContexts.ts";
import { renderTree } from "./renderTest.ts";

/** The three values a component reads, joined so one render reports all of them. */
function Probe(): ReturnType<typeof h> {
  const router = useContext(AppRouterContext);
  const search = useContext(SearchParamsContext);
  const pathname = useContext(PathnameContext);

  return h("p", null, `${router === null ? "no router" : router.bfcacheId} | ${search?.get("saison_id") ?? "none"} | ${pathname ?? "none"}`);
}

describe("the router a test mounts", () => {
  it("answers every member of Next's interface, and takes an override over the inert default", () => {
    const router = nextRouter({ bfcacheId: "eigen" });

    for (const member of ["back", "forward", "refresh", "push", "replace", "prefetch"] as const) {
      assert.equal(typeof router[member], "function", `\`${member}\` is not a call the component can make`);
    }
    assert.equal(router.bfcacheId, "eigen");
  });

  /* Both halves: a recorder that logged the press but dropped the href would pass every case
     counting navigations and none reading where the reader was sent. */
  it("records each navigation with the address it carried", () => {
    const { router, seen } = recordingRouter();
    // Taken off the router rather than called on it: `no-restricted-syntax` bans the member call, and
    // each member closes over the log rather than over `this`.
    const { push, replace, back, refresh } = router;

    push("/admin/spieler");
    replace("/admin/teams");
    back();
    refresh();

    assert.deepEqual(seen, { pushed: ["/admin/spieler"], replaced: ["/admin/teams"], back: 1, refresh: 1 });
  });
});

describe("the tree a test mounts under Next", () => {
  it("carries the router, the search parameters and the path to what it wraps", () => {
    const markup = renderTree(
      underNext(h(Probe), { router: nextRouter({ bfcacheId: "gesetzt" }), search: "saison_id=2026", pathname: "/admin/spieler" }),
    );

    assert.match(markup, /gesetzt \| 2026 \| \/admin\/spieler/);
  });

  /* A caller naming no path is one whose component does not read one: the default has to be what the
     context carries with no provider, or mounting the wrapper would change that component's answer. */
  it("leaves the path unset where no caller names one, and still answers a parameter read", () => {
    assert.match(renderTree(underNext(h(Probe))), /\| none \| none/);
  });
});

const SRC = path.resolve(import.meta.dirname, "..", "..");

/** The private modules Next keeps the three contexts on, which no public export carries. */
const PRIVATE_PATH = /next\/dist\/shared\/lib\/(?:app-router-context|hooks-client-context)\.shared-runtime/;

/** This module and its own test, which reach the path so that nothing else has to. */
const HELPER = ["shared/testing/nextContexts.ts", "shared/testing/nextContexts.test.ts"];

/**
 * The slices that still mount the contexts themselves.
 *
 * A stale entry FAILS rather than being spared, so the list can only shrink: a file that stops
 * reaching the path leaves it, and one that starts has to be added deliberately.
 */
const STILL_MOUNTING = [
  "features/schiedsrichter/components/collections/AdminSchiedsrichterTable.test.ts",
  "features/schiedsrichter/components/views/AdminSchiedsrichterEditView.test.ts",
  "features/spiele/components/modals/SpielDetailsModal.test.ts",
  "features/spiele/components/views/SpielsucheView.test.ts",
  "features/spieler/components/collections/AdminSpielerTable.test.ts",
  "features/spieler/components/forms/AdminSpielerEditForm/FormKaderSection.test.ts",
  "features/teams/components/collections/AdminKontakteList.test.ts",
  "features/teams/components/collections/TeamsGrid.test.ts",
  "features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.test.ts",
  "features/teams/publicTeamLink.test.ts",
];

describe("who reaches Next's private context modules", () => {
  /* A Next release moving either module breaks whoever imports it, and a spelling per file is nine
     more places to repair — and nine more routers that can fall behind the interface. */
  it("is this helper alone, beside the slices that have not moved yet", () => {
    const reaching = filesUnder(SRC, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 500)
      .filter((file) => PRIVATE_PATH.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
      .sort();

    assert.deepEqual(reaching, [...HELPER, ...STILL_MOUNTING].sort());
  });

  /* The walk and the pattern are the only things standing between this roster and a clean answer
     over nothing, and a test file is what the roster is mostly made of. */
  it("is read off a tree this walk actually reaches", () => {
    const swept = filesUnder(SRC, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 500);

    assert.ok(swept.length > 400, `the walk found ${String(swept.length)} modules`);
    assert.ok(
      swept.some((file) => isTestFile(path.basename(file))),
      "the walk reaches no test file, and every entry on the roster is one",
    );
  });
});
