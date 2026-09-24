import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries the router context, and the club popover's links read it. A Next release that
   moves the module fails this file at import rather than quietly. */
// eslint-disable-next-line no-restricted-imports -- not moved onto shared/testing/nextContexts.ts yet
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { nextRouter } from "@/shared/testing/nextContexts.ts";
import { spokenText } from "@/shared/testing/spokenText.ts";
import { PLACEHOLDER } from "@/shared/utils/format.ts";

import { ergebnisTone } from "../../utils.ts";
import { SLOT_LABEL_WRAP_CLASSES, TEAM_NAME_WRAP_CLASSES } from "../ui/teamName.ts";

import type { FLSpiel } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielDetailsModal } = await import("./SpielDetailsModal.tsx");
const { ERGEBNIS_INK_CLASSES } = await import("../ui/SpielScore.tsx");

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
      value: nextRouter(),
      children: h(SpielDetailsModal, { spielData: spiel, isOpen: true, onClose: () => undefined, today: "2026-09-14", isFinishedSaison }),
    }),
  );

  return { dialog: screen.getByRole("dialog", { name: "Spiel Nr. 13" }), unmount };
}

describe("what the fixture dialog says about the result", () => {
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
      const spoken = spokenText(dialog.innerHTML, " ").replace(/\s+/g, " ");

      assert.match(spoken, /Mainufer Beispiel .*gegen .*Musterschule Süd/, `the sides are not read as a pairing: ${spoken}`);
      unmount();
    }
    assert.match(spokenText(openDialog(HALBFINALE).dialog.innerHTML, " "), /5:4\s*im Elfmeterschießen/);
  });

  /* The cards' own recipe and the cards' own grader, so one fixture cannot read one way on a card and
     another in the dialog it opens. What the tokens LOOK like is the browser pass's. */
  it("paints the score from the cards' recipe rather than classes of its own", () => {
    const graded: readonly FLSpiel[] = [HALBFINALE, UNGESPIELT, { ...UNGESPIELT, sonderereignis: "ausgefallen" }];

    for (const spiel of graded) {
      const { dialog, unmount } = openDialog(spiel);
      const score = within(dialog).getByText(spiel.ergebnis ?? PLACEHOLDER.ergebnis);

      assert.ok(
        score.className.split(" ").includes(ERGEBNIS_INK_CLASSES[ergebnisTone(spiel)]),
        `${spiel.sonderereignis ?? spiel.ergebnis ?? "unplayed"} is painted off ERGEBNIS_INK_CLASSES: ${score.className}`,
      );
      unmount();
    }
  });
});

describe("the names the fixture dialog sets", () => {
  /* A club and a bracket slot wrap on different terms, and the cards settle those terms: this dialog
     takes their two recipes rather than spelling classes that would drift from the cards beside it. */
  it("dresses a club and a slot label with the cards' own wrap recipes", () => {
    const { dialog } = openDialog({ ...HALBFINALE, team2: null, team2_quelle: { type: "spiel", spiel_nr: 29, ausgang: "verlierer" } });

    for (const [text, recipe] of [
      ["Mainufer Beispiel", TEAM_NAME_WRAP_CLASSES],
      ["Verlierer von Spiel 29", SLOT_LABEL_WRAP_CLASSES],
    ] as const) {
      const classes = within(dialog).getByText(text).className.split(" ");

      for (const token of recipe.split(" "))
        assert.ok(classes.includes(token), `„${text}“ drops ${token} from its recipe: ${classes.join(" ")}`);
    }
  });
});

describe("the fixture dialog's cells for a fixture nobody dated", () => {
  /** The value carries no accessible name of its own, so its own heading is what anchors the read. */
  const cellValue = (dialog: HTMLElement, label: string): string | null =>
    within(dialog).getByRole("heading", { name: label }).nextElementSibling?.textContent ?? null;

  /* A played fixture's missing date and time are unrecorded rather than still to come, and both cells
     say so in words, as the Ort and Schiedsrichter cells beside them do. */
  it("names the missing date and time in words once the fixture can no longer be played", () => {
    const { dialog } = openDialog({ ...UNGESPIELT, datum: null, uhrzeit: null }, true);

    for (const cell of ["Datum", "Uhrzeit"]) assert.equal(cellValue(dialog, cell), PLACEHOLDER.entity, `the ${cell} cell promises more`);
  });

  /* Paired with the case above: the two cells describe ONE appointment, so a time reading „Keine
     Angabe“ beside a date reading „Termin offen“ would deny what the cell next to it promises. */
  it("promises the same open appointment in both cells while the fixture can still be played", () => {
    const { dialog } = openDialog({ ...UNGESPIELT, datum: null, uhrzeit: null });

    for (const cell of ["Datum", "Uhrzeit"]) assert.equal(cellValue(dialog, cell), PLACEHOLDER.datum, `the ${cell} cell gives up on a Termin`);
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
