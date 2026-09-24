import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";

const { calls } = doubleActions({
  modules: ["/src/features/spiele/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert.", priorPaarungen: [] }),
});

const { raised } = doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

const side = (team_id: string, name: string, shorthand: string) => ({ team_id, tore: null, name, shorthand, austritt_type: null });

const SPIEL: FLSpielAdmin = {
  id: "6890a1b2c3d4e5f607182901",
  spieltag_id: "6890a1b2c3d4e5f607182990",
  team1: side("68c1f0a2b3c4d5e6f7a8b9c1", "SG Alpha", "SA"),
  team2: side("68c1f0a2b3c4d5e6f7a8b9c2", "SG Beta", "SB"),
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
  saison_phase: "gruppenphase",
  saison_id: "2026",
  notiz: null,
};

describe("the match editor's undo whose dispatch never answered", () => {
  /* The dispatch failed in the browser, so no server log holds the diagnosis and the toast carries it
     after the sentence; the restore may still have landed on its way, so it is titled neither way. */
  it("says nobody can tell whether the change was taken back, and names what the browser saw", async () => {
    const user = userEvent.setup();
    render(
      underNext(
        h(AdminEditSpielDataForm, {
          spielData: SPIEL,
          teams: [],
          spielorte: [],
          schiedsrichter: [],
          saisonSpiele: [SPIEL],
          numberOfGroups: 2,
          isFinishedSaison: false,
          today: "2026-09-14",
          categorize: () => new Set<never>(),
          pageHeader: { title: "Spiel 1" },
        }),
        { search: "saison_id=2026" },
      ),
    );

    await user.type(screen.getByRole("textbox", { name: "Notiz zum Spiel" }), "Halle getauscht");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => settled());
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchAdminSpielDataAction"],
      "the save never reached its write, so no undo was offered",
    );

    const offer = raised.find((toast) => toast.options?.actionProps?.onPress !== undefined) ?? assert.fail("the save offered no undo");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    try {
      raised.length = 0;
      offer.options?.actionProps?.onPress?.();
      await settled();
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.deepEqual(
      raised.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description]),
      [["Rücknahme unklar", "Ob die Änderung zurückgenommen wurde, ist unklar. Lade die Seite neu und prüfe sie. TypeError: Failed to fetch"]],
    );
  });
});
