import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel is mounted under the
   one Next keeps it on, as `fl_frontend/src/features/kontakte/editor.test.ts` mounts the search params. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { renderTree } from "@/shared/testing/renderTest.ts";

import { describeUebernommeneSpiele } from "./replacementOffer.ts";

import type { ContextType } from "react";

const { FormTeamErsatzSection } = await import("./FormTeamErsatzSection.tsx");

/**
 * Read rather than rendered for the copy this panel spells NOWHERE: a render answers for the one
 * state it was given, and an absence is claimed across every state there is.
 */
const PANEL = readFileSync(path.resolve(import.meta.dirname, "FormTeamErsatzSection.tsx"), "utf8");

function sliceBetween(from: string, to: string): string {
  const start = PANEL.indexOf(from);
  const end = PANEL.indexOf(to, start + from.length);

  return start === -1 || end === -1 ? "" : PANEL.slice(start, end);
}

/* Bounded by the next statement rather than by the comment above it: a slice ending at a comment
   grows silently the moment that comment is reworded, and the assertions over it stop being about
   the handler. */
const HANDLER = sliceBetween("const handleReplace = () => {", "const missingPickHint");
/**
 * What this panel puts INSIDE the shared shell; the announcement itself is `ConfirmReveal`'s. Read
 * rather than rendered because a second press reveals it, and a static render produces the resting form.
 */
const ARMED = sliceBetween("<ConfirmReveal>", "</ConfirmReveal>");

/**
 * The panel with JSX's line breaks collapsed, `undrawSpielplan.test.ts`'s idiom: Prettier rewraps a
 * text node at will, so a sentence asserted as written would fail on a reformat a reader never sees.
 */
const FLAT = PANEL.replace(/\s+/g, " ");

type ErsatzProps = Parameters<typeof FormTeamErsatzSection>[0];
type ErsatzRow = ErsatzProps["ersatz"]["rows"][number];
type ErsatzCandidate = ErsatzProps["ersatz"]["candidates"][number];

/** Every method the panel never calls: it refreshes only after a write, which no static render reaches. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "teamErsatz",
};

/** A row this season could hand over, which each case below moves one fact away from. */
const row = (over: Partial<ErsatzRow> = {}): ErsatzRow => ({
  teamId: "t1",
  name: "SG Alpha",
  gruppe: "A",
  spiele: 4,
  gespielteSpiele: 0,
  hasAustritt: false,
  isVerwaist: false,
  ...over,
});

const candidate = (over: Partial<ErsatzCandidate> = {}): ErsatzCandidate => ({
  id: "c1",
  name: "TSV Beta",
  isStillgelegt: false,
  isInSaison: false,
  ...over,
});

const markup = (ersatz: ErsatzProps["ersatz"], isFinishedSaison = false): string =>
  renderTree(
    h(AppRouterContext.Provider, {
      value: ROUTER,
      children: h(FormTeamErsatzSection, { saisonId: "2026-27", ersatz, isFinishedSaison }),
    }),
  );

/**
 * Text rather than the `title=` the panel writes: a `Callout` seats its title in an element, so the
 * attribute is the author's spelling and never the sentence anybody is served.
 */
const gelesen = (ersatz: ErsatzProps["ersatz"], isFinishedSaison = false): string =>
  markup(ersatz, isFinishedSaison)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Every `Callout` title the panel renders, in document order. A list rather than a search, so a
 * sentence that moved into a body — or a second callout raised beside the first — fails here.
 */
const closureTitles = (ersatz: ErsatzProps["ersatz"], isFinishedSaison = false): string[] =>
  [...markup(ersatz, isFinishedSaison).matchAll(/<strong[^>]*>(.*?)<\/strong>/g)].map((treffer) => treffer[1] ?? "");

/** The one state that offers the wechsel: a row nobody has played for, and a club free to take it. */
const OFFERED: ErsatzProps["ersatz"] = { rows: [row()], candidates: [candidate()] };

describe("the replacement panel", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the handler and the armed alert out of the file before reading them", () => {
    assert.ok(HANDLER.includes("replaceSaisonTeamAction("), "the write is outside the handler's slice");
    assert.ok(!HANDLER.includes("<section"), "the handler's slice runs on into the markup");
    assert.ok(ARMED.includes("Angesetzte Spiele"), "the armed alert's readout is outside its slice");
  });

  /* The draw deletes what it replaces and says so; this endpoint deletes nothing, so that register
     asks an admin to agree to a loss that will not happen. The survival is promised in the callout
     instead (`docs/frontend/spec.md` §1.12). */
  it("promises the schedule survives through the callout, and never borrows the draw's deletion register", () => {
    // The sentence itself, at every count it is written for: `replacementOffer.test.ts` pins each
    // opening and would pass a tail rewritten into the draw's words.
    for (const spiele of [0, 1, 4]) {
      assert.doesNotMatch(describeUebernommeneSpiele(spiele), /verloren|gelöscht|entfäll|verschoben/);
    }
    assert.match(describeUebernommeneSpiele(1), /wechselt mit/);
    assert.match(describeUebernommeneSpiele(4), /wechseln mit/);

    assert.match(PANEL, /describeUebernommeneSpiele\(outgoing\.spiele\)/);
    assert.doesNotMatch(PANEL, /gehen dabei verloren|gelöscht oder verschoben|Zurückholen lässt sich/);
  });

  /* What the press actually moves, all four. A confirmation exists to state the consequences an
     admin cannot predict, and the Austritt and the squad are exactly those two. */
  it("names the group, the fixtures, the austritt and the squad before the write", () => {
    assert.match(ARMED, /Platz in der Saison/);
    assert.match(ARMED, /Angesetzte Spiele/);
    assert.match(ARMED, /Austritt von/);
    assert.match(ARMED, /ausgetragen/);
  });

  /* Both wrong directions at once: `stillgelegt` would claim these pupils left every season there
     is, and a deletion word that the rows went rather than being stamped. */
  it("words the squad as its entries being ausgetragen, never as a Stilllegung or a deletion", () => {
    assert.match(PANEL, /Kadereinträge[\s\S]{0,160}ausgetragen/);
    assert.doesNotMatch(PANEL, /Kadereinträge[\s\S]{0,160}(gelöscht|entfernt|stillgelegt)/);
    // A CLUB's league-wide retirement keeps the word, which is why only its use on people is forbidden.
    assert.doesNotMatch(PANEL, /Spieler[\s\S]{0,160}stillgelegt/);
  });

  /* `/api/admin/teams/undo` restores through a PATCH addressing the row by `team_id` in the path, so
     it cannot move a replacement back — the row is answering to another club's id by then. */
  it("offers no undo and reaches no route handler", () => {
    assert.doesNotMatch(PANEL, /actionProps|UNDO_TIMEOUT_MS|Rückgängig/);
    assert.doesNotMatch(PANEL, /\/api\/admin\//);
    assert.match(FLAT, /Es gibt in der Verwaltung keinen Weg zurück\./);
  });

  /* The swap's and the draw's shape: two presses, and the second one writes. Call the action outside
     `press` and one press is the whole confirmation; the arming is `useTwoPressConfirm`'s to keep. */
  it("sends the write through the two-press control, and announces the armed state", () => {
    const arming = HANDLER.indexOf("press(async () => {");
    const writing = HANDLER.indexOf("replaceSaisonTeamAction(");

    assert.ok(arming !== -1, "handleReplace no longer presses through useTwoPressConfirm");
    assert.ok(arming < writing, "the write stands outside the armed branch");
    assert.match(PANEL, /<ConfirmReveal>/);
  });

  /* The payload names the outgoing club in the path and the incoming one in the body. Swap the two
     and the endpoint answers `REQ-REPLACE-003`, having been asked to replace the arriving club. */
  it("sends each side to the field the payload names it in", () => {
    assert.match(HANDLER, /team_id: outgoing\.teamId/);
    assert.match(HANDLER, /incoming_team_id: incoming\.id/);
    assert.match(HANDLER, /saison_id: saisonId/);
  });

  /* `REQ-REPLACE-002` in the form. Grade the row on anything else and the panel offers a press the
     endpoint refuses, or hides one it would accept. */
  it("closes a row on the count the endpoint judges, not on a status", () => {
    const played = gelesen({ rows: [row({ gespielteSpiele: 2 })], candidates: [candidate()] });

    // Both directions: a grade refusing everything and one refusing nothing each pass the other case.
    assert.match(played, /Nur Teams, die noch kein Spiel gespielt haben/, "a row whose fixtures were played is still on offer");
    assert.doesNotMatch(gelesen(OFFERED), /Nur Teams, die noch kein Spiel gespielt haben/, "an unplayed row is refused too");
  });

  /* The refusal messages in `features/teams/actions.ts` call the two sides ausscheidend and
     nachrückend. A panel using other words leaves an admin matching a refusal to a control by guess. */
  it("keeps the two names the refusal messages use", () => {
    assert.match(gelesen(OFFERED), /Ausscheidendes Team/);
    assert.match(gelesen(OFFERED), /Nachrückendes Team/);
  });

  /* `REQ-REPLACE-001` has no remedy inside this season, so the panel explains rather than disabling a
     button an admin would then hunt for a way to enable. */
  it("closes on a finished season rather than offering a press it would refuse", () => {
    assert.doesNotMatch(gelesen(OFFERED, true), /Ausscheidendes Team/, "a finished season still offers the pair of pickers");
    assert.match(gelesen(OFFERED, true), /In einer abgeschlossenen Saison lässt sich kein Team mehr ersetzen/);
  });

  /* Each closure names the rule that shut the control, never the situation that met it
     (`docs/frontend/spec.md` §1.12), so an admin can predict the next season from what they read here. */
  it("titles each closure it renders with the rule that shut it", () => {
    assert.deepEqual(closureTitles(OFFERED, true), ["In einer abgeschlossenen Saison lässt sich kein Team mehr ersetzen"]);
    assert.deepEqual(closureTitles({ rows: [], candidates: [candidate()] }), ["Ersetzen lässt sich nur ein Team, das in dieser Saison steht"]);
    assert.deepEqual(closureTitles({ rows: [row()], candidates: [candidate({ isInSaison: true })] }), [
      "Nachrücken kann nur ein Team, das in dieser Saison noch nicht dabei und nicht stillgelegt ist",
    ]);
  });

  /* Dictated verbatim, and the whole callout: a situation title above it, or a body under it, is the
     failure this pins. Read off the END of what the panel renders, which is where a body would land. */
  it("carries the dictated closure as its title alone, without a trailing stop", () => {
    const shut = { rows: [row({ gespielteSpiele: 2 })], candidates: [candidate()] };
    const played = gelesen(shut);

    assert.deepEqual(closureTitles(shut), ["Nur Teams, die noch kein Spiel gespielt haben, können ersetzt werden"]);
    // The END of what the panel renders, which is where a body under the title would land.
    assert.ok(played.endsWith("Nur Teams, die noch kein Spiel gespielt haben, können ersetzt werden"), `the dictated closure reads: ${played}`);
    // The two situation openings, which no state of this panel renders and so no render can refuse.
    assert.doesNotMatch(PANEL, /Die Saison ist zu weit|und das trifft auf keines mehr zu/);
  });
});
