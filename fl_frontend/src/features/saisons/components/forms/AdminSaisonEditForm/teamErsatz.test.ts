import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `oneWayGuards.test.ts`'s idiom and for its reason. */
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
/** What this panel puts INSIDE the shared shell; the announcement itself is `ConfirmReveal`'s. */
const ARMED = sliceBetween("<ConfirmReveal>", "</ConfirmReveal>");

/**
 * The panel with JSX's line breaks collapsed, `undrawSpielplan.test.ts`'s idiom: Prettier rewraps a
 * text node at will, so a sentence asserted as written would fail on a reformat a reader never sees.
 */
const FLAT = PANEL.replace(/\s+/g, " ");

describe("the replacement panel", () => {
  /* First, because a boundary string that stopped matching leaves a slice empty and every assertion
     over it would then pass or fail for something that is not the defect. */
  it("cuts the handler and the armed alert out of the file before reading them", () => {
    assert.ok(HANDLER.includes("replaceSaisonTeamAction("), "the write is outside the handler's slice");
    assert.ok(!HANDLER.includes("<section"), "the handler's slice runs on into the markup");
    assert.ok(ARMED.includes("Angesetzte Spiele"), "the armed alert's readout is outside its slice");
  });

  /* The draw deletes what it replaces and says so; this endpoint deletes nothing, so that register
     asks an admin to agree to a loss that will not happen. The survival is promised in the callout
     instead (`docs/frontend/spec.md` §1.12). */
  it("promises the schedule survives through the callout, and never borrows the draw's deletion register", () => {
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
    assert.match(PANEL, /row\.gespielteSpiele > 0/);
  });

  /* The refusal messages in `features/teams/actions.ts` call the two sides ausscheidend and
     nachrückend. A panel using other words leaves an admin matching a refusal to a control by guess. */
  it("keeps the two names the refusal messages use", () => {
    assert.match(PANEL, /Ausscheidendes Team/);
    assert.match(PANEL, /Nachrückendes Team/);
  });

  /* `REQ-REPLACE-001` has no remedy inside this season, so the panel explains rather than disabling a
     button an admin would then hunt for a way to enable. */
  it("closes on a finished season rather than offering a press it would refuse", () => {
    assert.match(PANEL, /isFinishedSaison \?/);
    assert.match(PANEL, /In einer abgeschlossenen Saison lässt sich kein Team mehr ersetzen/);
  });

  /* Each closure names the rule that shut the control, never the situation that met it
     (`docs/frontend/spec.md` §1.12), so an admin can predict the next season from what they read here. */
  it("titles all four closures with their rule", () => {
    assert.match(FLAT, /title="In einer abgeschlossenen Saison lässt sich kein Team mehr ersetzen"/);
    assert.match(FLAT, /title="Ersetzen lässt sich nur ein Team, das in dieser Saison steht"/);
    assert.match(FLAT, /title="Nachrücken kann nur ein Team, das in dieser Saison noch nicht dabei und nicht stillgelegt ist"/);
  });

  /* Dictated verbatim, and the whole callout: a situation title above it, or a body under it, is the
     failure this pins. */
  it("carries the dictated closure as its title alone, without a trailing stop", () => {
    assert.match(FLAT, /title="Nur Teams, die noch kein Spiel gespielt haben, können ersetzt werden"\s*\/>/);
    assert.doesNotMatch(PANEL, /Die Saison ist zu weit|und das trifft auf keines mehr zu/);
  });
});
