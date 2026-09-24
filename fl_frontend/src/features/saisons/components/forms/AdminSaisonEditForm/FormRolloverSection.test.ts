import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { SPIELTAGE_UNDATED } from "@/features/saisons/constants.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

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
  rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false },
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
