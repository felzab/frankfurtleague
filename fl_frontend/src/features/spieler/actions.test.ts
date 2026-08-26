import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { ERASURE_NEEDS_RETIREMENT, LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON, REACTIVATION_NEEDS_A_TEAM_IN_SAISON } from "./constants.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
/** Whitespace-collapsed: the panel's copy is JSX text, so the formatter picks its line breaks. */
const PANEL = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSpielerEditForm", "FormLoeschenSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");
/** The squad row's own panel, collapsed for the reason `PANEL` is. */
const AUSTRAGEN_PANEL = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSpielerEditForm", "FormAustragenSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");
/** The editor that derives what both panels are gated on, collapsed for the same reason. */
const EDIT_FORM = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSpielerEditForm", "AdminSpielerEditForm.tsx"),
  "utf8",
).replace(/\s+/g, " ");
/** The list that reaches the same reactivate from a row, collapsed for the reason `PANEL` is. */
const TABLE = readFileSync(path.resolve(import.meta.dirname, "components", "collections", "AdminSpielerTable.tsx"), "utf8").replace(
  /\s+/g,
  " ",
);
/** The page that hands the panel its figures, collapsed for the same reason. */
const PAGE = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "admin", "spieler", "[spieler_id]", "page.tsx"), "utf8").replace(
  /\s+/g,
  " ",
);

const ERASURE_OPERATION = "DELETE /spieler/{spieler_id}/erasure";
const ERASURE_CODES = ["REQ-PURGE-001"];

/* Read per slice rather than over the file: two mappers live here, and a search over the whole
   source is satisfied by whichever one happens to carry the arm. */
const ERASURE_MAP = sliceBetween(ACTIONS, "function mapErasureRefusal", "export async function postSpielerAction");
const ERASE_ACTION = sliceBetween(ACTIONS, "export async function eraseSpielerAction", "export async function postSaisonSpielerAction");
const SQUAD_MAP = sliceBetween(ACTIONS, "function mapSquadRefusal", "export async function postSpielerAction");
const CREATE_ACTION = sliceBetween(ACTIONS, "export async function postSpielerAction", "export async function patchSpielerAction");
/* The last declaration in the module, so its slice runs to the end of the file. */
const REACTIVATE_ROW_ACTION = sliceBetween(ACTIONS, "export async function reactivateSaisonSpielerAction", null);

/** One arm of the squad mapper, up to the arm declared after it. */
function squadBranch(code: string): string {
  return (SQUAD_MAP.split(`serverErrorCode === "${code}"`)[1] ?? "").split("if (error.serverErrorCode")[0] ?? "";
}

describe("the erasure action against the backend's refusal register", () => {
  /* First, because a boundary string that stopped matching leaves the slices empty and every
     assertion over them would then fail for something that is not the defect. */
  it("cuts the mapper and the action out of the file before reading them", () => {
    assert.ok(ERASURE_MAP.includes('serverErrorCode === "REQ-PURGE-001"'), "the erasure's branch is outside its slice");
    assert.ok(!ERASURE_MAP.includes("REQ-SQUAD-001"), "the erasure's slice runs on into the squad mapper's arms");

    assert.ok(ERASE_ACTION.includes("eraseSpieler(validated.data)"), "the erasure's call is outside its slice");
    assert.ok(!ERASE_ACTION.includes("postSaisonSpieler("), "the erasure's slice runs on into the junction create");
  });

  /* `DELETE /spieler/{spieler_id}` is a prefix of the erasure's operation, so a substring match here
     would read the soft delete's codes as the erasure's. */
  it("reads the erasure's operation as a whole token, not as a prefix", () => {
    assert.deepEqual(declaredCodes(ERASURE_OPERATION), ERASURE_CODES);
    assert.deepEqual(declaredCodes("DELETE /spieler/{spieler_id}"), [], "the soft delete now declares a rule the erasure's mapper answers");
  });

  it("maps every refusal the erasure endpoint declares", () => {
    const declared = declaredCodes(ERASURE_OPERATION);

    // Asserted before the loop rather than left to it: an operation the register stopped naming
    // declares nothing, the loop then runs zero times, and a green result would claim the mapper
    // covers an endpoint whose refusals it has in fact stopped reading.
    assert.deepEqual(declared, ERASURE_CODES);
    for (const code of declared)
      assert.ok(ERASURE_MAP.includes(`serverErrorCode === "${code}"`), `${code} reaches the admin as an unhandled conflict`);
  });

  /* The squad mapper answers the same 409 status. Left reachable from here, a squad code would be
     reported about a person nobody was entering. */
  it("keeps the squad mapper out of the erasure's catch", () => {
    assert.ok(ERASE_ACTION.includes("mapErasureRefusal(error)"), "the erasure consults some other mapper");
    assert.ok(!ERASE_ACTION.includes("mapSquadRefusal(error)"), "a squad refusal is reported as the erasure's own");
    assert.ok(SQUAD_MAP.includes("REQ-SQUAD-001"), "the squad mapper's slice no longer holds its arms");
  });
});

describe("REQ-PURGE-001 as the admin reads it", () => {
  /* One string, imported by the mapper and by the control that disables itself on it: a race —
     somebody reactivating the player in another tab — must read as the state the page already showed. */
  it("is stated once and reused by both", () => {
    assert.ok(ERASURE_MAP.includes("ERASURE_NEEDS_RETIREMENT"), "the mapper restates the message instead of sharing it");
    assert.ok(PANEL.includes("ERASURE_NEEDS_RETIREMENT"), "the panel restates the message instead of sharing it");
  });

  it("names the repair and where it is done", () => {
    assert.match(ERASURE_NEEDS_RETIREMENT, /still/, "the message does not name retirement as the step that comes first");
    assert.match(ERASURE_NEEDS_RETIREMENT, /Spielerliste/, "the message does not say where a player is retired");
    assert.match(ERASURE_NEEDS_RETIREMENT, /Stilllegen/, "the message does not name the control that does it");
  });
});

describe("the erasure's copy", () => {
  it("says the person, the squad rows and the log entries all go", () => {
    assert.match(PANEL, /die Person selbst/, "the confirmation does not say the person goes");
    assert.match(PANEL, /Kadereinträge/, "the confirmation does not say the squad rows go");
    assert.match(PANEL, /Änderungsprotokoll/, "the confirmation does not say the log is reached");
    assert.match(PANEL, /Angaben werden geleert/, "the confirmation does not say the log entries are EMPTIED rather than removed");
  });

  it("says none of it can be undone, and offers nothing that claims otherwise", () => {
    assert.match(PANEL, /Zurückholen lässt sich das nicht/, "the confirmation does not refuse an undo in words");
    assert.ok(!PANEL.includes("Rückgängig"), "the panel offers an undo, and no endpoint can honour one");
    assert.ok(!ERASE_ACTION.includes("Rückgängig"), "the action offers an undo, and no endpoint can honour one");
  });

  /* The escalation is two presses, the draw's shape. One press would put a permanent removal behind
     the same gesture as a name edit. */
  it("arms before it writes", () => {
    // The two-press ORDER is the shared hook's and is pinned once at `shared/hooks/useTwoPressConfirm.test.ts`;
    // what is panel-local is that the write is reached only through `press`, never from the bare handler.
    assert.match(PANEL, /press\(async \(\) => \{/, "the panel writes outside the armed press");
    assert.match(PANEL, /<ConfirmReveal>/, "the escalation replaces the copy in place with no announcement");
  });
});

describe("what the erasure moves", () => {
  /* The base tag and nothing beside it: the person and their squad rows are what the cached public
     squad read joins, and every other cached read joins no pupil. */
  it("invalidates the spieler tag alone", () => {
    assert.ok(ERASE_ACTION.includes("invalidateSpieler();"), "the erasure leaves the erased player in the cached squad read");
    assert.ok(!ERASE_ACTION.includes("updateTag("), "the erasure invalidates a tag its endpoint does not move");
    assert.match(ACTIONS, /function invalidateSpieler\(\)[^{]*\{\s*updateTag\("spieler"\);/, "invalidateSpieler moved off the base tag");
  });

  it("reports how much it removed, which nothing can be looked up again afterwards", () => {
    assert.ok(
      ERASE_ACTION.includes("describeErasureUmfang(erasure.erased_saison_spieler, erasure.redacted_aktionen)"),
      "the counts go unreported",
    );
  });

  /* A DELETE on `/erasure`, never on the player's own path: that one is the soft retire, and the two
     differ by the suffix alone. */
  it("calls the erasure endpoint and not the retire", () => {
    assert.match(MUTATIONS, /`\/spieler\/\$\{id\}\/erasure`/, "the mutation no longer addresses the erasure endpoint");
    assert.match(
      MUTATIONS,
      /erasure`,\s*FLSpielerErasureResponseSchema,\s*\{\s*method: "DELETE"/,
      "the erasure is sent as something other than a DELETE",
    );
  });
});

describe("the erasure's gate and its exit", () => {
  /* `REQ-PURGE-001` refuses the erasure while the person is still in the league, so the press is
     offered the other way round. Inverted, the button is live exactly where the endpoint refuses. */
  it("offers the press only while the person is retired", () => {
    assert.match(PANEL, /const blockedReason = isRetired \? null : ERASURE_NEEDS_RETIREMENT;/, "the gate reads the wrong way round");
    assert.match(PANEL, /isDisabled=\{isErasing \|\| blockedReason !== null\}/, "the button no longer reads its own gate");
  });

  /* This page is the erased player's own and answers not-found once the write lands, so Back must
     not return to it. */
  it("leaves by replacing the page, never by pushing", () => {
    assert.match(PANEL, /router\.replace\("\/admin\/spieler"\)/, "the erasure does not leave the page it just emptied");
    assert.ok(!PANEL.includes("router.push("), "Back is left pointing at a page that now answers not-found");
  });

  /* Every season's rows: the erasure takes them all, so a figure narrowed to the selected season
     understates what the press destroys — and the reader agrees to the figure. */
  it("is handed the squad rows of every season, not the selected one's", () => {
    assert.match(PAGE, /membershipCount=\{spieler\.memberships\.length\}/, "the panel's figure is not the whole of what is held");
    assert.doesNotMatch(PAGE, /membershipCount=\{[^}]*(filter|saison)/, "the figure is narrowed before the panel reads it");
  });
});

describe("REQ-SQUAD-001 where no form is on screen", () => {
  /* Two of the four writes that raise it are row buttons: a reactivate names the row's STORED club,
     which a replacement can take out of the season. A refusal carrying only a field message reaches
     them as VALIDATION_FAILED. */
  it("carries a sentence beside the field message", () => {
    const branch = squadBranch("REQ-SQUAD-001");

    assert.match(branch, /error: SQUAD_TEAM_NOT_IN_SAISON/, "the reactivate paths toast the generic banner instead");
    assert.match(branch, /fieldErrors: \{ team_id:/, "the form paths lose the refusal on their picker");
    assert.match(REACTIVATE_ROW_ACTION, /refusal\.error \?\? VALIDATION_FAILED/, "the row button stopped reading the sentence");
  });

  /* The sentence is read by a caller that picked no team, so it may not describe a choice — and the
     repair it names has to be reachable from a list page as well as from the editor. */
  it("describes the entry rather than a picked team, and names where the team is changed", () => {
    const declared = /const SQUAD_TEAM_NOT_IN_SAISON =([\s\S]*?);\n/.exec(ACTIONS)?.[1] ?? "";

    assert.notEqual(declared, "", "the message is no longer declared under that name");
    assert.match(declared, /Kadereintrag/, "the message does not name the entry it is about");
    assert.match(declared, /Kader/, "the message does not say where the team is changed");
    assert.doesNotMatch(declared, /gewählt/, "the message assumes a picker the reactivate never rendered");
  });

  /* The create DOES render a picker, and its message is embedded in a longer sentence — so it takes
     the short field text rather than the standalone one. */
  it("appends the field message on the create, which has a picker", () => {
    assert.match(
      CREATE_ACTION,
      /Object\.values\(refusal\.fieldErrors \?\? \{\}\)\[0\] \?\? refusal\.error/,
      "the create prefers the standalone sentence over the message its own picker carries",
    );
  });
});

describe("REQ-SQUAD-004 as the admin reads it", () => {
  /* One sentence for every path, as the cap has: the editor disables a role the squad has already
     given away, so a refusal arriving here at all is a stale form rather than a choice to mark. */
  it("carries a sentence and lands on no field", () => {
    const branch = squadBranch("REQ-SQUAD-004");

    assert.notEqual(branch, "", "the squad mapper has no arm for the role refusal");
    assert.match(branch, /error: SQUAD_ROLLE_TAKEN/, "the refusal reaches the admin as an unhandled conflict");
    assert.doesNotMatch(branch, /fieldErrors/, "a message keyed to the role control cannot be rendered");
  });

  /* One code answers both roles, and the reactivate raises it with no role on screen at all — so the
     sentence may name neither, and it has to name the repair. */
  it("names neither role and names the repair", () => {
    const declared = /const SQUAD_ROLLE_TAKEN =([\s\S]*?);\n/.exec(ACTIONS)?.[1] ?? "";

    assert.notEqual(declared, "", "the message is no longer declared under that name");
    assert.doesNotMatch(declared, /Kapitän/, "the sentence names a role the reactivate never showed");
    assert.match(declared, /Rolle/, "the message does not say what is already taken");
    assert.match(declared, /Nimm sie dem anderen Spieler zuerst ab/, "the message states no repair");
  });

  /* The page holds every membership already, so the editor can narrow the offer rather than let the
     press fail. The refusal still runs: a stale form and a direct request both reach the endpoint. */
  it("offers no role the destination squad has already given away", () => {
    assert.match(
      EDIT_FORM,
      /const heldRollen = teams\.find\(\(team\) => team\.teamId === teamId\)\?\.heldRollen \?\? \{\};/,
      "the offer is derived from something other than the draft team's own holders",
    );
    assert.match(PAGE, /collectHeldRollen\(\{/, "the page stopped supplying who holds each role");
  });

  /* A transfer carries the draft's role into the destination squad, where the write path would
     refuse it. Cleared rather than carried, so the change list shows it instead of a failed save. */
  it("gives up a role that the team being moved into already has", () => {
    assert.match(
      EDIT_FORM,
      /if \(rolle !== null && takenInNext\[rolle\] !== undefined\) setRolle\(null\);/,
      "a transfer carries a refused role",
    );
  });
});

describe("the reactivate's gate on the editor", () => {
  /* The refusal is deterministic and the page already holds what decides it — the season's junction
     rows against the row's stored club — so the press is offered only where the endpoint takes it. */
  it("offers the press only while the row's club stands in the season", () => {
    assert.match(
      AUSTRAGEN_PANEL,
      /const blockedReason = isRowTeamInSaison \? null : REACTIVATION_NEEDS_A_TEAM_IN_SAISON;/,
      "the gate reads the wrong way round",
    );
    assert.match(AUSTRAGEN_PANEL, /isDisabled=\{isPending \|\| blockedReason !== null\}/, "the button no longer reads its own gate");
    assert.ok(
      AUSTRAGEN_PANEL.includes('<Hint mode="refusal" reason={isPending ? null : blockedReason}'),
      "the reason is no longer on the control",
    );
  });

  /* The reactivate is judged against the season's own team list, which is the one collection
     `REQ-SQUAD-001` counts; a list of every club would say yes to a club that was replaced. */
  it("derives the gate from the season's teams and the row's stored club", () => {
    assert.match(
      EDIT_FORM,
      /const isRowTeamInSaison = storedMembership === null \|\| teams\.some\(\(team\) => team\.teamId === storedMembership\.team_id\);/,
      "the gate is derived from something other than this season's team list",
    );
  });

  /* „jederzeit“ is what walked the admin onto the failing button: it promises across time, and a
     replacement removes the condition the promise rested on. */
  it("names the condition the pre-austragen copy rests on", () => {
    assert.ok(!AUSTRAGEN_PANEL.includes("jederzeit"), "the unconditional promise is back above the austragen control");
    assert.match(AUSTRAGEN_PANEL, /solange sein Team in der Saison dabei ist/, "the copy states no condition at all");
  });
});

/** One row action's props, up to the tag that closes it. */
function rowActionSlice(label: string): string {
  const start = TABLE.indexOf(`label="${label}"`);
  const end = TABLE.indexOf("/>", start);

  return start === -1 || end === -1 ? "" : TABLE.slice(start, end);
}

describe("the reactivate's gate on the list", () => {
  /* The same endpoint is reached from a row, and the list holds what decides the refusal already:
     the season's junction rows for the facet, against the row's stored club. */
  it("derives the gate from the season's teams and the row's stored club", () => {
    assert.match(
      TABLE,
      /const isRowTeamInSaison = row === null \|\| saisonTeams\.some\(\(team\) => team\.teamId === row\.team_id\);/,
      "the gate is derived from something other than this season's team list",
    );
    assert.match(
      TABLE,
      /const rowBlockedReason = isRowTeamInSaison \? null : LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON;/,
      "the gate reads the wrong way round, or points the reader at the editor's own page",
    );
  });

  it("gates the squad row's restore on it", () => {
    assert.ok(rowActionSlice("Kadereintrag reaktivieren").includes("disabledReason={rowBlockedReason}"), "the row action is offered ungated");
  });

  /* `stilllegen` and `austragen` are two subjects, and `POST /spieler/{id}/reactivate` refuses
     nothing: gating the person's restore on the squad row's club would refuse a live operation. */
  it("leaves the person's own restore alone", () => {
    assert.ok(!rowActionSlice("Spieler reaktivieren").includes("disabledReason"), "the PERSON's reactivate picked up the squad row's gate");
  });

  /* The editor's sentence points inside the editor. A reader on the list is a page away from the
     repair, so the two are separate strings and neither may drift onto the other's reader. */
  it("says the refusal where the list's reader stands", () => {
    assert.notEqual(LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON, REACTIVATION_NEEDS_A_TEAM_IN_SAISON, "the list borrowed the editor's sentence");
    assert.ok(!LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON.includes("oben"), "the list's sentence points at a place the list does not have");
  });
});
