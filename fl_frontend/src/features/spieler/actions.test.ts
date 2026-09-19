import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { actionBodies } from "@/core/actionSources.ts";
import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { declaredCodes, sliceBetween } from "@/shared/testing/refusalRegister.ts";
import { refusalWrappers, renderTree } from "@/shared/testing/renderTest.ts";
import { spokenText } from "@/shared/testing/spokenText.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { withSaisonId } from "@/shared/utils/saisonHref.ts";

import {
  ERASURE_NEEDS_RETIREMENT,
  LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON,
  REACTIVATION_NEEDS_A_TEAM_IN_SAISON,
  REACTIVATION_NEEDS_ROOM_IN_SQUAD,
} from "./constants.ts";

import type { ReactNode } from "react";
import type { FLSpielerRolle } from "./schemas.ts";
import type { AdminSpielerRow, SpielerTeamOption } from "./types.ts";

const SPIELER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const SAISON_ID = "2026";

/* Every write answers as landed; this file still reads the real module's text. */
const { calls } = doubleActions({
  modules: ["/src/features/spieler/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Gespeichert.", spieler_id: SPIELER_ID }),
});

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormAustragenSection } = await import("./components/forms/AdminSpielerEditForm/FormAustragenSection.tsx");
const { FormLoeschenSection } = await import("./components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx");
const { AdminSpielerEditForm } = await import("./components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx");
const { AdminCreateSpielerForm } = await import("./components/forms/AdminCreateSpielerForm.tsx");
const { AdminSpielerTable } = await import("./components/collections/AdminSpielerTable.tsx");
const { TeamSelect } = await import("./components/forms/TeamSelect.tsx");

/** A tree under all three contexts, on the season the sidemenu names. */
const underSaison = (tree: ReactNode, router = recordingRouter().router): ReactNode =>
  underNext(tree, { router, search: `saison_id=${SAISON_ID}` });

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
/**
 * The page that hands the editor its figures, whitespace-collapsed because the formatter picks its line
 * breaks. What its cases hold is the wiring between the memberships read and the props it folds for the editor.
 */
const PAGE = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "admin", "spieler", "[spieler_id]", "page.tsx"), "utf8").replace(
  /\s+/g,
  " ",
);

/** The list page, which folds the squad counts the table must not fold: the same wiring, for the list. */
const LIST_PAGE = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "admin", "spieler", "page.tsx"), "utf8").replace(
  /\s+/g,
  " ",
);

const STORED_TEAM: SpielerTeamOption = { teamId: "68c1f0a2b3c4d5e6f7a8b9c1", name: "SG Alpha", shorthand: "SGA" };
const OTHER_TEAM: SpielerTeamOption = { teamId: "68c1f0a2b3c4d5e6f7a8b9c2", name: "TSV Beta", shorthand: "TSB" };
const RETIRED_ON = "2026-03-01";

/** The reason the refusal named `name` gives, or `null` where that control is open. */
const refusalNamed = (html: string, name: string): string | null =>
  refusalWrappers(html).find((wrapper) => wrapper.name === name)?.reason ?? null;

/** What a reader hears, the JSX line breaks collapsed. */
const read = (html: string): string => spokenText(html, " ").replace(/\s+/g, " ");

/** The player's editor on this season's squad row, which names the stored club. */
function renderEditor({
  teams,
  rolle = null,
  rowInactiveSince = null,
}: {
  teams: SpielerTeamOption[];
  rolle?: FLSpielerRolle | null;
  rowInactiveSince?: string | null;
}): void {
  render(
    underSaison(
      h(AdminSpielerEditForm, {
        spieler: { id: SPIELER_ID, vorname: "Lena", nachname: "Meier", inactive_since: null, geburtsdatum: null },
        einwilligung: null,
        saison: {
          saisonId: SAISON_ID,
          saisonStatus: "active",
          erlaubteStufen: ["Q1"],
          membership: {
            team_id: STORED_TEAM.teamId,
            nummer: "10",
            position: null,
            stufe: null,
            is_nachgetragen: false,
            rolle,
            inactive_since: rowInactiveSince,
          },
        },
        teams,
        membershipCount: 1,
        pageHeader: { title: "Lena Meier" },
      }),
    ),
  );
}

/** The team picker's trigger, named once by the field's label. */
const TEAM_PICKER = { name: "Team" };

/** Moves the editor's draft onto another club, as the reader does: the picker opened, the row pressed. */
async function pickTeam(user: ReturnType<typeof userEvent.setup>, team: SpielerTeamOption): Promise<void> {
  await user.click(screen.getByRole("button", TEAM_PICKER));
  await user.click(screen.getByRole("option", { name: new RegExp(team.name) }));
  assert.ok(screen.getByRole("button", TEAM_PICKER).textContent.includes(team.name), "the pick never landed, so nothing after it is judged");
}

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
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
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

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
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

/** The erasure panel at rest, for a person retired or still in the league. */
const loeschenPanel = (isRetired: boolean): string =>
  renderTree(underSaison(h(FormLoeschenSection, { spielerId: SPIELER_ID, fullName: "Lena Meier", isRetired, membershipCount: 2 })));

const ERASE_LABEL = "Spieler endgültig löschen";

describe("REQ-PURGE-001 as the admin reads it", () => {
  /* One string, imported by the mapper and by the control that disables itself on it: a race —
     somebody reactivating the player in another tab — must read as the state the page already showed. */
  it("is stated once and reused by both", () => {
    // Module-private, so the mapper's half is the import in its own text.
    assert.ok(ERASURE_MAP.includes("ERASURE_NEEDS_RETIREMENT"), "the mapper restates the message instead of sharing it");
    assert.equal(refusalNamed(loeschenPanel(false), ERASE_LABEL), ERASURE_NEEDS_RETIREMENT, "the panel words the refusal its own way");
  });

  it("names the repair and where it is done", () => {
    assert.match(ERASURE_NEEDS_RETIREMENT, /still/, "the message does not name retirement as the step that comes first");
    assert.match(ERASURE_NEEDS_RETIREMENT, /Spielerliste/, "the message does not say where a player is retired");
    assert.match(ERASURE_NEEDS_RETIREMENT, /Stilllegen/, "the message does not name the control that does it");
  });
});

/** The erasure panel for a retired person, mounted so a press can arm and run it. */
function renderErasure(router = recordingRouter().router): void {
  render(underSaison(h(FormLoeschenSection, { spielerId: SPIELER_ID, fullName: "Lena Meier", isRetired: true, membershipCount: 2 }), router));
}

const erasures = (): unknown[] => calls.filter((call) => call.action === "eraseSpielerAction").map((call) => call.payload);

describe("the erasure's copy", () => {
  it("says the person, the squad rows and the log entries all go", () => {
    const resting = read(loeschenPanel(true));

    assert.match(resting, /die Person selbst/, "the confirmation does not say the person goes");
    assert.match(resting, /Kadereinträge/, "the confirmation does not say the squad rows go");
    assert.match(resting, /Änderungsprotokoll/, "the confirmation does not say the log is reached");
  });

  it("arms a confirmation saying the log entries are emptied and none of it comes back", async () => {
    renderErasure();
    await userEvent.setup().click(screen.getByRole("button", { name: ERASE_LABEL }));

    const armed = document.body.textContent;
    assert.match(armed, /Angaben werden geleert/, "the confirmation does not say the log entries are EMPTIED rather than removed");
    assert.match(armed, /Zurückholen lässt sich das nicht/, "the confirmation does not refuse an undo in words");
    assert.doesNotMatch(armed, /Rückgängig/, "the armed panel offers an undo, and no endpoint can honour one");
    // The action's sentences too, whichever outcome it answers with.
    assert.ok(!ERASE_ACTION.includes("Rückgängig"), "the action offers an undo, and no endpoint can honour one");
  });

  /* The escalation is two presses, the draw's shape. One press would put a permanent removal behind
     the same gesture as a name edit. */
  it("arms before it writes", async () => {
    calls.length = 0;
    const user = userEvent.setup();
    renderErasure();

    await pressTwice(user, {
      resting: ERASE_LABEL,
      armed: `Ja, ${ERASE_LABEL}`,
      whileArmed: () => void assert.deepEqual(erasures(), [], "the first press erases rather than arming"),
    });

    assert.deepEqual(erasures(), [{ id: SPIELER_ID }], "the armed press writes nothing, or writes for another person");
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
    assert.equal(
      refusalNamed(loeschenPanel(false), ERASE_LABEL),
      ERASURE_NEEDS_RETIREMENT,
      "the press is offered to a person still in the league",
    );
    assert.equal(refusalNamed(loeschenPanel(true), ERASE_LABEL), null, "the gate reads the wrong way round");
  });

  /* This page is the erased player's own and answers not-found once the write lands, so Back must not
     return to it, and the list it lands on keeps the season the admin was working in. */
  it("leaves by replacing the page, never by pushing", async () => {
    const user = userEvent.setup();
    const { router, seen } = recordingRouter();
    renderErasure(router);

    await pressTwice(user, { resting: ERASE_LABEL, armed: `Ja, ${ERASE_LABEL}` });

    assert.deepEqual(seen.replaced, [withSaisonId("/admin/spieler", SAISON_ID)], "the erasure does not leave the page it just emptied");
    assert.deepEqual(seen.pushed, [], "Back is left pointing at a page that now answers not-found");
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

const TAKEN_KAPITAEN: SpielerTeamOption = { ...OTHER_TEAM, heldRollen: { kapitaen: "Mia Schulz" } };

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
  it("offers no role the destination squad has already given away", async () => {
    const user = userEvent.setup();
    renderEditor({ teams: [STORED_TEAM, TAKEN_KAPITAEN] });

    assert.equal(screen.getByRole("radio", { name: "Kapitän" }).hasAttribute("disabled"), false, "the role is closed on a squad nobody leads");
    await pickTeam(user, TAKEN_KAPITAEN);
    assert.equal(
      screen.getByRole("radio", { name: "Kapitän" }).hasAttribute("disabled"),
      true,
      "the offer is derived from something other than the draft team's own holders",
    );

    assert.match(
      PAGE,
      /const heldRollen = collectHeldRollen\(\{ spieler: membershipsRes\.spieler, saisonId: selectedSaison\.id, exceptSpielerId: spielerId \}\);/,
      "the page gathers the holders of another season, or counts this player's own role as taken from them",
    );
  });

  /* A transfer carries the draft's role into the destination squad, where the write path would
     refuse it. Cleared rather than carried, so the change list shows it instead of a failed save. */
  it("gives up a role that the team being moved into already has", async () => {
    const user = userEvent.setup();
    renderEditor({ rolle: "kapitaen", teams: [STORED_TEAM, TAKEN_KAPITAEN] });

    assert.equal(screen.getByRole("radio", { name: "Kapitän" }).getAttribute("aria-checked"), "true", "the stored role is not shown held");
    await pickTeam(user, TAKEN_KAPITAEN);
    assert.equal(screen.getByRole("radio", { name: "Kapitän" }).getAttribute("aria-checked"), "false", "a transfer carries a refused role");
  });
});

const ROW_REACTIVATE = "Kadereintrag reaktivieren";

describe("the reactivate's gate on the editor", () => {
  const panel = (rowReturn: "open" | "clubLeft" | "squadFull", rowInactiveSince: string | null = RETIRED_ON): string =>
    renderTree(h(FormAustragenSection, { spielerId: SPIELER_ID, saisonId: SAISON_ID, rowInactiveSince, rowReturn, banners: [] }));

  /* Each refused return names the repair where the editor's reader stands; `judgeRowReturn` decides which. */
  it("says each refused return on the control, and closes none it takes", () => {
    assert.equal(refusalNamed(panel("clubLeft"), ROW_REACTIVATE), REACTIVATION_NEEDS_A_TEAM_IN_SAISON);
    assert.equal(refusalNamed(panel("squadFull"), ROW_REACTIVATE), REACTIVATION_NEEDS_ROOM_IN_SQUAD);
    assert.deepEqual(refusalWrappers(panel("open")), [], "a return the endpoint takes is closed");
  });

  /* The press returns the row to the club it already names, so a gate keyed on the picker above would
     refuse a return the endpoint takes and offer one it refuses. */
  it("judges the return on the row's stored club, whatever team the draft moves to", async () => {
    const user = userEvent.setup();
    renderEditor({ rowInactiveSince: RETIRED_ON, teams: [{ ...STORED_TEAM, isSquadFull: true }, OTHER_TEAM] });

    assert.equal(
      refusalNamed(document.body.innerHTML, ROW_REACTIVATE),
      REACTIVATION_NEEDS_ROOM_IN_SQUAD,
      "the row's own full squad takes it back",
    );
    await pickTeam(user, OTHER_TEAM);
    assert.equal(
      refusalNamed(document.body.innerHTML, ROW_REACTIVATE),
      REACTIVATION_NEEDS_ROOM_IN_SQUAD,
      "the gate follows the draft's team rather than the row's own club",
    );
  });

  /* „jederzeit“ is what walked the admin onto the failing button: it promises across time, and a
     replacement removes the condition the promise rested on. */
  it("names the condition the pre-austragen copy rests on", () => {
    const aktiv = read(panel("open", null));

    assert.ok(!aktiv.includes("jederzeit"), "the unconditional promise is back above the austragen control");
    assert.match(aktiv, /solange sein Team in der Saison dabei ist/, "the copy states no condition at all");
  });

  /* The write's refresh remounts the editor, the page keying it on the stored row, so the pressed button
     is gone and a keyboard reader would be left on the page. */
  it("hands focus to the control that replaces the one a landed write pressed", async () => {
    const props = { spielerId: SPIELER_ID, saisonId: SAISON_ID, rowReturn: "open", banners: [] } as const;
    const { rerender } = render(h(FormAustragenSection, { ...props, key: "aktiv", rowInactiveSince: null }));
    // `ok` rather than `equal` on an element: a failure's report inspects both sides, and a jsdom node holds the whole window.
    assert.ok(document.activeElement === document.body, "a mount with no write behind it takes focus");

    await userEvent.setup().click(screen.getByRole("button", { name: "Aus Kader 2026 austragen" }));
    rerender(h(FormAustragenSection, { ...props, key: "ausgetragen", rowInactiveSince: RETIRED_ON }));

    assert.ok(document.activeElement === screen.getByRole("button", { name: ROW_REACTIVATE }), "focus fell to the page");
  });
});

/** One player on the list, whose squad row this season is retired and names the stored club unless told otherwise. */
const listRow = (person: Partial<AdminSpielerRow> = {}): AdminSpielerRow => ({
  id: SPIELER_ID,
  vorname: "Lena",
  nachname: "Meier",
  fullName: "Lena Meier",
  inactive_since: null,
  selected: {
    team_id: STORED_TEAM.teamId,
    nummer: "10",
    position: null,
    stufe: null,
    is_nachgetragen: false,
    rolle: null,
    inactive_since: RETIRED_ON,
    teamName: STORED_TEAM.name,
    teamShorthand: STORED_TEAM.shorthand,
  },
  ...person,
});

/** The list holding one row, for the season whose junction rows are `saisonTeams`. */
const listed = (row: AdminSpielerRow, saisonTeams: SpielerTeamOption[]): string =>
  renderTree(
    underSaison(
      h(AdminSpielerTable, {
        filteredSpieler: [row],
        emptiness: "none",
        saisonTeams,
        selectedSaisonId: SAISON_ID,
        setDeletingSpieler: () => undefined,
      }),
    ),
  );

const ROW_RESTORE = "Kadereintrag von Lena Meier reaktivieren";
const PERSON_RESTORE = "Spieler Lena Meier reaktivieren";

describe("the reactivate's gate on the list", () => {
  /* The same endpoint is reached from a row, and the list holds what decides the refusal already: the
     season's junction rows, against the row's stored club, in the list's own words. */
  it("says each refused return on the squad row's restore, judged on the row's stored club", () => {
    assert.equal(refusalNamed(listed(listRow(), [OTHER_TEAM]), ROW_RESTORE), LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON);
    assert.equal(refusalNamed(listed(listRow(), [{ ...STORED_TEAM, isSquadFull: true }]), ROW_RESTORE), REACTIVATION_NEEDS_ROOM_IN_SQUAD);

    const open = listed(listRow(), [STORED_TEAM, OTHER_TEAM]);
    assert.ok(open.includes(`aria-label="${ROW_RESTORE}"`), "the list offers no restore for a retired row, so nothing here is judged");
    assert.equal(refusalNamed(open, ROW_RESTORE), null, "a return the endpoint takes is closed");
  });

  /* `stilllegen` and `austragen` are two subjects, and `POST /spieler/{id}/reactivate` refuses
     nothing: gating the person's restore on the squad row's club would refuse a live operation. */
  it("leaves the person's own restore alone", () => {
    const both = listed(listRow({ inactive_since: RETIRED_ON }), [OTHER_TEAM]);

    assert.equal(refusalNamed(both, ROW_RESTORE), LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON, "the squad row's gate is not standing");
    assert.ok(both.includes(`aria-label="${PERSON_RESTORE}"`), "the list offers a retired person no restore");
    assert.equal(refusalNamed(both, PERSON_RESTORE), null, "the PERSON's reactivate picked up the squad row's gate");
  });

  /* Two controls, two endpoints, one row: `stilllegen` and `austragen` are different subjects, and a
     control wired to the other one answers with a success toast while the state it named stays. */
  it("sends each restore to its own endpoint", async () => {
    const user = userEvent.setup();

    for (const [control, action, payload] of [
      [ROW_RESTORE, "reactivateSaisonSpielerAction", { spieler_id: SPIELER_ID, saison_id: SAISON_ID }],
      [PERSON_RESTORE, "reactivateSpielerAction", { id: SPIELER_ID }],
    ] as const) {
      calls.length = 0;
      const { unmount } = render(
        underSaison(
          h(AdminSpielerTable, {
            filteredSpieler: [listRow({ inactive_since: RETIRED_ON })],
            emptiness: "none" as const,
            saisonTeams: [STORED_TEAM, OTHER_TEAM],
            selectedSaisonId: SAISON_ID,
            setDeletingSpieler: () => undefined,
          }),
        ),
      );

      // The first of the pair: the table and the phone cards both render the row, and one of the two
      // is hidden at any width rather than absent from the tree.
      const [press] = screen.getAllByRole("button", { name: control });
      await user.click(press ?? assert.fail(`the list offers no „${control}“`));
      assert.deepEqual(
        calls.map((call) => call.action),
        [action],
        `\u201e${control}\u201c reaches the wrong endpoint`,
      );
      assert.deepEqual(calls[0]?.payload, payload, `\u201e${control}\u201c sends the wrong key`);
      unmount();
    }
  });

  /* The editor's sentence points inside the editor. A reader on the list is a page away from the
     repair, so the two are separate strings and neither may drift onto the other's reader. */
  it("says the refusal where the list's reader stands", () => {
    assert.notEqual(LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON, REACTIVATION_NEEDS_A_TEAM_IN_SAISON, "the list borrowed the editor's sentence");
    assert.ok(!LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON.includes("oben"), "the list's sentence points at a place the list does not have");
  });
});

const KADER_VOLL_BANNER = "Der Kader dieses Teams ist für diese Saison voll";

describe("REQ-SQUAD-003 before the press", () => {
  /* The editor offers the pick and then refuses the save, so the banner has to name the team the
     DRAFT is on: keyed off the stored one it would go on standing through a transfer out of the
     full squad. */
  it("keys the editor's banner on the draft team, off a count the page took", async () => {
    const user = userEvent.setup();
    renderEditor({ teams: [{ ...STORED_TEAM, isSquadFull: true }, OTHER_TEAM] });

    assert.ok(document.body.textContent.includes(KADER_VOLL_BANNER), "a draft on a full squad raises no banner");
    await pickTeam(user, OTHER_TEAM);
    assert.ok(
      !document.body.textContent.includes(KADER_VOLL_BANNER),
      "the banner is derived from something other than the draft team's own answer",
    );

    assert.match(
      PAGE,
      /const liveSquadRows = countLiveSquadRows\(\{ spieler: membershipsRes\.spieler, saisonId: selectedSaison\.id, exceptSpielerId: spielerId \}\);/,
      "the page counts another season's squad rows, or leaves the player being edited in the tally their own room is judged from",
    );
  });

  /* The table is handed `filteredSpieler`, so a count folded there would shrink under a search and
     report room in a squad the endpoint refuses. */
  it("folds the list's counts on the page, where no search has narrowed the memberships", () => {
    assert.match(
      LIST_PAGE,
      /const liveSquadRows = countLiveSquadRows\(\{ spieler: membershipsRes\.spieler, saisonId: selectedSaisonId, exceptSpielerId: null \}\);/,
      "the list's own fold counts against something other than the season the rows are shown for",
    );
  });

  /* Two ways out and neither reader reaches either: the list is a page from the squad and the editor
     is a page from the season's rules, so a sentence naming one of them strands somebody at the other. */
  it("names both ways out of a full squad", () => {
    assert.match(REACTIVATION_NEEDS_ROOM_IN_SQUAD, /trage zuerst einen anderen Spieler aus/);
    assert.match(REACTIVATION_NEEDS_ROOM_IN_SQUAD, /maximale Kadergröße in den Saisonregeln/);
    assert.ok(!REACTIVATION_NEEDS_ROOM_IN_SQUAD.includes("oben"), "the sentence points within a page that does not hold the repair");
  });

  /* Both stand over one club on page load — the rail banner off the DRAFT team, this sentence off
     the STORED one — so a second wording leaves the reader deciding whether one obstacle is two. */
  it("toasts the sentence this control shows, in one wording", () => {
    const branch = squadBranch("REQ-SQUAD-003");
    // Split rather than spelled again: a third copy of these two literals is a third thing to drift.
    const [reason, repair] = REACTIVATION_NEEDS_ROOM_IN_SQUAD.replace(/\.$/, "").split(". ");

    assert.ok(branch.includes(`reason: "${reason ?? ""}"`), "the toast opens on a state this control words differently");
    assert.ok(branch.includes(`repair: "${repair ?? ""}"`), "the toast names the two ways out in another wording or another order");
  });

  /* The picker offers every write path its team, so a full squad barred here is barred on the create,
     on the transfer and on the editor's entry at once. Hiding the row instead would say nothing. */
  it("closes a full squad's row in the picker, saying why, rather than dropping it", async () => {
    render(h(TeamSelect, { value: null, onChange: () => undefined, teams: [STORED_TEAM, { ...OTHER_TEAM, isSquadFull: true }] }));
    await userEvent.setup().click(screen.getByRole("button", TEAM_PICKER));

    assert.equal(screen.getByRole("option", { name: new RegExp(STORED_TEAM.name) }).getAttribute("aria-disabled"), null);
    const full = screen.getByRole("option", { name: new RegExp(OTHER_TEAM.name) });
    assert.equal(full.getAttribute("aria-disabled"), "true", "the picker offers a team the write path refuses");
    assert.ok(full.textContent.includes("Kader voll"), "a closed row carries no reason for being closed");
  });

  /* react-aria mirrors the collection into a hidden native `<select>` whose options carry no
     `disabled`, so a key for a closed row still reaches `onChange` — a browser's autofill picks there. */
  it("re-reads the cap on a pick through the native mirror", async () => {
    const picked: string[] = [];
    const { container } = render(
      h(TeamSelect, {
        value: null,
        onChange: (teamId: string) => void picked.push(teamId),
        teams: [STORED_TEAM, { ...OTHER_TEAM, isSquadFull: true }],
      }),
    );
    const mirror = container.querySelector("select") ?? assert.fail("the picker mirrors no native select");
    const user = userEvent.setup();

    await user.selectOptions(mirror, OTHER_TEAM.teamId);
    assert.deepEqual(picked, [], "a pick past a closed row reaches the caller");
    await user.selectOptions(mirror, STORED_TEAM.teamId);
    assert.deepEqual(picked, [STORED_TEAM.teamId], "a pick through the mirror reaches no caller at all, so the case above proves nothing");
  });

  /* The create modal offers every running and planned season, and its picker's teams change with the
     one chosen — a fold for the preselected season alone would report room in all the others. */
  it("folds the create loader's counts for every season it offers", () => {
    assert.match(
      LIST_PAGE,
      /const liveSquadRows = countLiveSquadRows\(\{ spieler: membershipsRes\.spieler, saisonId: saison\.id, exceptSpielerId: null \}\);/,
      "the create loader counts against one season rather than each offered one",
    );
    assert.match(
      LIST_PAGE,
      /isSquadFull: squadIsFull\(liveSquadRows\[team\.teamId\], saison\.rules\.max_kadergroesse\)/,
      "the create loader's teams carry no cap answer, which the picker reads as unknown and offers",
    );
  });

  /* A team can stand in both seasons and be full in only one, so the season switch has to drop it for
     the same reason it drops a team the next season never had. */
  it("drops a team the newly chosen season has no room in", async () => {
    const user = userEvent.setup();
    render(
      underSaison(
        h(AdminCreateSpielerForm, {
          saisonOptions: [
            { saisonId: "2026", isNachgetragen: false, teams: [STORED_TEAM], erlaubteStufen: ["Q1"] },
            { saisonId: "2027", isNachgetragen: false, teams: [{ ...STORED_TEAM, isSquadFull: true }], erlaubteStufen: ["Q1"] },
            { saisonId: "2028", isNachgetragen: false, teams: [STORED_TEAM], erlaubteStufen: ["Q1"] },
          ],
          defaultSaisonId: "2026",
          onClose: () => undefined,
        }),
      ),
    );
    const pickSaison = async (saisonId: string) => {
      await user.click(screen.getByRole("button", { name: /Saison/ }));
      await user.click(screen.getByRole("option", { name: new RegExp(saisonId) }));
    };

    await pickTeam(user, STORED_TEAM);
    await pickSaison("2028");
    assert.ok(
      screen.getByRole("button", TEAM_PICKER).textContent.includes(STORED_TEAM.name),
      "a team with room in the next season is dropped too",
    );

    await pickSaison("2027");
    assert.equal(
      screen.getByRole("button", TEAM_PICKER).textContent.trim(),
      "Team wählen",
      "a full squad survives the season switch and reaches the submit",
    );
  });
});

describe("the create dialog's squad pickers", () => {
  // Beside its own visible label a second name reads each field out twice, „Team Team“.
  it("are each named once, by their visible label", () => {
    render(
      underSaison(
        h(AdminCreateSpielerForm, {
          saisonOptions: [{ saisonId: SAISON_ID, isNachgetragen: false, teams: [STORED_TEAM], erlaubteStufen: ["Q1"] }],
          defaultSaisonId: SAISON_ID,
          onClose: () => undefined,
        }),
      ),
    );

    for (const name of ["Team", "Position", "Stufe"]) screen.getByRole("button", { name });
  });
});

describe("the squad edit's refusals when the undo replays it", () => {
  const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "spieler", "undo", "route.ts"), "utf8");

  /** One row of the route's replay table, which is a literal keyed by code. */
  const replayRow = (code: string): string => new RegExp(`"${code}":\\s*"([^"]*)"`).exec(UNDO_ROUTE)?.[1] ?? "";

  const PATCH_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";

  /* `PATCH /spieler/{spieler_id}` is a prefix of it, so a substring read would hand the squad's codes
     to the person row. The person patch declares none, which is why the route catches nothing around it. */
  it("reads the squad patch as a whole token, not as a prefix", () => {
    assert.deepEqual(declaredCodes(PATCH_OPERATION), ["REQ-SQUAD-001", "REQ-SQUAD-003", "REQ-SQUAD-004"]);
    assert.deepEqual(declaredCodes("PATCH /spieler/{spieler_id}"), [], "the person patch now declares a rule the replay does not answer");
  });

  /* Two outcomes and not one: the person half goes back before the squad row is replayed, so a
     refusal after it may not tell the admin the change stands whole. */
  it("carries both outcome sentences, outside the rows", () => {
    assert.ok(UNDO_ROUTE.includes('const CHANGE_STANDS = "Die Änderung steht weiterhin.";'), "the whole-change outcome is gone");
    assert.ok(
      UNDO_ROUTE.includes('const PERSON_HALF_RESTORED = "Nur die Personendaten wurden zurückgesetzt.";'),
      "the half-restore outcome is gone",
    );
    assert.ok(UNDO_ROUTE.includes("person === undefined ? CHANGE_STANDS : PERSON_HALF_RESTORED"), "one outcome now answers both halves");
  });

  for (const code of declaredCodes(PATCH_OPERATION)) {
    it(`${code} reaches the admin in German on both write paths`, () => {
      const row = replayRow(code);

      assert.ok(
        SQUAD_MAP.includes(`error.serverErrorCode === "${code}"`),
        `${code} falls through to the generic conflict message when the edit is saved`,
      );
      assert.notEqual(row, "", `${code} falls through to the generic conflict message when the edit is undone`);
      // The route joins the row to the outcome with a space, so a row without its own stop runs the two sentences together.
      assert.ok(row.endsWith("."), `${code}'s replay row does not close its sentence`);
      assert.ok(!row.includes("Die Änderung steht weiterhin"), `${code}'s row states the outcome the route already adds`);
    });
  }
});

describe("the refresh the create's rescue owes the admin", () => {
  /* The one admin path that fails with a row already added, so `core/adminWriteRefresh.test.ts` —
     which reads each callback's own top level — cannot reach the call that serves it. */
  it("refreshes on the create's partial write too, where the person exists and the squad row does not", () => {
    const body = actionBodies(ACTIONS).get("postSpielerAction") ?? "";
    const opensRescue = body.indexOf("} catch (error) {");

    assert.notEqual(opensRescue, -1, "the create no longer rescues the squad row's failure where this case reads");
    assert.match(body.slice(opensRescue).split("\n    }")[0] ?? "", /^ {6}refresh\(\);$/m, "the create's rescue leaves a person no list shows");
  });
});
