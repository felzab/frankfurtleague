import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { ERASED_ACTOR_MARKER } from "@/core/erasedActor";
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
  /* An erasure leaves the marker in `by` and in `label` alike, and the page is the only thing that hides the word. */
  it("reads the erased marker's word wherever it stands", () => {
    const row = rowOf(entry({ by: ERASED_ACTOR_MARKER, action: "grant.added", label: ERASED_ACTOR_MARKER }));
    expect(row.name).toBe(labelled(WORDS.action["grant.added"], COPY.admin.erasedActor));
    expect(row.cells.who).toBe(COPY.admin.erasedActor);
  });

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

  /* The address a person's act never names: a contact person reads by role and team, and by role alone with no team. */
  it("names a contact person by role and team", () => {
    expect(rowOf(entry({ by: "kontakt", team: "Goethe-Gymnasium" })).cells.who).toBe(WORDS.actor.contact({ record: "Goethe-Gymnasium" }));
    expect(rowOf(entry({ by: "kontakt" })).cells.who).toBe(WORDS.actor.contactNoTeam);
  });
});
