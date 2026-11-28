import { describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";

import { seatsOf } from "./seats";

import type { FLKontaktpersonAdmin, FLSaisonTeamConfirmationView, FLSaisonTeamKontakteAdmin } from "@/core/generated/client/types";

const person = (first_name: string, confirmed_at: string | null = null): FLKontaktpersonAdmin => ({
  first_name,
  last_name: "Muster",
  email: `${first_name.toLowerCase()}@example.com`,
  phone: "069 90009123",
  einwilligung: { scope: "kontakt_data", confirmed_at, media: false },
});

const link = (overrides: Partial<FLSaisonTeamConfirmationView>): FLSaisonTeamConfirmationView => ({
  sent_at: "2026-10-01",
  deadline: "2026-10-15",
  declined_at: null,
  expired: false,
  delivery: null,
  ...overrides,
});

const NOBODY: FLSaisonTeamKontakteAdmin = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_is_also: null };

/* The chip is how the administrator knows whom to chase and whom to replace, and no other line on the page repeats it:
   a lapsed link read as open, or an objection read as an erasure, sends them after the wrong person. */
describe("where a team's seat stands", () => {
  const chipOf = (kontakte: FLSaisonTeamKontakteAdmin, confirmations: Parameters<typeof seatsOf>[0]["confirmations"]) =>
    seatsOf({ kontakte, confirmations }).find((seat) => seat.id === "ansprechperson")?.chips[0]?.label;

  it("reads a confirmed person as confirmed, whatever their link says", () => {
    const held = { ...NOBODY, ansprechperson: person("Anna", "2026-10-02") };
    expect(chipOf(held, { trainer: null, stellvertretung: null, ansprechperson: link({ expired: true }) })).toBe(COPY.shared.state.confirmed);
  });

  it("tells a lapsed link from an open one", () => {
    const held = { ...NOBODY, ansprechperson: person("Anna") };
    expect(chipOf(held, { trainer: null, stellvertretung: null, ansprechperson: link({}) })).toBe(COPY.shared.state.unconfirmed);
    expect(chipOf(held, { trainer: null, stellvertretung: null, ansprechperson: link({ expired: true }) })).toBe(COPY.shared.state.expired);
  });

  it("tells a seat its person objected to from one an erasure emptied", () => {
    expect(chipOf(NOBODY, { trainer: null, stellvertretung: null, ansprechperson: link({ declined_at: "2026-10-03" }) })).toBe(
      SERVER_COPY.entryConfirmation.objected,
    );
    expect(chipOf(NOBODY, null)).toBe(COPY.shared.state.erased);
  });

  it("adds the chip of a link that never reached its person, beside the seat's own", () => {
    const held = { ...NOBODY, ansprechperson: person("Anna") };
    const unsent = link({ delivery: { state: "abandoned", delivery: null, undeliverable: true } });
    const seat = seatsOf({ kontakte: held, confirmations: { trainer: null, stellvertretung: null, ansprechperson: unsent } }).find(
      (row) => row.id === "ansprechperson",
    );

    expect(seat?.chips.map(({ label }) => label)).toStrictEqual([COPY.shared.state.unconfirmed, ADMIN_COPY.delivery.abandoned]);
  });
});

/* The answers decide whom the administrator may add to the team's WhatsApp group, and nothing on screen tells a
   declined answer shown as given from a true one. */
describe("a seat's consent answers", () => {
  const factsOf = (ansprechperson: FLKontaktpersonAdmin) =>
    seatsOf({ kontakte: { ...NOBODY, ansprechperson }, confirmations: null }).find((seat) => seat.id === "ansprechperson")?.facts;
  const CONSENT = ADMIN_COPY.einwilligung;

  it("reads a confirmed person's WhatsApp and photographs answers", () => {
    const anna = person("Anna", "2026-10-02");
    const given: FLKontaktpersonAdmin = { ...anna, einwilligung: { ...anna.einwilligung, scope: "kontakt_data_whatsapp", media: true } };

    expect(factsOf(given)).toStrictEqual([
      { label: CONSENT.whatsapp, value: CONSENT.yes },
      { label: CONSENT.media, value: CONSENT.yes },
    ]);
  });

  it("reads no answer before the person confirms", () => {
    expect(factsOf(person("Anna"))).toStrictEqual([]);
  });
});
