import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { rowOf } from "./rows";

import type { FLActionLogEntry } from "@/core/generated/client/types";

const WORDS = COPY.admin.actionLog;
const { labelled } = SERVER_COPY.season;

const entry = (overrides: Partial<FLActionLogEntry>): FLActionLogEntry => ({
  id: "a",
  at: "2026-11-07T17:04:00Z",
  by: "anna@example.de",
  team: null,
  action: "spiel.ergebnis_changed",
  label: null,
  count: null,
  ...overrides,
});

describe("a row", () => {
  /* A pass stores a season as its label, and what it took is the count: a row printing the label would hide how much went. */
  it("names what a pass took and how many, past its label", () => {
    expect(rowOf(entry({ by: "system", action: "retention.registrierungen", label: "2026", count: 12 })).name).toBe(
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
});
