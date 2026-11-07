import { describe, expect, it } from "vitest";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor";

import { rowOf } from "./rows";

import type { FLActionLogEntry } from "@/core/generated/client/types";

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
    expect(row.name).toBe("Administrator eingetragen · Gelöschte Person");
    expect(row.cells.who).toBe("Gelöschte Person");
  });

  /* A pass stores a season as its label, and what it took is the count: a row printing the label would hide how much went. */
  it("names what a pass took and how many, past its label", () => {
    expect(rowOf(entry({ by: "system", action: "retention.registrierungen", label: "2026", count: 12 })).name).toBe(
      "Nach Frist gelöscht · Registrierungen: 12",
    );
  });

  /* The address a person's act never names: a contact person reads by role and team, and `kontakt` alone by its word. */
  it("names a contact person by role and team", () => {
    expect(rowOf(entry({ by: "kontakt", team: "Goethe-Gymnasium" })).cells.who).toBe("Kontaktperson · Goethe-Gymnasium");
    expect(rowOf(entry({ by: "kontakt" })).cells.who).toBe("Teams");
  });
});
