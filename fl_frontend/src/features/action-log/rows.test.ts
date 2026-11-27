import { describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";

import { rowOf } from "./rows";

import type { FLActionLogEntry } from "@/core/generated/client/types";

const WORDS = ADMIN_COPY.actionLog;
const { labelled } = SERVER_COPY.season;

const entry = (overrides: Partial<FLActionLogEntry>): FLActionLogEntry => ({
  id: "a",
  at: "2026-11-07T17:04:00Z",
  by: "anna@example.net",
  team: null,
  action: "spiel.ergebnis_changed",
  saison_id: null,
  spiel_nr: null,
  label: null,
  count: null,
  ...overrides,
});

describe("a row", () => {
  /* A pass stores its season, and what it took is the count: a row printing the season would hide how much went. */
  it("names what a pass took and how many, past its season", () => {
    expect(rowOf(entry({ by: "system", action: "retention.registrierungen", saison_id: "2026", count: 12 })).name).toBe(
      labelled(WORDS.action["retention.registrierungen"], WORDS.passCount(WORDS.passNoun["retention.registrierungen"], 12)),
    );
  });

  /* The other pending registrations an admission deleted leave no act of their own, so its row is the log's one word of them. */
  it("names how many other registrations an admission deleted, and none where it deleted none", () => {
    expect(rowOf(entry({ by: "kontakt", action: "registrierung.admitted", count: 2 })).name).toBe(
      labelled(WORDS.action["registrierung.admitted"], WORDS.admittedOthers(2)),
    );
    expect(rowOf(entry({ by: "kontakt", action: "registrierung.admitted", count: 0 })).name).toBe(WORDS.action["registrierung.admitted"]);
  });

  /* The row stores a season and a fixture as data, so the Protokoll names them as every other screen does. */
  it("names a season, and a fixture with its season, by their names", () => {
    const saison = COPY.shared.saisonName("2627");
    expect(rowOf(entry({ action: "saison.activated", saison_id: "2627" })).name).toBe(labelled(WORDS.action["saison.activated"], saison));
    expect(rowOf(entry({ action: "spiel.ergebnis_changed", saison_id: "2627", spiel_nr: 12 })).name).toBe(
      labelled(WORDS.action["spiel.ergebnis_changed"], labelled(saison, ADMIN_COPY.spiel.number(12))),
    );
  });
});
