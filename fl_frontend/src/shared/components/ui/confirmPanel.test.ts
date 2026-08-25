import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `useTwoPressConfirm.test.ts`'s idiom and for its reason. */
const read = (file: string): string => readFileSync(path.resolve(import.meta.dirname, file), "utf8");

const REVEAL = read("ConfirmReveal.tsx");
const ACTION_ROW = read("ConfirmActionRow.tsx");
const READOUT_ROW = read("ConfirmReadoutRow.tsx");

/** Every panel that escalates a press in place. Each renders the shell rather than spelling one. */
const PANELS = [
  "../../../features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx",
  "../../../features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanRuecknahmeSection.tsx",
  "../../../features/saisons/components/forms/AdminSaisonEditForm/FormTeamErsatzSection.tsx",
  "../../../features/saisons/components/forms/AdminSaisonEditForm/FormGruppenSwapSection.tsx",
  "../../../features/saisons/components/forms/AdminSaisonEditForm/FormRolloverSection.tsx",
  "../../../features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx",
  "../../../features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx",
  "../../../features/spieler/components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx",
];

describe("the armed reveal", () => {
  /* The one mechanism the eight panels share. Without it the only signal that the next press became
     irreversible is the button label quietly changing, which no assistive technology announces. */
  it("announces itself as an alert and says so in words", () => {
    assert.match(REVEAL, /role="alert"/);
    assert.match(REVEAL, /Bist Du Dir sicher\?/);
  });

  /* Tier 3, a section unfolding inside a page already in view — spelled as the shared token so the
     app's one motion vocabulary reaches it, and so reduced motion reaches it too. */
  it("reveals through the shared motion token rather than its own classes", () => {
    assert.match(REVEAL, /\$\{PANEL_REVEAL\}/);
    assert.doesNotMatch(REVEAL, /animate-in/, "the reveal spells a motion class beside the token");
  });

  /* One gap for all eight. A prop here would be a variant prop under another name, which `ADR-0005`
     and CLAUDE.md section 7 both refuse for exactly this shape. */
  it("takes no variant of any kind", () => {
    assert.match(REVEAL, /flex flex-col gap-4/);
    assert.doesNotMatch(REVEAL, /\bvariant\b|\bgap\?:|\btone\b/, "the shell grew a knob");
  });
});

describe("the armed action row", () => {
  /* A standing „Abbrechen“ beside an unarmed control offers to cancel nothing, so the cancel is the
     armed state's and appears with it. */
  it("renders the cancel with the armed state and never before it", () => {
    assert.match(ACTION_ROW, /\{isConfirming && \(/);
    assert.match(ACTION_ROW, /Abbrechen/);
  });

  /* Closed rather than hidden: a control vanishing mid-press reflows the row under the pointer, and
     a second cancel during the request would disarm a write already sent. */
  it("closes the cancel while the write is in flight", () => {
    assert.match(ACTION_ROW, /isDisabled=\{isPending\}/);
  });

  /* The app's one cancel treatment. Spell the classes here and this row drifts from every other
     form's pair the first time `formButton` moves. */
  it("takes the cancel's fill from the shared intent", () => {
    assert.match(ACTION_ROW, /formButton\(\{ intent: "cancel" \}\)/);
  });
});

describe("the readout row", () => {
  /* A `<dt>`/`<dd>` pair and not two spans: the pair is what makes the value a fact about the label
     rather than two strings sharing a line. */
  it("renders a description pair", () => {
    assert.match(READOUT_ROW, /<dt /);
    assert.match(READOUT_ROW, /<dd /);
  });
});

describe("the eight panels", () => {
  /* The whole point of the extraction. A panel spelling the shell again is one that drifts from the
     other seven the next time any of the three moves. */
  it("render the shared mechanism rather than spelling their own", () => {
    assert.ok(PANELS.length === 8, "the roster no longer names all eight panels");

    for (const file of PANELS) {
      const source = read(file);

      assert.match(source, /<ConfirmReveal>/, `${file}: does not render the shared reveal`);
      assert.match(source, /<ConfirmActionRow/, `${file}: does not render the shared action row`);
      assert.match(source, /confirmButton\(isConfirming\)/, `${file}: grades its own armed fill`);
      assert.doesNotMatch(source, /role="alert"/, `${file}: spells its own alert`);
      assert.doesNotMatch(source, /Bist Du Dir sicher/, `${file}: spells its own announcement`);
      // The armed state alone. A panel may still hold its own `useTransition` for a one-press write
      // beside the two-press control — `FormSaisonSection`'s season entry is exactly that.
      assert.doesNotMatch(source, /setIsConfirming/, `${file}: keeps its own armed state`);
    }
  });
});
