import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `oneWayGuards.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormSpielplanRuecknahmeSection.tsx"), "utf8");

/** The action file, for the one claim that is about two sites agreeing rather than about this panel. */
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "actions.ts"), "utf8");

/**
 * JSX's line breaks and its `{" "}` joins collapsed. **Every copy assertion reads this and not the
 * raw file**: Prettier rewraps a text node at will, so a sentence asserted as written would fail on a
 * reformat that changed nothing a reader sees.
 */
const flatten = (jsx: string): string => jsx.replaceAll('{" "}', " ").replace(/\s+/g, " ");

/**
 * The armed alert alone — what this panel puts INSIDE the shared shell. The heading, the announcement
 * and the reveal itself belong to `ConfirmReveal` and are asserted at its own home.
 */
const ARMED = flatten((SOURCE.split("<ConfirmReveal>")[1] ?? "").split("</ConfirmReveal>")[0] ?? "");

/** The panel's own hint, where the conditions on an undraw are spelled out for a reader. */
const HINWEIS = flatten((SOURCE.split("Hinweis zum Zurücknehmen")[1] ?? "").split("</InfoHint>")[0] ?? "");

/** The press handler alone, up to the markup that follows it. */
const HANDLER = (SOURCE.split("const handleUndraw = () => {")[1] ?? "").split("return (")[0] ?? "";

describe("the undraw panel", () => {
  /* First, because a boundary string that stopped matching leaves the slices empty and every
     assertion over them would then fail for something that is not the defect. */
  it("cuts the armed alert, the hint and the handler out of the file before reading them", () => {
    assert.ok(ARMED.includes("Was dabei gelöscht wird"), "the armed alert's readout is outside its slice");
    assert.ok(HINWEIS.includes("<li>"), "the hint's list is outside its slice");
    assert.ok(HANDLER.includes("undrawSpielplanAction("), "the write is outside the handler's slice");
    assert.ok(!HANDLER.includes("<section"), "the handler's slice runs on into the markup");
  });

  /* Two presses, and the second one writes. Call the action outside `press` and one press is the whole
     confirmation, on a write nothing reverses — the arming itself is `useTwoPressConfirm`'s to keep. */
  it("sends the write through the two-press control, and announces the armed state", () => {
    const arming = HANDLER.indexOf("press(async () => {");
    const writing = HANDLER.indexOf("undrawSpielplanAction(");

    assert.ok(arming !== -1, "handleUndraw no longer presses through useTwoPressConfirm");
    assert.ok(arming < writing, "the write stands outside the armed branch");
    assert.match(SOURCE, /<ConfirmReveal>/);
  });

  /* Drop the flag from the button and a second press during the request sends a second DELETE. The
     first would have removed everything, so the second reports a season that held nothing. */
  it("closes the control while its own request is in flight", () => {
    assert.match(SOURCE, /isDisabled=\{isUndrawing \|\| blockedReason !== null\}/);
  });

  /* `watermark_cleared` is in the predicate because a season can hold the watermark with no rows
     behind it, and clearing that is work. */
  it("grades a response that removed nothing apart, rather than as a failure", () => {
    assert.match(HANDLER, /res\.undraw\.spieltage === 0 && res\.undraw\.spiele === 0 && !res\.undraw\.watermark_cleared/);
    assert.match(HANDLER, /removedNothing \? appToast\.info : appToast\.success/);
    assert.doesNotMatch(HANDLER, /removedNothing \? appToast\.danger/);
  });

  /* The loss before anything else: what this press destroys is the part of it that cannot be looked
     up again afterwards, and the scheduling is the half no refusal protects. */
  it("names the matchdays, the fixtures and the scheduling the press destroys", () => {
    for (const named of [/Spieltage/, /Spiele/, /Termin/, /Uhrzeit/]) {
      assert.match(ARMED, named);
    }
  });

  /* Soften this to "der Spielplan wird zurückgesetzt" and this fails. Nothing writes the removed rows
     back: `/spiele` has neither a create nor a delete, and the log's images are a record to read. */
  it("states in the armed alert that the removal cannot be taken back", () => {
    assert.match(ARMED, /Zurückholen lässt sich der alte in der Verwaltung nicht/);
  });

  /* Wire an undo here and this fails, for the draw's reason: there is no endpoint to replay the
     removed matchdays and fixtures into, so an offer would promise a restore that cannot run. */
  it("offers no undo beside a write that has none", () => {
    assert.doesNotMatch(SOURCE, /actionProps/);
    assert.doesNotMatch(SOURCE, /Rückgängig machen|children: "Rückgängig"/);
  });

  /* The shared sentence and never a copy of it: six call sites spell this list, and the categories
     themselves are pinned by `fl_frontend/src/features/saisons/utils.test.ts`. */
  it("renders the shared list rather than spelling its own", () => {
    assert.match(HINWEIS, /\{RECORDED_FACTS_NONE\}/);
    assert.doesNotMatch(HINWEIS, /kein Ergebnis/, "the panel spells the list a second time");
  });

  /* This press is the first half of the repair `REQ-RULES-011` sends an admin on, so the panel names
     the two places the second half happens. Drop either and the loop stops at the removal. */
  it("names both places the reopened shape is changed before the redraw", () => {
    assert.match(HINWEIS, /im Abschnitt <strong>Regeln<\/strong> wieder einzeln ändern/);
    assert.match(HINWEIS, /über die <strong>Teamseite<\/strong>/);
  });

  /* Two sites, one verb: `REQ-RULES-011`'s message tells an admin to take the Spielplan back, and
     this control is what they then go looking for. Rename either alone and this fails. */
  it("carries the verb the rules refusal sends the admin looking for", () => {
    assert.match(ACTIONS, /Nimm dafür zuerst den Spielplan zurück/);
    assert.match(SOURCE, /"Spielplan zurücknehmen"/);
    assert.match(SOURCE, /"Ja, Spielplan zurücknehmen"/);
  });

  /* Leave the armed label at "Ja, zurücknehmen" and this fails: on a danger panel a bare verb is
     agreed to without the reader having to hold what it refers to. */
  it("keeps the object in the label on both presses", () => {
    const labels = SOURCE.match(/"(Ja, )?Spielplan zurücknehmen"/g) ?? [];
    assert.equal(labels.length, 2, "the two presses no longer name the Spielplan");
  });

  /* `DisabledHint` opens on hover and on focus alone, so a reader who never points at a closed button
     would otherwise never learn why. Both readers get the same sentence, from one source. */
  it("puts the reason in the body as well as on the control", () => {
    assert.match(SOURCE, /<p className="fluid-sm text-foreground-muted font-medium">\{blockedReason\}<\/p>/);
    assert.match(SOURCE, /<DisabledHint reason=\{isUndrawing \? null : blockedReason\}>/);
  });
});
