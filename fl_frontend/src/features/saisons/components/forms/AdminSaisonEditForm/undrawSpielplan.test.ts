import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `oneWayGuards.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormSpielplanSection.tsx"), "utf8");

/** The action file, for the one claim that is about two sites agreeing rather than about this panel. */
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "actions.ts"), "utf8");

/**
 * JSX's line breaks and its `{" "}` joins collapsed. **Every copy assertion reads this and not the
 * raw file**: Prettier rewraps a text node at will, so a sentence asserted as written would fail on a
 * reformat that changed nothing a reader sees.
 */
const flatten = (jsx: string): string => jsx.replaceAll('{" "}', " ").replace(/\s+/g, " ");

/** The armed alert alone: the shell's own parts are asserted at `ConfirmReveal`'s home. */
const ARMED = flatten((SOURCE.split("<ConfirmReveal>")[1] ?? "").split("</ConfirmReveal>")[0] ?? "");

/** The panel's own hint, which stands in the heading and ends with it. */
const HINWEIS = flatten((SOURCE.split("Hinweis zum Spielplan")[1] ?? "").split("</h2>")[0] ?? "");

/** The whole file, flattened for the two claims that span a line break Prettier is free to move. */
const FLAT = flatten(SOURCE);

/** The press handler alone, up to the markup that follows it. Both writes live inside it. */
const HANDLER = (SOURCE.split("const handlePress = () => {")[1] ?? "").split("return (")[0] ?? "";

/** The undraw's branch of that handler, which is the half this file is about. */
const UNDRAW_BRANCH = (HANDLER.split("} else {")[1] ?? "").split("\n      }")[0] ?? "";

describe("the undraw half of the Spielplan panel", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the armed alert, the hint and the handler out of the file before reading them", () => {
    assert.ok(ARMED.includes("Was dabei gelöscht wird"), "the armed alert's readout is outside its slice");
    assert.ok(HINWEIS.includes("points: ["), "the hint's bullets are outside its slice");
    assert.ok(HANDLER.includes("undrawSpielplanAction("), "the write is outside the handler's slice");
    assert.ok(!HANDLER.includes("<section"), "the handler's slice runs on into the markup");
    assert.ok(UNDRAW_BRANCH.includes("undrawSpielplanAction("), "the undraw's branch is outside its slice");
  });

  /* Two presses, and the second one writes. Call the action outside `press` and one press is the whole
     confirmation, on a write nothing reverses — the arming itself is `useTwoPressConfirm`'s to keep. */
  it("sends the write through the two-press control, and announces the armed state", () => {
    const arming = HANDLER.indexOf("press(async () => {");
    const writing = HANDLER.indexOf("undrawSpielplanAction(");

    assert.ok(arming !== -1, "handlePress no longer presses through useTwoPressConfirm");
    assert.ok(arming < writing, "the write stands outside the armed branch");
    assert.match(SOURCE, /<ConfirmReveal>/);
  });

  /* Read the operation from anything but the panel's own resolution and the two writes come apart:
     the button label, the reveal and the request would each be free to describe a different one. */
  it("picks the write off the resolved operation rather than off a second condition", () => {
    assert.match(SOURCE, /const isDrawing = operation === "anlegen";/);
    assert.match(HANDLER, /if \(isDrawing\) \{/);
  });

  /* Drop the flag from the button and a second press during the request sends a second DELETE. The
     first would have removed everything, so the second reports a season that held nothing. */
  it("closes the control while its own request is in flight", () => {
    assert.match(SOURCE, /isDisabled=\{isWriting \|\| closedReason !== null\}/);
  });

  /* `watermark_cleared` is in the predicate because a season can hold the watermark with no rows
     behind it, and clearing that is work. */
  it("grades a response that removed nothing apart, rather than as a failure", () => {
    assert.match(UNDRAW_BRANCH, /res\.undraw\.spieltage === 0 && res\.undraw\.spiele === 0 && !res\.undraw\.watermark_cleared/);
    assert.match(UNDRAW_BRANCH, /removedNothing \? appToast\.info : appToast\.success/);
    assert.doesNotMatch(UNDRAW_BRANCH, /removedNothing \? appToast\.danger/);
  });

  /* The loss before anything else: what this press destroys is the part of it that cannot be looked
     up again afterwards, and the scheduling is the half no refusal protects. Asserted on the readout
     rather than on prose, because the figures are what an admin weighs. */
  it("reads out the matchdays, the fixtures and the scheduling the press destroys", () => {
    assert.match(ARMED, /label="Bisher angelegt" value=\{describeSpielplanUmfang\(spieltageCount, bestand\.spiele\)\}/);
    assert.match(ARMED, /label="Mit Termin oder Uhrzeit" value=\{describeAngesetzteSpiele\(bestand\.angesetzt\)\}/);
  });

  /* Soften this to "der Spielplan wird zurückgesetzt" and this fails. Nothing writes the removed rows
     back: `/spiele` has neither a create nor a delete, and the log's images are a record to read. */
  it("states in the armed alert that the removal cannot be taken back", () => {
    assert.match(ARMED, /Es gibt in der Verwaltung keinen Weg zurück\./);
  });

  /* The words, not the counts above them: softening this to "der Spielplan wird ersetzt" leaves the
     figures rendered and the losses unnamed, which nothing else here would catch. */
  it("names the matchdays and the fixtures the press deletes", () => {
    assert.match(ARMED, /Die Spieltage und Spiele oben werden dabei gelöscht\./);
  });

  /* Wire an undo here and this fails, for the draw's reason: there is no endpoint to replay the
     removed matchdays and fixtures into, so an offer would promise a restore that cannot run. */
  it("offers no undo beside a write that has none", () => {
    assert.doesNotMatch(SOURCE, /actionProps/);
    assert.doesNotMatch(SOURCE, /Rückgängig machen|children: "Rückgängig"/);
  });

  /* This press is the first half of the repair `REQ-RULES-011` sends an admin on, so the panel names
     the two places the second half happens. Drop either and the loop stops at the removal. */
  it("names both places the reopened shape is changed before the redraw", () => {
    assert.match(HINWEIS, /im Abschnitt Regeln/);
    assert.match(HINWEIS, /über die Teamseite/);
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

  /* A refusal hint opens on hover and on focus alone, so a reader who never points at a closed
     button would otherwise never learn why — except where the callout states the rule already.
     One flag decides both, or the two states come apart. */
  it("puts the reason in the body as well as on the control, and drops it only where the callout states it", () => {
    assert.match(SOURCE, /const isClosureCalledOut = holdsADraw && saisonStatus === "active";/);
    assert.match(FLAT, /\{isClosureCalledOut && \( <Callout/);
    assert.match(FLAT, /!isClosureCalledOut && <p className="muted-hint">\{closedReason\}<\/p>/);
    assert.match(SOURCE, /mode="refusal"\s+reason=\{isWriting \? null : closedReason\}/);
  });
});

describe("the operation picker the two writes share", () => {
  /* The whole reason one panel can hold both: on a drawn planned season each write is open and each
     destroys the same rows, so a default would arm the operation the admin never read. */
  it("offers the picker only where both writes are open, and preselects neither", () => {
    assert.match(SOURCE, /const bothOpen = drawBlockedReason === null && undrawBlockedReason === null;/);
    assert.match(SOURCE, /useState<SpielplanOperation \| null>\(null\)/);
    assert.match(SOURCE, /\{bothOpen && \(\s*<ToggleButtonGroup/);
    assert.match(SOURCE, /selectedKeys=\{picked === null \? \[\] : \[picked\]\}/);
  });

  /* Switch under an armed panel without this and the second press confirms an operation the reveal
     above it never described. */
  it("disarms the confirmation whenever the choice moves", () => {
    const onChange = (SOURCE.split("onSelectionChange={(keys: Set<Key>) => {")[1] ?? "").split("}}")[0] ?? "";

    assert.ok(onChange.includes("cancel();"), "a switch leaves the previous operation armed");
    assert.ok(onChange.indexOf("cancel();") < onChange.indexOf("setPicked("), "the arming survives the switch that replaced it");
  });

  /* Nothing chosen is not nothing to say: the prompt rides the same channel a refusal does, so the
     closed control and the body below it cannot describe the state differently. */
  it("closes the control while nothing is chosen, through the reason both readers get", () => {
    assert.match(SOURCE, /bothOpen && picked === null\s*\?\s*`Beides löscht/);
    assert.match(SOURCE, /Wähle oben aus, was passieren soll\./);
  });

  /* A first draw destroys nothing, so a danger panel over it would grade the additive case as the
     destructive one and spend the treatment the replace needs. */
  it("grades the panel off what the season holds rather than off the operation", () => {
    assert.match(SOURCE, /const isDestructiveOnOffer = holdsADraw && \(drawBlockedReason === null \|\| undrawBlockedReason === null\);/);
    assert.match(SOURCE, /formPanel\(\{ tone: isDestructiveOnOffer \? "danger" : "neutral" \}\)/);
  });

  /* One badge over two states, and read from the same expression the reasons are: a header saying
     "Kein Spielplan" over a control offering to replace one would be the panel contradicting itself. */
  it("states which of the two states the season is in, in the header", () => {
    assert.match(SOURCE, /const holdsADraw = spielplanHoldsADraw\(controlInput\);/);
    assert.match(SOURCE, /\$\{LABEL_BADGE\}[^`]*`}>Spielplan steht</);
    assert.match(SOURCE, /\$\{LABEL_BADGE\}[^`]*`}>Kein Spielplan</);
  });
});
