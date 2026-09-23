import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { actionBodies, actionModules, adminActionModules, mutationOpener, sources } from "@/core/actionSources.ts";
import { blankComments } from "@/core/blankComments.ts";

const ACTION_MODULES = actionModules();
const ADMIN_ACTION_MODULES = adminActionModules();

/**
 * I233 is universal and no slice can hold it: a tenth slice arriving with nothing beside it fails
 * nothing any slice owns. This fence is the one reader that can see that absence.
 */

/**
 * Which of each module's actions moves the admin's page and which only reads. Typed by hand and held
 * to what each call site declares, two routes to one answer; the modules and their exports come off
 * the tree (PRE-4).
 */
const ROSTERS: Record<string, { writes: readonly string[]; readOnly: readonly string[] }> = {
  "features/bewerbungen/actions.ts": {
    writes: [
      "annehmenBewerbungAction",
      "ablehnenBewerbungAction",
      "einwilligungErneutSendenAction",
      "kontaktEmailKorrigierenAction",
      "besetzeKontaktSitzAction",
    ],
    readOnly: [],
  },
  "features/einladungen/actions.ts": {
    writes: ["postEinladungAction", "mailEinladungAction", "deleteEinladungAction", "postEinladungVersandAction"],
    // The bulk send's dry run, which reports who would be written to and writes nothing.
    readOnly: ["previewEinladungVersandAction"],
  },
  "features/kontakte/actions.ts": {
    writes: ["eraseKontaktpersonAction", "patchSaisonTeamKontakteAction"],
    // The erasure preview, which reads and moves nothing.
    readOnly: ["readKontaktErasureAnsichtAction"],
  },
  "features/passkeys/actions.ts": {
    writes: ["removePasskeyAction"],
    // The dialog's own read, which lists this administrator's rows and moves nothing.
    readOnly: ["readPasskeysAction"],
  },
  "features/saisons/actions.ts": {
    writes: [
      "postSaisonAction",
      "patchSaisonAction",
      "activateSaisonAction",
      "swapGruppenAction",
      "generateSpielplanAction",
      "undrawSpielplanAction",
    ],
    readOnly: [],
  },
  "features/schiedsrichter/actions.ts": {
    writes: [
      "postSchiedsrichterAction",
      "patchSchiedsrichterAction",
      "einladeSchiedsrichterAction",
      "deleteSchiedsrichterAction",
      "reactivateSchiedsrichterAction",
      "anonymiseSchiedsrichterAction",
    ],
    readOnly: [],
  },
  "features/sperrliste/actions.ts": { writes: ["postSperreAction", "deleteSperreAction"], readOnly: [] },
  "features/spiele/actions.ts": {
    writes: ["patchAdminSpielDataAction"],
    // The save's dry run, which reports what the save would void and voids nothing.
    readOnly: ["previewAdminSpielDataAction"],
  },
  "features/spieler/actions.ts": {
    writes: [
      "patchSpielerAction",
      "deleteSpielerAction",
      "reactivateSpielerAction",
      "eraseSpielerAction",
      "postSaisonSpielerAction",
      "patchSaisonSpielerAction",
      "deleteSaisonSpielerAction",
      "reactivateSaisonSpielerAction",
    ],
    readOnly: [],
  },
  "features/spielorte/actions.ts": {
    writes: ["postSpielortAction", "patchSpielortAction", "deleteSpielortAction", "reactivateSpielortAction"],
    readOnly: [],
  },
  "features/spieltage/actions.ts": { writes: ["patchSpieltagAction"], readOnly: [] },
  "features/teams/actions.ts": {
    writes: [
      "postTeamAction",
      "patchTeamAction",
      "deleteTeamAction",
      "reactivateTeamAction",
      "postSaisonTeamAction",
      "patchSaisonTeamAction",
      "replaceSaisonTeamAction",
    ],
    readOnly: [],
  },
};

/** The declarations outside an actions module: the undo spine's replay, which every undo route writes through. */
const OUTSIDE_ACTIONS: readonly string[] = ["shared/utils/undoRoute.ts :: route.mutationName :: write"];

const TOP_LEVEL_REFRESH = /^ {4}refresh\(\);$/m;

describe("every slice's admin writes, and the refresh each one owes", () => {
  it("finds every slice's actions, each module wrapping all of its own or none", () => {
    for (const { file, bodies, wrapped } of ACTION_MODULES) {
      assert.ok(
        wrapped === 0 || wrapped === bodies.size,
        `${file} runs ${String(wrapped)} of its ${String(bodies.size)} actions through runAdminMutation, so neither answer places it`,
      );
    }
  });

  it("names every admin action module the tree holds, and every export of each one", () => {
    assert.deepEqual(
      Object.keys(ROSTERS).sort(),
      ADMIN_ACTION_MODULES.map(({ file }) => file).sort(),
      "a slice arrived with no row here, or a row names a module the tree no longer holds",
    );

    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
      const roster = ROSTERS[file] ?? { writes: [], readOnly: [] };

      assert.deepEqual(
        [...roster.writes, ...roster.readOnly].sort(),
        [...bodies.keys()].sort(),
        `${file}'s row places actions the module does not export, or leaves one of its own unplaced`,
      );
    }
  });

  it("refreshes every placed write at its callback's top level, ahead of the success return", () => {
    let swept = 0;
    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
      for (const name of ROSTERS[file]?.writes ?? []) {
        const body = bodies.get(name) ?? "";
        const refreshAt = body.search(TOP_LEVEL_REFRESH);

        assert.ok(
          mutationOpener(body, name) !== null,
          `${file} :: ${name} opens some other callback, so this case's indentation means nothing`,
        );
        assert.notEqual(refreshAt, -1, `${file} :: ${name} writes and leaves the admin's page standing`);
        assert.ok(refreshAt < body.indexOf("success: true"), `${file} :: ${name}'s success return does not stand after a refresh`);
        swept++;
      }
    }
    assert.ok(swept >= 30, `expected at least 30 admin writes swept, found ${String(swept)}`);
  });

  /* The declaration decides what a throw inside the action answers: a write's may have left its row
     standing, and a read's changed nothing (`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`). */
  it("declares each action a read or a write at its call site, as this roster places it", () => {
    let declared = 0;
    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
      const roster = ROSTERS[file] ?? { writes: [], readOnly: [] };
      for (const [names, readOnly] of [
        [roster.writes, false],
        [roster.readOnly, true],
      ] as const) {
        for (const name of names) {
          const opener = mutationOpener(bodies.get(name) ?? "", name);
          assert.equal(opener?.readOnly, readOnly, `${file} :: ${name} declares itself other than this roster places it`);
          declared++;
        }
      }
    }
    assert.ok(declared >= 34, `expected at least 34 admin actions declared, found ${String(declared)}`);
  });

  it("places every declaration in the tree: each action's by this roster, and the undo replay's as a write", () => {
    const calls: string[] = [];
    const declared: string[] = [];
    for (const [file, text] of sources()) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const bare = blankComments(text);
      // Past a quote, the name is `fl_frontend/src/core/actionSources.ts :: actionModules`' needle, not a call.
      calls.push(...[...bare.matchAll(/(?<!")runAdminMutation\(/g)].map(() => file));
      for (const [, name, readOnly] of bare.matchAll(/runAdminMutation\(\s*"?([\w.]+)"?,\s*\{ readOnly: (true|false) \}/g)) {
        declared.push(`${file} :: ${name ?? ""} :: ${readOnly === "true" ? "read" : "write"}`);
      }
    }

    const placed = Object.entries(ROSTERS).flatMap(([file, { writes, readOnly }]) => [
      ...writes.map((name) => `${file} :: ${name} :: write`),
      ...readOnly.map((name) => `${file} :: ${name} :: read`),
    ]);

    assert.equal(declared.length, calls.length, "a call declares itself in a shape this sweep cannot read, so nothing holds it");
    assert.deepEqual(declared.sort(), [...placed, ...OUTSIDE_ACTIONS].sort());
  });

  it("leaves every action placed as read-only without one", () => {
    let spared = 0;
    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
      for (const name of ROSTERS[file]?.readOnly ?? []) {
        assert.doesNotMatch(bodies.get(name) ?? "", /^\s+refresh\(\);$/m, `${file} :: ${name} refreshes a page nothing it did has moved`);
        spared++;
      }
    }
    assert.ok(spared >= 1, "no action is placed as read-only anywhere, so the case above holds of nothing");
  });

  it("reads past a comment, past a helper, and past a branch", () => {
    /* The reader on input rather than on the tree: every action in the tree carries its refresh the
       same way, so no count over them separates this reader from one that takes the first it finds. */
    const sample = [
      "export async function aAction(payload: P): Promise<R> {",
      '  return runAdminMutation("aAction", { readOnly: false }, async () => {',
      "    /* the shape this replaced called",
      "    refresh();",
      "    */",
      "    if (!operation.acknowledged) {",
      "      refresh();",
      "      return { success: false };",
      "    }",
      "    return { success: true };",
      "  });",
      "}",
      "",
      "function refreshAdminList(): void {",
      "  refresh();",
      "}",
      "",
      "export async function bAction(payload: P): Promise<R> {",
      '  return runAdminMutation("bAction", { readOnly: false }, async () => {',
      "    refresh();",
      "    return { success: true };",
      "  });",
      "}",
    ].join("\n");
    const bodies = actionBodies(sample);

    assert.deepEqual([...bodies.keys()], ["aAction", "bAction"], "a helper between two exports was read as an action, or one export was lost");
    assert.equal(
      (bodies.get("aAction") ?? "").search(TOP_LEVEL_REFRESH),
      -1,
      "a commented-out call, a failure branch or a sibling helper answered for an action that refreshes on no path out",
    );
    assert.notEqual(
      (bodies.get("bAction") ?? "").search(TOP_LEVEL_REFRESH),
      -1,
      "the reader misses a call standing at the callback's top level",
    );
  });
});
