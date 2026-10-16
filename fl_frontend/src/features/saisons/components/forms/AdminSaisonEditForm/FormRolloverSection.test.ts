import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { SPIELTAGE_UNDATED } from "@/features/saisons/constants.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { assertLeer } from "@/shared/testing/leerGrade.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { PLACEHOLDER } from "@/shared/utils/format.ts";

/** A write nobody has answered yet: no case here presses, and a real one needs a session and a backend. */
doubleActions({ modules: ["/src/features/saisons/actions.ts"], answer: () => new Promise<never>(() => undefined) });
doubleToasts();

const { FormRolloverSection } = await import("./FormRolloverSection.tsx");

type RolloverProps = Parameters<typeof FormRolloverSection>[0];

const SAISON_ID = "2026";

/** A planned season with a draw, every matchday dated, and no incumbent to be unfinished: the rollover stands open. */
const OPEN: RolloverProps = {
  saisonId: SAISON_ID,
  saisonStatus: "future",
  rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false, loeschung: null },
  hasDrawnSpiele: true,
  onBeforeActivate: () => true,
  banners: [],
};

const panel = (props: RolloverProps) => underNext(h(FormRolloverSection, props));

/**
 * The sentence a callout states under `title`, read off the render: `Callout` puts its body in the
 * element beside the title, so a body absent reads as `null` rather than as an empty string.
 */
function calloutBody(title: string): string | null {
  return screen.getByText(title).nextElementSibling?.textContent ?? null;
}

describe("the rollover panel's unfinished fixtures", () => {
  /* A knockout side the bracket has not filled stands where a club's name would, so it takes the one
     empty grade, and so does an undated fixture's open appointment. */
  it("sets an open slot and an open date in the empty-value grade", () => {
    const offen = { id: "6890a1b2c3d4e5f607190401", spielNr: 31, datum: null, paarung: { team1: "SG Alpha", team2: null } };
    const { unmount } = render(panel({ ...OPEN, rollover: { ...OPEN.rollover, outgoingSaisonId: "2025", offeneSpiele: [offen] } }));

    assert.ok(screen.getByText(/SG Alpha gegen/), "the filled side lost its name");
    assertLeer(screen.getByText(PLACEHOLDER.slot), PLACEHOLDER.slot);
    assertLeer(screen.getByText(PLACEHOLDER.datum), PLACEHOLDER.datum);
    unmount();
  });
});

describe("the rollover panel's blocked states", () => {
  /* Both closures are said in the body as well as on the control, and each names the panel that repairs
     it: the control sits a screen away from the reason (`docs/frontend/spec.md` §1.12). */
  it("states the missing Spielplan in the body and on the control", () => {
    // Undated matchdays beside the missing draw, so the case reads the ORDER rather than one closure alone.
    const { unmount } = render(panel({ ...OPEN, hasDrawnSpiele: false, rollover: { ...OPEN.rollover, hasUndatierteSpieltage: true } }));

    assert.match(calloutBody("Diese Saison hat noch keinen Spielplan") ?? "", /Abschnitt Spielplan/);
    closedControl(`Auf Saison ${SAISON_ID} umstellen`, /Abschnitt Spielplan/);
    // `ok` rather than `equal` on an element: a failure's report inspects both sides, and a jsdom node holds the whole window.
    assert.ok(screen.queryByText("Diese Saison hat Spieltage ohne Datum") === null, "an undrawn season is told to date its matchdays");
    unmount();
  });

  /* The declared constant rather than a copy of its words, as the control's own reason reads it: a
     sentence retyped here would part the callout from `REQ-ACTIVATE-004`. */
  it("states the undated matchdays in the body and on the control", () => {
    const { unmount } = render(panel({ ...OPEN, rollover: { ...OPEN.rollover, hasUndatierteSpieltage: true } }));

    assert.equal(calloutBody("Diese Saison hat Spieltage ohne Datum"), `${SPIELTAGE_UNDATED} Trage die Daten unter Spieltage ein.`);
    closedControl(`Auf Saison ${SAISON_ID} umstellen`, SPIELTAGE_UNDATED);
    unmount();
  });

  /* The other half of each condition: a callout standing over a season nothing blocks would refuse a
     rollover the endpoint takes. */
  it("raises neither callout while the rollover stands open", () => {
    const { unmount } = render(panel(OPEN));

    assert.ok(screen.queryByText("Diese Saison hat Spieltage ohne Datum") === null);
    assert.ok(screen.queryByText("Diese Saison hat noch keinen Spielplan") === null);
    assert.equal(screen.getByRole("button", { name: `Auf Saison ${SAISON_ID} umstellen` }).getAttribute("aria-disabled"), null);
    unmount();
  });
});

/** The planned season with an incumbent to close, and whom its activation's deletion counts. */
const mitLoeschung = (spieler: number, eingeschaltet: boolean): RolloverProps => ({
  ...OPEN,
  rollover: { ...OPEN.rollover, outgoingSaisonId: "2025", loeschung: { abgeschlosseneSaisonId: "2025", spieler, eingeschaltet } },
});

/** Every paragraph of the panel speaking of a deletion, as a reader meets it. */
const loeschungsZeilen = (): string[] =>
  screen.queryAllByText((_, element) => element?.tagName === "P" && /[Ll]ösch/.test(element.textContent)).map((element) => element.textContent);

describe("the count beside the rollover press", () => {
  /* What the operator reads before turning the switch on, and before pressing: counts only, never a name. */
  for (const [spieler, eingeschaltet, satz] of [
    [
      3,
      true,
      "Mit der Umstellung werden bis zu 3 Spielerinnen und Spieler ohne Kadereintrag seit Saison 2025 und ohne offene Registrierung gelöscht.",
    ],
    [
      1,
      true,
      "Mit der Umstellung wird höchstens eine Spielerin oder ein Spieler ohne Kadereintrag seit Saison 2025 und ohne offene Registrierung " +
        "gelöscht.",
    ],
    [
      3,
      false,
      "Die automatische Löschung ist ausgeschaltet. Eingeschaltet würde die Umstellung bis zu 3 Spielerinnen und Spieler ohne Kadereintrag " +
        "seit Saison 2025 und ohne offene Registrierung löschen.",
    ],
    [
      1,
      false,
      "Die automatische Löschung ist ausgeschaltet. Eingeschaltet würde die Umstellung höchstens eine Spielerin oder einen Spieler ohne " +
        "Kadereintrag seit Saison 2025 und ohne offene Registrierung löschen.",
    ],
  ] as const) {
    it(`states ${String(spieler)} ${eingeschaltet ? "to be deleted" : "the switched-off press would delete"} in the body`, () => {
      const { unmount } = render(panel(mitLoeschung(spieler, eingeschaltet)));

      assert.deepEqual(loeschungsZeilen(), [satz]);
      unmount();
    });
  }

  /* Nothing happens, so nothing is said: a line counting zero reads as a deletion about to happen, and the page has
     no season to count from where none closes. */
  it("says nothing where nobody is due or the activation closes no season", () => {
    for (const props of [OPEN, mitLoeschung(0, true), mitLoeschung(0, false)]) {
      const { unmount } = render(panel(props));

      assert.deepEqual(loeschungsZeilen(), []);
      unmount();
    }
  });

  /* No line also means nobody is due, and the operator reads the count before turning the switch on: a failed read
     is said rather than left to read as nobody. */
  it("says the count could not be read where its read failed", () => {
    const { unmount } = render(panel({ ...OPEN, rollover: { ...OPEN.rollover, outgoingSaisonId: "2025", loeschung: "unlesbar" } }));

    assert.deepEqual(loeschungsZeilen(), [
      "Wie viele Spielerinnen und Spieler die Umstellung löschen würde, ist gerade nicht abrufbar. Lade die Seite neu, bevor Du umstellst.",
    ]);
    unmount();
  });

  /* The confirmation repeats the count on the switch's word alone: with it off, the press deletes nobody. */
  for (const [spieler, eingeschaltet, satz] of [
    [3, true, "Dabei werden bis zu 3 Spielerinnen und Spieler endgültig gelöscht."],
    [1, true, "Dabei wird höchstens eine Spielerin oder ein Spieler endgültig gelöscht."],
    [3, false, null],
  ] as const) {
    it(`${satz === null ? "promises no deletion" : "states the deletion"} in the confirmation with ${String(spieler)} due and the switch ${eingeschaltet ? "on" : "off"}`, async () => {
      const user = userEvent.setup();
      const { unmount } = render(panel(mitLoeschung(spieler, eingeschaltet)));

      await user.click(screen.getByRole("button", { name: `Auf Saison ${SAISON_ID} umstellen` }));
      await screen.findByRole("button", { name: `Ja, auf ${SAISON_ID} umstellen` });
      const bestaetigung = [...screen.getByRole("alert").querySelectorAll("p")].map((absatz) => absatz.textContent);

      assert.deepEqual(
        bestaetigung.filter((absatz) => absatz.includes("gelöscht")),
        satz === null ? [] : [satz],
      );
      unmount();
    });
  }
});
