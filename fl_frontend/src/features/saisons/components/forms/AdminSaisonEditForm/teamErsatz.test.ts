import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Source text rather than a render: the repository has no DOM runner, and every claim below is about
 * the words a panel puts in front of an admin or the order of two statements inside a press handler
 * — neither of which any exported value carries.
 */
const PANEL = readFileSync(path.resolve(import.meta.dirname, "FormTeamErsatzSection.tsx"), "utf8");

function sliceBetween(from: string, to: string): string {
  const start = PANEL.indexOf(from);
  const end = PANEL.indexOf(to, start + from.length);

  return start === -1 || end === -1 ? "" : PANEL.slice(start, end);
}

const HANDLER = sliceBetween("const handleReplace = () => {", "// Rendered only while");
const ARMED = sliceBetween("Bist Du Dir sicher?", '<div className="flex w-full flex-col gap-y-1.5">');

describe("the replacement panel", () => {
  /* First, because a boundary string that stopped matching leaves a slice empty and every assertion
     over it would then pass or fail for something that is not the defect. */
  it("cuts the handler and the armed alert out of the file before reading them", () => {
    assert.ok(HANDLER.includes("replaceSaisonTeamAction("), "the write is outside the handler's slice");
    assert.ok(ARMED.includes("Angesetzte Spiele"), "the armed alert's readout is outside its slice");
  });

  /* The draw deletes what it replaces and says so; this endpoint deletes nothing. Borrow that
     register here and the panel asks an admin to agree to a loss that will not happen. */
  it("promises the schedule survives, and never borrows the draw's deletion register", () => {
    assert.match(PANEL, /Kein Spiel wird\s+gelöscht, keines verschoben/);
    assert.doesNotMatch(PANEL, /gehen dabei verloren|Zurückholen lässt sich/);
  });

  /* What the press actually moves, all four. A confirmation exists to state the consequences an
     admin cannot predict, and the Austritt and the squad are exactly those two. */
  it("names the group, the fixtures, the austritt and the squad before the write", () => {
    assert.match(ARMED, /Platz in der Saison/);
    assert.match(ARMED, /Angesetzte Spiele/);
    assert.match(ARMED, /Austritt von/);
    assert.match(ARMED, /ausgetragen/);
  });

  /* AUSTRAGEN is what happens to a squad row, STILLLEGEN to the person across the whole league. The
     endpoint stamps `saison_spieler` and touches no `spieler` document, so the second word would tell
     an admin that these pupils had just left every season there is. The same press's toast is held to
     the same word by `fl_frontend/src/features/teams/utils.test.ts :: describeReplacementUmfang`.
     The rows are stamped rather than removed, so a deletion word is wrong in the other direction. */
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
    assert.match(PANEL, /Zurücknehmen lässt sich der Wechsel in der Verwaltung nicht/);
  });

  /* The swap's and the draw's shape: two presses, and the second one writes. Without the arming
     branch ahead of the write the alert never renders and one press is the whole confirmation. */
  it("arms in place before it writes, and announces the armed state", () => {
    const arming = HANDLER.indexOf("if (!isConfirming)");
    const writing = HANDLER.indexOf("startReplacing(");

    assert.ok(arming !== -1, "no arming branch in handleReplace");
    assert.ok(arming < writing, "the first press writes, so the alert below it is never read");
    assert.match(PANEL, /role="alert"/);
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
    assert.match(PANEL, /Die Saison ist abgeschlossen/);
  });
});
