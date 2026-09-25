import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { pageBody } from "@/shared/testing/pageHarness.ts";
import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
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
import { mapAlreadyInSaisonRefusal, mapErasureRefusal, mapSquadRefusal } from "./refusals.ts";

import type { ReactElement, ReactNode } from "react";
import type { FLSpielerRolle } from "./schemas.ts";
import type { AdminSpielerRow, SpielerSaisonMembership, SpielerTeamOption } from "./types.ts";

const SPIELER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const SAISON_ID = "2026";

/* Every write answers as landed; this file still reads the real module's text. */
const { calls } = doubleActions({
  modules: ["/src/features/spieler/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Gespeichert.", spieler_id: SPIELER_ID }),
});

/* A hook, not a first line in each case: one that throws before its own reset leaves the array
   dirty for whatever runs next, and one added without a reset inherits the last case's writes with
   nothing failing. */
beforeEach(() => {
  calls.length = 0;
});

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormAustragenSection } = await import("./components/forms/AdminSpielerEditForm/FormAustragenSection.tsx");
const { FormLoeschenSection } = await import("./components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx");
const { AdminSpielerEditForm } = await import("./components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx");
const { AdminSpielerTable } = await import("./components/collections/AdminSpielerTable.tsx");
const { TeamSelect } = await import("./components/forms/TeamSelect.tsx");

/** What the editor page's doubled reads answer, set by the case that renders it. */
const PAGE_READS = "__flSpielerEditorLesungen";

/* The page's own reads, each double answering only the fields the page reads. */
const PAGE_DOUBLES: [string, string][] = [
  [
    "/src/features/spieler/queries.ts",
    `export const getSpielerMemberships = async () => globalThis.${PAGE_READS}.memberships;
export const getSpielerNachnominierung = async (saison_id) => {
  globalThis.${PAGE_READS}.asked?.push(saison_id);
  return { saison_id, nachnominierung: globalThis.${PAGE_READS}.nachnominierung ?? false };
};`,
  ],
  [
    "/src/features/saisons/queries.ts",
    `export const getAdminSaisons = async () => globalThis.${PAGE_READS}.saisons;
export const getSaisons = async () => globalThis.${PAGE_READS}.saisons;`,
  ],
  ["/src/features/teams/queries.ts", `export const getTeamMemberships = async () => globalThis.${PAGE_READS}.teams;`],
];

registerHooks({
  load(url, context, nextLoad) {
    const doubled = PAGE_DOUBLES.find(([ending]) => url.endsWith(ending));
    if (doubled !== undefined) return { format: "module", source: doubled[1], shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { default: AdminSpielerEditPage } = await import("@/app/admin/spieler/[spieler_id]/page.tsx");
const { default: AdminSpielerPage } = await import("@/app/admin/spieler/page.tsx");

/** A tree under all three contexts, on the season the sidemenu names. */
const underSaison = (tree: ReactNode, router = recordingRouter().router): ReactNode =>
  underNext(tree, { router, search: `saison_id=${SAISON_ID}` });

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
          nachnominierungLaeuft: null,
          membership: {
            team_id: STORED_TEAM.teamId,
            nummer: "10",
            position: null,
            stufe: null,
            ist_nachnominiert: false,
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
const ENTRY_OPERATION = "POST /spieler/{spieler_id}/saisons";
const SQUAD_PATCH_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";
const REACTIVATE_ROW_OPERATION = "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate";
const RETIRE_ROW_OPERATION = "DELETE /spieler/{spieler_id}/saisons/{saison_id}";

/** What the squad mapper answers one code with, on the write the editor saves. */
const squadAnswer = (code: string) => mapSquadRefusal(refusedOn(SQUAD_PATCH_OPERATION, code));

describe("the player actions against the codes their endpoints publish", () => {
  /* `DELETE /spieler/{spieler_id}` is a prefix of the erasure's operation, and the erasure's mapper
     answers its own set alone. */
  it("maps every refusal the erasure endpoint publishes", () => {
    const published = publishedRefusals(ERASURE_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      ["REQ-PURGE-001"],
    );
    for (const code of published) {
      assert.notEqual(answerShown(ERASURE_OPERATION, code, mapErasureRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
  });

  /* The squad's rules first and the unique index after, whose mapper answers every 409 it is handed:
     pinned, so a rule published later fails here rather than reading as a repeat row. */
  it("maps every refusal the squad entry publishes", () => {
    assert.deepEqual(
      publishedRefusals(ENTRY_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-SQUAD-001", "REQ-SQUAD-003", "REQ-SQUAD-004"],
      "the squad entry now publishes a rule its unique index's mapper reports as a repeat row",
    );
    for (const code of publishedRefusals(ENTRY_OPERATION)) {
      const answered = answerShown(ENTRY_OPERATION, code, (error) => mapSquadRefusal(error) ?? mapAlreadyInSaisonRefusal(error));
      assert.notEqual(answered, null, `${code} reaches the admin as an unhandled conflict`);
    }
  });

  it("maps every refusal the row's reactivation publishes", () => {
    for (const code of publishedRefusals(REACTIVATE_ROW_OPERATION)) {
      assert.notEqual(answerShown(REACTIVATE_ROW_OPERATION, code, mapSquadRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
  });

  /* Asks no mapper: the one code it publishes is the unique index's, whose sentence is the shared
     reader's own. A rule published on it later fails here until a mapper words it. */
  it("leaves every refusal the row's retirement publishes to the shared reader", () => {
    for (const code of publishedRefusals(RETIRE_ROW_OPERATION)) {
      assert.notEqual(
        answerShown(RETIRE_ROW_OPERATION, code, () => null),
        null,
        `${code} reaches the admin as an unhandled conflict`,
      );
    }
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
    assert.equal(
      mapErasureRefusal(refusedOn(ERASURE_OPERATION, "REQ-PURGE-001")),
      ERASURE_NEEDS_RETIREMENT,
      "the mapper words the refusal its own way",
    );
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
  });

  /* The escalation is two presses, the draw's shape. One press would put a permanent removal behind
     the same gesture as a name edit. */
  it("arms before it writes", async () => {
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
  it("is handed the squad rows of every season, not the selected one's", async () => {
    const row = (saison_id: string) => ({
      saison_id,
      team_id: STORED_TEAM.teamId,
      nummer: "10",
      position: null,
      stufe: null,
      ist_nachnominiert: false,
      rolle: null,
      inactive_since: RETIRED_ON,
    });
    const saison = (id: string, status: string) => ({ id, status, rules: { erlaubte_stufen: ["Q1"], max_kadergroesse: 20 } });

    (globalThis as unknown as Record<string, unknown>)[PAGE_READS] = {
      memberships: {
        spieler: [
          {
            id: SPIELER_ID,
            vorname: "Lena",
            nachname: "Meier",
            inactive_since: RETIRED_ON,
            geburtsdatum: null,
            einwilligung: null,
            email: null,
            memberships: [row("2025"), row(SAISON_ID)],
          },
        ],
      },
      saisons: { saisons: [saison("2025", "finished"), saison(SAISON_ID, "active")] },
      teams: {
        teams: [{ id: STORED_TEAM.teamId, name: STORED_TEAM.name, shorthand: STORED_TEAM.shorthand, memberships: [{ saison_id: SAISON_ID }] }],
      },
    };

    render(underSaison(await editorPageBody()));
    await userEvent.setup().click(screen.getByRole("button", { name: ERASE_LABEL }));

    assert.equal(screen.getByText("Kadereinträge").nextElementSibling?.textContent, "2", "the figure is narrowed to the selected season's row");
  });
});

/** The editor page's body as its reads answer it: the element it hands the editor. */
const editorPageBody = (): Promise<ReactElement> =>
  pageBody(AdminSpielerEditPage, {
    params: Promise.resolve({ spieler_id: SPIELER_ID }),
    searchParams: Promise.resolve({ saison_id: SAISON_ID }),
  });

const OTHER_ID = "68c1f0a2b3c4d5e6f7a8b9d0";
const THIRD_ID = "68c1f0a2b3c4d5e6f7a8b9d1";
const EARLIER = "2025";

type PageReads = { asked: string[]; nachnominierung: boolean };
const pageReads = (): PageReads => (globalThis as unknown as Record<string, PageReads>)[PAGE_READS]!;

/** A player holding one live squad row per entry. */
function person(id: string, vorname: string, rows: { saison_id: string; team_id: string; rolle?: FLSpielerRolle }[]) {
  return {
    id,
    vorname,
    nachname: null,
    inactive_since: null,
    geburtsdatum: null,
    einwilligung: null,
    email: null,
    memberships: rows.map(({ saison_id, team_id, rolle = null }) => ({
      saison_id,
      team_id,
      nummer: null,
      position: null,
      stufe: null,
      ist_nachnominiert: false,
      rolle,
      inactive_since: null,
    })),
  };
}

/** Both clubs in both seasons, squads capped at two, the verdict answering that a late entry runs. */
function answerPages(spieler: ReturnType<typeof person>[]): void {
  const rules = { erlaubte_stufen: ["Q1"], max_kadergroesse: 2 };
  const club = ({ teamId, name, shorthand }: SpielerTeamOption) => ({
    id: teamId,
    name,
    shorthand,
    memberships: [{ saison_id: EARLIER }, { saison_id: SAISON_ID }],
  });

  (globalThis as unknown as Record<string, unknown>)[PAGE_READS] = {
    memberships: { spieler },
    saisons: {
      saisons: [
        { id: EARLIER, status: "past", rules },
        { id: SAISON_ID, status: "active", rules },
      ],
    },
    teams: { teams: [club(STORED_TEAM), club(OTHER_TEAM)] },
    asked: [],
    nachnominierung: true,
  };
}

const teamsOf = (body: ReactElement): SpielerTeamOption[] => (body.props as { teams: SpielerTeamOption[] }).teams;
const heldBy = (body: ReactElement) => Object.fromEntries(teamsOf(body).map((team) => [team.teamId, team.heldRollen]));
const fullIn = (body: ReactElement) => Object.fromEntries(teamsOf(body).map((team) => [team.teamId, team.isSquadFull]));

describe("REQ-SQUAD-001 where no form is on screen", () => {
  /* Two of the four writes that raise it are row buttons: a reactivate names the row's STORED club,
     which a replacement can take out of the season. A refusal carrying only a field message reaches
     them as VALIDATION_FAILED. */
  it("carries a sentence beside the field message", () => {
    const answered = squadAnswer("REQ-SQUAD-001");

    assert.equal(typeof answered?.error, "string", "the reactivate paths toast the generic banner instead");
    assert.deepEqual(Object.keys(answered?.fieldErrors ?? {}), ["team_id"], "the form paths lose the refusal on their picker");
  });

  /* The sentence is read by a caller that picked no team, so it may not describe a choice — and the
     repair it names has to be reachable from a list page as well as from the editor. */
  it("describes the entry rather than a picked team, and names where the team is changed", () => {
    const declared = squadAnswer("REQ-SQUAD-001")?.error ?? "";

    assert.match(declared, /Kadereintrag/, "the message does not name the entry it is about");
    assert.match(declared, /Kader/, "the message does not say where the team is changed");
    assert.doesNotMatch(declared, /gewählt/, "the message assumes a picker the reactivate never rendered");
  });
});

const TAKEN_KAPITAEN: SpielerTeamOption = { ...OTHER_TEAM, heldRollen: { kapitaen: "Mia Schulz" } };

describe("REQ-SQUAD-004 as the admin reads it", () => {
  /* One sentence for every path, as the cap has: the editor disables a role the squad has already
     given away, so a refusal arriving here at all is a stale form rather than a choice to mark. */
  it("carries a sentence and lands on no field", () => {
    const answered = squadAnswer("REQ-SQUAD-004");

    assert.equal(typeof answered?.error, "string", "the refusal reaches the admin as an unhandled conflict");
    assert.equal(answered?.fieldErrors, undefined, "a message keyed to the role control cannot be rendered");
  });

  /* One code answers both roles, and the reactivate raises it with no role on screen at all — so the
     sentence may name neither, and it has to name the repair. */
  it("names neither role and names the repair", () => {
    const declared = squadAnswer("REQ-SQUAD-004")?.error ?? "";

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
  });

  /* Held in another season, or held by the player being edited, a role is free to take: counted
     either way, the editor closes a role the write path would take. */
  it("is handed the holders of the selected season, the player being edited left out", async () => {
    answerPages([
      person(SPIELER_ID, "Lena", [{ saison_id: SAISON_ID, team_id: STORED_TEAM.teamId, rolle: "kapitaen" }]),
      person(OTHER_ID, "Mia", [
        { saison_id: EARLIER, team_id: STORED_TEAM.teamId, rolle: "co_kapitaen" },
        { saison_id: SAISON_ID, team_id: OTHER_TEAM.teamId, rolle: "kapitaen" },
      ]),
    ]);

    assert.deepEqual(heldBy(await editorPageBody()), { [STORED_TEAM.teamId]: {}, [OTHER_TEAM.teamId]: { kapitaen: "Mia" } });
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
    ist_nachnominiert: false,
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
      // Per iteration, where no hook reaches: the two halves of this one case share the array.
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
  });

  /* Two places in a squad of two: the stored club is full only when the edited player's own row is
     counted, which would refuse an edit that moves nobody, and the other club only in another season. */
  it("is handed each squad's room in the selected season, the player being edited left out", async () => {
    answerPages([
      person(SPIELER_ID, "Lena", [{ saison_id: SAISON_ID, team_id: STORED_TEAM.teamId }]),
      person(OTHER_ID, "Mia", [
        { saison_id: SAISON_ID, team_id: STORED_TEAM.teamId },
        { saison_id: EARLIER, team_id: OTHER_TEAM.teamId },
      ]),
      person(THIRD_ID, "Ida", [{ saison_id: EARLIER, team_id: OTHER_TEAM.teamId }]),
    ]);

    assert.deepEqual(fullIn(await editorPageBody()), { [STORED_TEAM.teamId]: false, [OTHER_TEAM.teamId]: false });
  });

  /* The table is handed `filteredSpieler`, so a count folded there would shrink under a search and
     report room in a squad the endpoint refuses. The list names no writer: every live row counts. */
  it("is handed each squad's room on the list, over every player of the selected season", async () => {
    answerPages([
      person(SPIELER_ID, "Lena", [{ saison_id: SAISON_ID, team_id: STORED_TEAM.teamId }]),
      person(OTHER_ID, "Mia", [
        { saison_id: SAISON_ID, team_id: STORED_TEAM.teamId },
        { saison_id: EARLIER, team_id: OTHER_TEAM.teamId },
      ]),
      person(THIRD_ID, "Ida", [{ saison_id: EARLIER, team_id: OTHER_TEAM.teamId }]),
    ]);
    const body = await pageBody(AdminSpielerPage, {
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ saison_id: SAISON_ID, q: "Lena" }),
    });

    assert.deepEqual(fullIn(body), { [STORED_TEAM.teamId]: true, [OTHER_TEAM.teamId]: false });
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
    assert.equal(
      squadAnswer("REQ-SQUAD-003")?.error,
      REACTIVATION_NEEDS_ROOM_IN_SQUAD,
      "the toast words the full squad apart from this control",
    );
  });

  /* The picker offers every write path its team, so a full squad barred here is barred on the
     transfer and on the editor's entry at once. Hiding the row instead would say nothing. */
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
});

describe("the squad edit's refusals", () => {
  /* `PATCH /spieler/{spieler_id}` is a prefix of it and refuses on no rule, which is why the undo
     route catches nothing around the person half. */
  it("reads the squad patch's own rules", () => {
    assert.deepEqual(
      publishedRefusals(SQUAD_PATCH_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-SQUAD-001", "REQ-SQUAD-003", "REQ-SQUAD-004"],
    );
  });

  for (const code of publishedRefusals(SQUAD_PATCH_OPERATION)) {
    it(`${code} reaches the admin in German when the edit is saved`, () => {
      assert.notEqual(
        answerShown(SQUAD_PATCH_OPERATION, code, mapSquadRefusal),
        null,
        `${code} falls through to the generic conflict message when the edit is saved`,
      );
    });
  }
});

const ENTRY_ANNOUNCEMENT = "Diese Person wird nachnominiert";

describe("the late-entry marker, which the backend derives", () => {
  /* An ACTIVE season in every case: one whose matchday 1 is undated or still ahead enters an ordinary
     player, so an editor reading the status would announce a late entry the backend never stores. */
  const renderEntry = (nachnominierungLaeuft: boolean) =>
    render(
      underSaison(
        h(AdminSpielerEditForm, {
          spieler: { id: SPIELER_ID, vorname: "Lena", nachname: "Meier", inactive_since: null, geburtsdatum: null },
          einwilligung: null,
          saison: { saisonId: SAISON_ID, saisonStatus: "active", erlaubteStufen: ["Q1"], nachnominierungLaeuft, membership: null },
          teams: [STORED_TEAM],
          membershipCount: 0,
          pageHeader: { title: "Lena Meier" },
        }),
      ),
    );

  it("announces the entry as a Nachnominierung on the served verdict alone", () => {
    const ordinary = renderEntry(false);
    assert.ok(!document.body.textContent.includes(ENTRY_ANNOUNCEMENT), "an active season announces a late entry the backend will not store");
    ordinary.unmount();

    renderEntry(true);
    assert.ok(document.body.textContent.includes(ENTRY_ANNOUNCEMENT), "a running period goes unannounced");
  });

  it("enters a player without sending a marker", async () => {
    const user = userEvent.setup();
    renderEntry(true);

    await pickTeam(user, STORED_TEAM);
    await user.click(screen.getByRole("button", { name: `In Kader ${SAISON_ID} aufnehmen` }));

    assert.deepEqual(
      calls.map((call) => call.action),
      ["postSaisonSpielerAction"],
    );
    assert.ok(!Object.hasOwn(calls[0]?.payload ?? {}, "ist_nachnominiert"), "the entry sends a marker the payload refuses");
  });

  it("saves an edit without sending the stored marker back", async () => {
    const user = userEvent.setup();
    renderEditor({ teams: [STORED_TEAM] });

    const nummer = screen.getByRole("textbox", { name: "Nummer" });
    await user.clear(nummer);
    await user.type(nummer, "7");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchSaisonSpielerAction"],
      "the edit never reached its write, so the payload below is judged over nothing",
    );
    assert.ok(!Object.hasOwn(calls[0]?.payload ?? {}, "ist_nachnominiert"), "the edit sends a marker the payload refuses");
  });

  /* The banner is raised on the entry branch alone, so a player holding a row costs no read. */
  it("asks for the served verdict only where the player holds no row in the season", async () => {
    const saisonOf = (body: ReactElement) => (body.props as { saison: SpielerSaisonMembership }).saison;

    answerPages([person(SPIELER_ID, "Lena", [{ saison_id: EARLIER, team_id: STORED_TEAM.teamId }])]);
    assert.equal(saisonOf(await editorPageBody()).nachnominierungLaeuft, true, "the editor is handed something other than the verdict");
    assert.deepEqual(pageReads().asked, [SAISON_ID], "the page asks another season, or asks more than once");

    answerPages([person(SPIELER_ID, "Lena", [{ saison_id: SAISON_ID, team_id: STORED_TEAM.teamId }])]);
    assert.equal(saisonOf(await editorPageBody()).nachnominierungLaeuft, null, "a player holding a row is handed a verdict no entry uses");
    assert.deepEqual(pageReads().asked, [], "the page asks for a verdict no banner can use");
  });
});
