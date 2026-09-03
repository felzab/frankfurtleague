import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderTree } from "@/shared/testing/renderTest.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

import type { FLSaisonPhase } from "@/features/saisons/schemas.ts";
import type { FLSpiel, FLSpielQuelle } from "@/features/spiele/schemas.ts";
import type { SpielBanner } from "./banners.ts";

const { FormTeamPicker } = await import("./FormTeamPicker.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { SpielExpectedProvider } = await import("./SpielExpectedContext.tsx");

/**
 * The picker's own text, for the two claims no markup carries: `disabledKeys` is consumed by
 * react-aria and never painted, and the pick handler's answer is a change to the draft.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormTeamPicker.tsx"), "utf8");

/** The rule's other half: the picker drops the row, and the editor feeds the banner saying why. */
const EDITOR = readFileSync(path.resolve(import.meta.dirname, "AdminEditSpielDataForm.tsx"), "utf8");

const SAISON = "6890a1b2c3d4e5f607182900";

/** Only what the picker reads off a fixture: its round, its season, and the source each side stores. */
const spiel = (spielNr: number, phase: FLSaisonPhase, quelle: FLSpielQuelle | null = null): FLSpiel =>
  ({
    id: `spiel-${String(spielNr)}`,
    saison_id: SAISON,
    spiel_nr: spielNr,
    saison_phase: phase,
    team1: null,
    team2: null,
    team1_quelle: quelle,
    team2_quelle: null,
  }) as FLSpiel;

const HALBFINALE = spiel(3, "halbfinale");
const ACHTELFINALE = spiel(1, "achtelfinale");

/* One fixture in two seasons. Four qualifiers open the bracket at the Halbfinale and sixteen open it
   three rounds earlier, so the pair is what a rule spelling a round name cannot answer both ways. */
const BRACKET_OF_4 = [HALBFINALE, spiel(4, "finale")];
const BRACKET_OF_16 = [ACHTELFINALE, spiel(2, "viertelfinale"), HALBFINALE, spiel(4, "finale")];

const GRUPPE_PLATZ: FLSpielQuelle = { type: "gruppe", gruppe: "A", platz: 1 };

/** Fed to the picker in place of the editor's own list, so what a reader meets is this file's. */
const HERKUNFT_BANNER: SpielBanner = {
  id: "spiel.team1-seed-closed",
  severity: "info",
  raisedBy: "state",
  title: "Ein Hinweis an der Herkunft",
  inline: "team1-herkunft",
};

/** No descriptor for any of these paths, which is the state the picker stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

type PickerProps = Parameters<typeof FormTeamPicker>[0];

const PICKER: PickerProps = {
  label: "Team 1",
  fieldName: "team1",
  teams: [],
  numberOfGroups: 2,
  teamPayload: null,
  onTeamChange: () => undefined,
  quelle: null,
  onQuelleChange: () => undefined,
  spielData: HALBFINALE,
  saisonSpiele: BRACKET_OF_4,
  usedQuelleKeys: new Set(),
  spieltagOccupancy: new Map(),
  knockoutTeamIds: new Set(),
  otherDraftQuelle: null,
  onValidateSelection: () => undefined,
  banners: [],
};

const markup = (props: Partial<PickerProps>): string =>
  renderTree(
    h(DraftStatusProvider, {
      status: STATUS,
      children: h(SpielExpectedProvider, { expected: [], children: h(FormTeamPicker, { ...PICKER, ...props }) }),
    }),
  );

/** The `<select>` react-aria mirrors one Autocomplete into, named by the payload path it writes. */
const nativeSelect = (html: string, name: string): string =>
  new RegExp(`<select [^>]*name="${name.replaceAll(".", "\\.")}".*?</select>`, "s").exec(html)?.[0] ?? "";

/**
 * The rows one control offers, in the order it lists them and as a reader hears each announced. The
 * empty member is react-aria's own stand-in for no selection rather than a row anybody wrote.
 */
const options = (html: string, name: string): { value: string; text: string }[] =>
  [...nativeSelect(html, name).matchAll(/<option value="([^"]*)"[^>]*>(.*?)<\/option>/g)]
    .map(([, value, text]) => ({ value: value ?? "", text: text ?? "" }))
    .filter((option) => option.value !== "");

const quelleValues = (html: string): string[] => options(html, "team1_quelle.type").map((option) => option.value);

const selectedIn = (html: string, name: string): string => /<option value="([^"]*)"[^>]*selected=""/.exec(nativeSelect(html, name))?.[1] ?? "";

const isClosed = (html: string, name: string): boolean => /<select [^>]*\sdisabled=""/.test(nativeSelect(html, name));

describe("the Herkunft picker's group placing", () => {
  /* The floor for every absence below, which a picker rendering nothing at all would satisfy. */
  it("renders a Herkunft control on a knockout fixture", () => {
    assert.ok(quelleValues(markup({})).includes("manuell"), "the picker offers no source at all");
  });

  /* A bracket of four opens at the Halbfinale and one of sixteen at the Achtelfinale, so a rule
     spelling a round would be wrong for one of the two. */
  it("keys off the season's own rounds rather than a phase name", () => {
    assert.ok(quelleValues(markup({ saisonSpiele: BRACKET_OF_4 })).includes("gruppe"), "the round the bracket opens on may not be seeded");
    assert.ok(!quelleValues(markup({ saisonSpiele: BRACKET_OF_16 })).includes("gruppe"), "a Halbfinale three rounds in may be seeded");

    // The same fixture answered both ways, which no rule naming its round can do.
    assert.ok(quelleValues(markup({ spielData: ACHTELFINALE, saisonSpiele: BRACKET_OF_16 })).includes("gruppe"));
  });

  /* The round the bracket opens on is the one with no feeder, so the clause listing the match
     sources decides this one read the other way round. */
  it("lists the row only where a group placing may seed the round", () => {
    assert.deepEqual(quelleValues(markup({})), ["gruppe", "manuell"]);
    assert.deepEqual(quelleValues(markup({ saisonSpiele: BRACKET_OF_16 })), ["sieger", "verlierer", "manuell"]);
  });

  /* Gone rather than closed: an answer out of reach on every round after the first is a row with no
     use, and the banner beneath carries the reason for the one fixture that still holds one. */
  it("renders no closed row and no reason beside one", () => {
    const later = markup({ saisonSpiele: BRACKET_OF_16 });

    // A row closed rather than dropped is still a row here, every offered member being mirrored into
    // the select whether or not it can be picked. "(Empfohlen)" is the one note a row may carry.
    for (const { text } of options(later, "team1_quelle.type")) assert.match(text, /^[^(]+( \(Empfohlen\))?$/, `the row is annotated: ${text}`);
    assert.doesNotMatch(later, /nur in der ersten KO-Runde/, "the picker restates the banner's sentence at the row");

    /* `disabledKeys` reaches no markup, so the picker's one closed list is read off the file instead:
       a second one is the greyed group placing back by the other route. */
    const closedLists = [...SOURCE.matchAll(/disabledKeys=\{(.+?)\}/g)].map(([, keys]) => keys);

    assert.deepEqual(closedLists, ["disabledTeamKeys"], "a Herkunft row is closed rather than absent");
  });

  /* The list is a rendering, and a keyboard pick or a list a render old reaches past what it shows.
     Read off the file: what the handler resolves against decides a change to the draft, not a paint. */
  it("re-reads the list on the pick", () => {
    assert.match(SOURCE, /availableChoices\.find\(\(item\) => item\.key === \(key\?\.toString\(\) \?\? "manuell"\)\)/);
  });

  /* The side's readout, never an offer: listed while it IS the choice and gone the moment the choice
     moves, so re-picking it can only re-send the value `REQ-WIRING-002` already takes back. */
  it("keeps the row for a side that already holds one", () => {
    const wired = markup({ saisonSpiele: BRACKET_OF_16, quelle: GRUPPE_PLATZ });

    assert.deepEqual(quelleValues(wired), ["sieger", "verlierer", "gruppe", "manuell"]);
    assert.equal(selectedIn(wired, "team1_quelle.type"), "gruppe", "the picker reads the side as wired to something else");
  });

  /* `REQ-WIRING-002` refuses a save that moves a source into the shape, whatever the fixture already
     stores, so a derivation reading the stored value would reopen the controls below. */
  it("keeps the derivation off the stored source", () => {
    const stored = markup({
      saisonSpiele: BRACKET_OF_16,
      spielData: spiel(3, "halbfinale", GRUPPE_PLATZ),
      quelle: GRUPPE_PLATZ,
    });

    assert.ok(isClosed(stored, "team1_quelle.gruppe"), "a stored group placing reopens the group");
    assert.ok(isClosed(stored, "team1_quelle.platz"), "a stored group placing reopens the placing");
  });

  /* The absent row decides only the TYPE. Left open, the group and the placing each offer a change
     to the very shape the endpoint refuses. */
  it("closes the group and the placing for a side wired past that round", () => {
    const later = markup({ saisonSpiele: BRACKET_OF_16, quelle: GRUPPE_PLATZ });

    assert.ok(isClosed(later, "team1_quelle.gruppe"), "the group control stays open");
    assert.ok(isClosed(later, "team1_quelle.platz"), "the placing control stays open");
    // The source control is how the side is moved off the shape, so closing it with them strands the fixture.
    assert.ok(!isClosed(later, "team1_quelle.type"), "the derivation reaches the control that repairs the wiring");

    // The same draft on the round a group placing may seed, or a control closed everywhere proves nothing.
    const opening = markup({ quelle: GRUPPE_PLATZ });

    assert.ok(!isClosed(opening, "team1_quelle.gruppe"), "the group is closed on the round it seeds");
    assert.ok(!isClosed(opening, "team1_quelle.platz"), "the placing is closed on the round it seeds");
  });

  /* Closed, not dropped: the stored placing is the only readout of what this side is wired to, and
     an admin who cannot see it cannot tell which repair to make. */
  it("keeps the stored placing on screen while it is closed", () => {
    const closed = markup({ saisonSpiele: BRACKET_OF_16, quelle: GRUPPE_PLATZ });

    assert.equal(selectedIn(closed, "team1_quelle.gruppe"), "A", "the group this side is wired to is off the screen");
    assert.equal(selectedIn(closed, "team1_quelle.platz"), "1", "the placing this side is wired to is off the screen");
  });

  /* The two controls under the row carry no reason of their own, and the row itself is gone, so the
     rule stands where the reader meets it. */
  it("carries a banner at the source control", () => {
    const shown = markup({ banners: [HERKUNFT_BANNER] });

    assert.ok(shown.includes(HERKUNFT_BANNER.title), "the editor's reason never reaches the picker");
    assert.ok(shown.indexOf(HERKUNFT_BANNER.title) > shown.indexOf('name="team1_quelle.type"'), "the reason stands above the control");

    // Per side, or one side's picker answers for the other side's wiring.
    assert.ok(!markup({ fieldName: "team2", label: "Team 2", banners: [HERKUNFT_BANNER] }).includes(HERKUNFT_BANNER.title));
  });

  /* One derivation behind both, or the picker closes a control the banner beneath it denies is
     closed at all. Two files agreeing, which is what neither one's markup can show. */
  it("feeds that banner the derivation the picker closes on", () => {
    assert.match(EDITOR, /seedsFromTheGroups: isFirstKnockoutRound\(saisonSpiele, spielData\)/);
  });
});
