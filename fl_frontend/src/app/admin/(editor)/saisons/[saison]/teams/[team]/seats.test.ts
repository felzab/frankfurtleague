import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { seatsOf } from "./seats.ts";

import type { FLKontaktperson, FLSaisonTeamConfirmationView, FLSaisonTeamKontakte } from "@/core/generated/client/types";

const person = (first_name: string, confirmed_at: string | null = null): FLKontaktperson => ({
  first_name,
  last_name: "Muster",
  email: `${first_name.toLowerCase()}@example.com`,
  phone: "069 90009123",
  birth_date: null,
  einwilligung: {
    scope: "kontakt_data",
    date: "2026-10-01",
    confirmed_at,
    media: false,
    entered_by: "liga",
    evidence: { scope: null, media: null },
  },
});

const link = (overrides: Partial<FLSaisonTeamConfirmationView>): FLSaisonTeamConfirmationView => ({
  sent_at: "2026-10-01",
  deadline: "2026-10-15",
  declined_at: null,
  expired: false,
  delivery: null,
  ...overrides,
});

const NOBODY: FLSaisonTeamKontakte = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_is_also: null };

/* The chip is how the administrator knows whom to chase and whom to replace, and no other line on the page repeats it:
   a lapsed link read as open, or an objection read as an erasure, sends them after the wrong person. */
describe("where a team's seat stands", () => {
  const chipOf = (kontakte: FLSaisonTeamKontakte, confirmations: Parameters<typeof seatsOf>[0]["confirmations"]) =>
    seatsOf({ kontakte, confirmations }).find((seat) => seat.id === "ansprechperson")?.chips[0]?.label;

  it("reads a confirmed person as confirmed, whatever their link says", () => {
    const held = { ...NOBODY, ansprechperson: person("Anna", "2026-10-02") };
    expect(chipOf(held, { trainer: null, stellvertretung: null, ansprechperson: link({ expired: true }) })).toBe(COPY.admin.confirmed);
  });

  it("tells a lapsed link from an open one", () => {
    const held = { ...NOBODY, ansprechperson: person("Anna") };
    expect(chipOf(held, { trainer: null, stellvertretung: null, ansprechperson: link({}) })).toBe(COPY.template.open);
    expect(chipOf(held, { trainer: null, stellvertretung: null, ansprechperson: link({ expired: true }) })).toBe(COPY.admin.expired);
  });

  it("tells a seat its person objected to from one an erasure emptied", () => {
    expect(chipOf(NOBODY, { trainer: null, stellvertretung: null, ansprechperson: link({ declined_at: "2026-10-03" }) })).toBe(
      SERVER_COPY.entryConfirmation.objected,
    );
    expect(chipOf(NOBODY, null)).toBe(COPY.admin.erased);
  });

  it("adds the chip of a link that never reached its person, beside the seat's own", () => {
    const held = { ...NOBODY, ansprechperson: person("Anna") };
    const unsent = link({ delivery: { state: "abandoned", delivery: null, undeliverable: true } });
    const seat = seatsOf({ kontakte: held, confirmations: { trainer: null, stellvertretung: null, ansprechperson: unsent } }).find(
      (row) => row.id === "ansprechperson",
    );

    expect(seat?.chips.map(({ label }) => label)).toStrictEqual([COPY.template.open, COPY.admin.saison.linkNotSent]);
  });
});

/* One person holds two seats and one link answers both, so two rows would offer two presses for one mail. */
describe("a Trainer holding a second seat", () => {
  it("stands as one row naming both seats", () => {
    const anna = person("Anna");
    const rows = seatsOf({
      kontakte: { ...NOBODY, trainer: anna, ansprechperson: anna, trainer_is_also: "ansprechperson" },
      confirmations: null,
    });

    expect(rows.map((row) => row.id)).toStrictEqual(["trainer", "stellvertretung"]);
    expect(rows[0]?.line).toBe(COPY.admin.seatLine(["trainer", "ansprechperson"], anna.email, null));
  });
});
