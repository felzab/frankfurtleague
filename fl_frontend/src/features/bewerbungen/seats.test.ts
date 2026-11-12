import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { seatsOf } from "./seats.ts";

import type { FLBewerbung, FLBewerbungConfirmation, FLKontaktperson } from "@/core/generated/client/types.ts";

const person = (confirmedAt: string | null): FLKontaktperson =>
  ({
    first_name: "Anke",
    last_name: "Koerner",
    email: "a@example.de",
    phone: "069 1",
    einwilligung: { confirmed_at: confirmedAt },
  }) as FLKontaktperson;

const entry = (overrides: Partial<FLBewerbungConfirmation> = {}): FLBewerbungConfirmation => ({
  sent_at: "2026-11-01",
  deadline: "2026-11-15",
  reminded_at: null,
  declined_at: null,
  delivery: null,
  state: "valid",
  ...overrides,
});

/** An application of three open seats, each case changing the seats it names. */
function bewerbung(overrides: Partial<Pick<FLBewerbung, "status" | "kontakte" | "confirmations">>): FLBewerbung {
  return {
    status: "submitted",
    kontakte: { trainer: person(null), ansprechperson: person(null), stellvertretung: person(null), trainer_is_also: null },
    confirmations: { trainer: entry(), ansprechperson: entry(), stellvertretung: entry() },
    ...overrides,
  } as FLBewerbung;
}

const seat = (read: FLBewerbung, rolle: string) => seatsOf(read).find((view) => view.seat === rolle);

describe("where a seat stands", () => {
  /* A Widerspruch and an erasure leave one empty slot, and only the first takes a new person: read as one, an
     administrator is offered a write the backend refuses, or none where it would take one. */
  it("parts a seat its person objected to from one an erasure emptied", () => {
    const read = bewerbung({
      kontakte: { trainer: person(null), ansprechperson: null, stellvertretung: null, trainer_is_also: null },
      confirmations: { trainer: entry(), ansprechperson: entry({ state: "declined", declined_at: "2026-11-03" }), stellvertretung: null },
    });

    expect(seat(read, "ansprechperson")?.state).toBe("declined");
    expect(seat(read, "stellvertretung")).toMatchObject({ state: "erased", day: null });
  });

  it("reads a seat past its own deadline as lapsed, its neighbour still open", () => {
    const read = bewerbung({ confirmations: { trainer: entry({ state: "expired" }), ansprechperson: entry(), stellvertretung: entry() } });

    expect(seat(read, "trainer")?.state).toBe("expired");
    expect(seat(read, "ansprechperson")?.state).toBe("valid");
  });

  /* A decided application's links open nothing, whatever day their deadline names. */
  it("names no day on a seat a decision left unanswered", () => {
    const spent = bewerbung({
      status: "declined",
      confirmations: { trainer: entry({ state: "expired" }), ansprechperson: entry(), stellvertretung: entry() },
    });

    expect(seat(spent, "trainer")).toMatchObject({ state: "expired", day: null });
  });

  /* The submission owed this seat no mail, so no delivery exists to report and the page alone can say so. */
  it("says a seat the submission never mailed was not sent", () => {
    const read = bewerbung({ confirmations: { trainer: entry({ sent_at: null }), ansprechperson: entry(), stellvertretung: entry() } });

    expect(seat(read, "trainer")?.chips).toContainEqual({ tone: "warn", label: COPY.admin.saison.linkNotSent });
    expect(seat(read, "ansprechperson")?.chips).toHaveLength(1);
  });

  it("adds a chip where the seat's last mail met trouble", () => {
    const read = bewerbung({
      confirmations: {
        trainer: entry({ delivery: { state: "abandoned", delivery: null, undeliverable: true } }),
        ansprechperson: entry(),
        stellvertretung: entry(),
      },
    });

    expect(seat(read, "trainer")?.chips.map(({ label }) => label)).toStrictEqual([
      COPY.admin.schiedsrichter.unconfirmed,
      COPY.admin.saison.linkNotSent,
    ]);
  });
});

describe("one person on two seats", () => {
  /* Two rows would offer two links for one answer, and name a person twice on a page saying who they are. */
  it("stands once, on the Trainer's row, naming both", () => {
    const kontakte = {
      trainer: person(null),
      ansprechperson: person(null),
      stellvertretung: person(null),
      trainer_is_also: "ansprechperson",
    } as const;

    const rows = seatsOf(bewerbung({ kontakte }));

    expect(rows.map((row) => row.seat)).toStrictEqual(["trainer", "stellvertretung"]);
    expect(rows[0]?.rollen).toStrictEqual(["trainer", "ansprechperson"]);
  });
});
