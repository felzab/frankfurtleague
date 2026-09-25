import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { fireEvent, render } from "@testing-library/react";

import { FLSpielAdminSchema, FLSpielSchema } from "@/features/spiele/schemas.ts";
import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

import type { FLSaisonPhase } from "@/features/saisons/schemas.ts";
import type { FLSpiel, FLSpielQuelle } from "@/features/spiele/schemas.ts";
import type { SpielBanner } from "./banners.ts";

// The editor asks its dry run from an effect, which a server render never runs: nothing here is answered.
doubleActions({ modules: ["/src/features/spiele/actions.ts"], answer: () => new Promise<never>(() => undefined) });

const { FormTeamPicker } = await import("./FormTeamPicker.tsx");
const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { SpielExpectedProvider } = await import("./SpielExpectedContext.tsx");

const SAISON = "2026";

// One id per match number: `feedsInto` drops the target by id, so the fixture standing in a bracket
// and the draft of that same fixture have to carry one id between them.
const spielId = (spielNr: number): string => `6890a1b2c3d4e5f6071829${String(spielNr).padStart(2, "0")}`;

/** Complete and parsed at construction: a drifted field fails where the fixture is built rather than wherever it is read. */
const SPIEL: FLSpiel = FLSpielSchema.parse({
  id: spielId(0),
  spieltag_id: "6890a1b2c3d4e5f607182990",
  team1: null,
  team2: null,
  team1_quelle: null,
  team2_quelle: null,
  datum: null,
  uhrzeit: null,
  ort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 1,
  sonderereignis: null,
  saison_phase: "halbfinale",
  saison_id: SAISON,
  notiz: null,
} satisfies FLSpiel);

const spiel = (spielNr: number, phase: FLSaisonPhase, quelle: FLSpielQuelle | null = null): FLSpiel => ({
  ...SPIEL,
  id: spielId(spielNr),
  spiel_nr: spielNr,
  saison_phase: phase,
  team1_quelle: quelle,
});

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
  });

  /* The list decides and never the event: react-aria mirrors the offered rows into a hidden native
     `<select>`, where a browser restoring a form can answer with a value outside this round's own list. */
  it("re-reads the list on a pick through the native mirror", async () => {
    const seated = (saisonSpiele: FLSpiel[]): (FLSpielQuelle | null)[] => {
      const picked: (FLSpielQuelle | null)[] = [];
      const { container, unmount } = render(
        h(DraftStatusProvider, {
          status: STATUS,
          children: h(SpielExpectedProvider, {
            expected: [],
            children: h(FormTeamPicker, { ...PICKER, saisonSpiele, onQuelleChange: (next: FLSpielQuelle | null) => void picked.push(next) }),
          }),
        }),
      );
      const mirror = container.querySelector("select[name='team1_quelle.type']") ?? assert.fail("the Herkunft picker mirrors no select");

      // Planted, because this round offers no such row: what a restored form hands back is a value the
      // list once held.
      if (!mirror.querySelector("option[value='gruppe']")) mirror.append(Object.assign(document.createElement("option"), { value: "gruppe" }));
      fireEvent.change(mirror, { target: { value: "gruppe" } });
      unmount();

      return picked;
    };

    // The control: where the round offers the row, the same pick seats a group placing.
    assert.deepEqual(
      seated(BRACKET_OF_4).map((quelle) => quelle?.type),
      ["gruppe"],
      "a pick through the mirror reaches no handler at all",
    );
    assert.deepEqual(seated(BRACKET_OF_16), [], "a value this round does not offer seats a group placing");
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
     closed at all. The editor raises the banner; the same fixture in the two seasons answers it both ways. */
  it("raises that banner from the editor exactly where the picker closes the placing", () => {
    const WIRED = spiel(3, "halbfinale", GRUPPE_PLATZ);
    const BANNER = "Ein Platz in einer Gruppe ist als Herkunft von Team 1 nur in der ersten KO-Runde wählbar";
    const editor = (saisonSpiele: FLSpiel[]): string =>
      renderTree(
        underNext(
          h(AdminEditSpielDataForm, {
            spielData: FLSpielAdminSchema.parse(WIRED),
            teams: [],
            spielorte: [],
            schiedsrichter: [],
            saisonSpiele: saisonSpiele.map((one) => (one.id === WIRED.id ? WIRED : one)),
            numberOfGroups: 2,
            isFinishedSaison: false,
            today: "2026-09-14",
            categorize: () => new Set<never>(),
            pageHeader: { title: "Spiel 3" },
          }),
          { search: "saison_id=2026" },
        ),
      );

    assert.ok(editor(BRACKET_OF_16).includes(BANNER), "a group placing past the bracket's first round raises no banner saying why");
    assert.ok(!editor(BRACKET_OF_4).includes(BANNER), "the round the bracket opens on is told a group placing is closed there");
  });
});

describe("the editor's section pickers", () => {
  /* Each names a section the payload takes as `null`, so an emptied pick is an answer, while the id
     under it is one the schema refuses empty: the mark comes from the site, not from that leaf. */
  it("stay unmarked, an emptied pick dropping its whole section", () => {
    const GRUPPENSPIEL = spiel(1, "gruppenphase");
    const host = document.createElement("div");
    host.innerHTML = renderTree(
      underNext(
        h(AdminEditSpielDataForm, {
          spielData: FLSpielAdminSchema.parse(GRUPPENSPIEL),
          teams: [],
          spielorte: [],
          schiedsrichter: [],
          saisonSpiele: [GRUPPENSPIEL],
          numberOfGroups: 2,
          isFinishedSaison: false,
          today: "2026-09-14",
          categorize: () => new Set<never>(),
          pageHeader: { title: "Spiel 1" },
        }),
        { search: "saison_id=2026" },
      ),
    );

    for (const name of ["team1.team_id", "team2.team_id", "ort.spielort_id", "schiedsrichter.schiedsrichter_id"]) {
      const control = host.querySelector(`[name="${name}"]`) ?? assert.fail(`the editor renders no ${name} picker`);
      assert.equal(control.closest('[data-required="true"]'), null, `the ${name} picker is marked required`);
    }
  });
});
