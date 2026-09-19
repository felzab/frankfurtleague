import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries the router context, and the club popover's links read it. A Next release that
   moves the module fails this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { spokenText } from "@/shared/testing/spokenText.ts";
import { PLACEHOLDER } from "@/shared/utils/format.ts";

import type { FLSpiel } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielDetailsModal } = await import("./SpielDetailsModal.tsx");

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "spielDetailsModal",
};

const HEIM = "6780e194677bfbfb5ea8396c";
const GAST = "6780e19192c4cd94b2504985";

/** The 2025 semi-final the bracket settled on penalties. */
const HALBFINALE: FLSpiel = {
  id: "6890a1b2c3d4e5f607190301",
  spieltag_id: "6890a1b2c3d4e5f607190302",
  team1: { team_id: HEIM, tore: 1, name: "Mainufer Beispiel", shorthand: "QM", austritt_type: null },
  team2: { team_id: GAST, tore: 1, name: "Musterschule Süd", shorthand: "QS", austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
  datum: "2025-09-13",
  uhrzeit: "18:00:00",
  ort: null,
  schiedsrichter: null,
  ergebnis: "1:1",
  elfmeterschiessen: { team1: 5, team2: 4 },
  spiel_nr: 13,
  sonderereignis: null,
  saison_phase: "halbfinale",
  saison_id: "2025",
  notiz: null,
};

const UNGESPIELT: FLSpiel = { ...HALBFINALE, ergebnis: null, elfmeterschiessen: null };

/** The open dialog, for a fixture of a running season unless told otherwise, and the way to take it down. */
function openDialog(spiel: FLSpiel, isFinishedSaison = false): { dialog: HTMLElement; unmount: () => void } {
  const { unmount } = render(
    h(AppRouterContext.Provider, {
      value: ROUTER,
      children: h(SpielDetailsModal, { spielData: spiel, isOpen: true, onClose: () => undefined, today: "2026-09-14", isFinishedSaison }),
    }),
  );

  return { dialog: screen.getByRole("dialog", { name: "Spiel Nr. 13" }), unmount };
}

describe("what the fixture dialog says about the result", () => {
  /* The defect: the dialog named both sides and every fact about the fixture except how it ended. */
  it("shows the score and the shoot-out between the two sides", () => {
    const text = openDialog(HALBFINALE).dialog.textContent;

    const order = ["Mainufer Beispiel", "1:1", "5:4", "Musterschule Süd"].map((part) => text.indexOf(part));
    assert.ok(
      order.every((at, index) => at !== -1 && (index === 0 || at > (order[index - 1] ?? -1))),
      `the result does not stand between the two sides: ${text}`,
    );
  });

  /* The score stands in the place of a „gegen“ for the eye alone: spoken, two names around a colon are two
     names, and a shoot-out's mark is two letters. */
  it("reads the two sides to a screen reader as a pairing, and the shoot-out's mark as its words", () => {
    for (const spiel of [HALBFINALE, UNGESPIELT]) {
      const { dialog, unmount } = openDialog(spiel);
      const gesprochen = spokenText(dialog.innerHTML, " ").replace(/\s+/g, " ");

      assert.match(gesprochen, /Mainufer Beispiel .*gegen .*Musterschule Süd/, `the sides are not read as a pairing: ${gesprochen}`);
      unmount();
    }
    assert.match(spokenText(openDialog(HALBFINALE).dialog.innerHTML, " "), /5:4\s*im Elfmeterschießen/);
  });

  // The cards' grading, so one fixture reads in one colour on the card and in the dialog it opens.
  it("tints the score as the cards do", () => {
    for (const [spiel, ink] of [
      [HALBFINALE, "text-success-strong"],
      [UNGESPIELT, "text-warning-strong"],
      [{ ...UNGESPIELT, sonderereignis: "ausgefallen" }, "text-danger-strong"],
    ] as const) {
      const { dialog, unmount } = openDialog(spiel);
      const score = within(dialog).getByText(spiel.ergebnis ?? PLACEHOLDER.ergebnis);

      assert.ok(score.className.includes(ink), `${spiel.sonderereignis ?? spiel.ergebnis ?? "unplayed"} is not graded ${ink}`);
      unmount();
    }
  });
});

describe("the names the fixture dialog sets", () => {
  // The defect: real club names were cut on one line at every width, and a club's popover carries the rest.
  it("wraps a club onto a second line and a slot label whole, clipping neither", () => {
    const { dialog } = openDialog({ ...HALBFINALE, team2: null, team2_quelle: { type: "spiel", spiel_nr: 29, ausgang: "verlierer" } });
    const club = within(dialog).getByText("Mainufer Beispiel").className;
    const label = within(dialog).getByText("Verlierer von Spiel 29").className;

    assert.match(club, /(^|\s)line-clamp-2(\s|$)/);
    assert.match(label, /(^|\s)wrap-break-word(\s|$)/);
    // A slot label has no popover to read the rest in, so nothing clamps it.
    assert.doesNotMatch(label, /line-clamp-/);
    // Any of these holds a name to one line and clips the rest.
    for (const classes of [club, label]) assert.doesNotMatch(classes, /(^|\s)(truncate|text-ellipsis|whitespace-nowrap)(\s|$)/);
  });
});

describe("the fixture dialog's cells for a fixture nobody dated", () => {
  /* The defect: 2025's Spiel 1 carried a 4:0 and no date, and the dialog promised a Termin for a match
     played a season ago. The time is in words, as the Ort and Schiedsrichter cells beside it are. */
  it("names the missing date and time in words once the fixture can no longer be played", () => {
    const { dialog } = openDialog({ ...UNGESPIELT, datum: null, uhrzeit: null }, true);

    for (const cell of ["Datum", "Uhrzeit"]) {
      assert.equal(within(dialog).getByText(cell).nextElementSibling?.textContent, PLACEHOLDER.entity, `the ${cell} cell promises more`);
    }
  });
});

describe("the fixture dialog's links into a club", () => {
  /* A dialog opened from a past season's fixture must not send its clubs to the running season, where the
     strict junction join answers „nicht gefunden“. */
  it("carry the fixture's own season, from either side", async () => {
    const user = userEvent.setup();
    const { dialog } = openDialog(HALBFINALE);

    for (const [name, teamId] of [
      ["Mainufer Beispiel", HEIM],
      ["Musterschule Süd", GAST],
    ] as const) {
      await user.click(within(dialog).getByRole("button", { name }));

      assert.equal(screen.getByRole("link", { name: "Team-Details" }).getAttribute("href"), `/dashboard/teams/${teamId}?saison_id=2025`);
      assert.equal(screen.getByRole("link", { name: "Kader" }).getAttribute("href"), `/dashboard/spieler/${teamId}?saison_id=2025`);
      await user.keyboard("{Escape}");
    }
  });
});
