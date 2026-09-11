import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `RowActionLink` reads the first and `withSaisonId` the
   second — and the list renders under both (`docs/frontend/spec.md` §1.9). */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { KONTAKT_ROLLEN } from "@/features/teams/constants.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { AdminKontakteRow, AdminKontaktSeat } from "@/features/teams/types.ts";

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminKontakteList } = await import("./AdminKontakteList.tsx");

const KENNTNISNAHME = {
  umfang: "kontaktdaten",
  erfasst_von: "administrativ",
  text_version: "kontakte-1",
  datum: "2026-05-01",
  bestaetigt_am: null,
} as const;

/**
 * One person per seat, each field distinct from every other seat's, so an assertion reaching a name
 * or an address cannot be satisfied by the seat beside it.
 */
const PEOPLE = {
  ansprechperson: { vorname: "Anna", nachname: "Körner", email: "koerner@gymnasium-sachsenhausen.de", telefon: "069 1111111" },
  stellvertretung: { vorname: "Björn", nachname: "List", email: "list@gymnasium-sachsenhausen.de", telefon: "069 2222222" },
  trainer: { vorname: "Clara", nachname: "Mergen", email: "mergen@gymnasium-sachsenhausen.de", telefon: "069 3333333" },
} as const;

/* Built from the closed set the editor offers, so a fourth seat reaches these cases without an edit
   here and a renamed one fails rather than quietly dropping out. */
const seat = (rolle: AdminKontaktSeat["rolle"], label: string, held: boolean, istTrainerZugleich = false): AdminKontaktSeat => ({
  rolle: rolle,
  label: label,
  person: held ? { ...PEOPLE[rolle], einwilligung: KENNTNISNAHME } : null,
  istTrainerZugleich: istTrainerZugleich,
});

const SEATS: readonly AdminKontaktSeat[] = KONTAKT_ROLLEN.map(({ value, label }) => seat(value, label, true));

const row = (seats: readonly AdminKontaktSeat[]): AdminKontakteRow => ({
  id: "6890a1b2c3d4e5f607190031",
  teamId: "6890a1b2c3d4e5f607190032",
  teamName: "Goethe",
  teamShorthand: "GG",
  seats: seats,
  besetzt: seats.filter((held) => held.person !== null).length,
});

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const liste = (seats: readonly AdminKontaktSeat[]): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2627") },
        h(AdminKontakteList, { filteredKontakte: [row(seats)], emptiness: "none" as const }),
      ),
    ),
  );

/** Where a fact stands in the card, asserted unique first: an index into two occurrences orders nothing. */
function at(html: string, fact: string): number {
  assert.equal(html.split(fact).length - 1, 1, `„${fact}“ stands ${String(html.split(fact).length - 1)} times on the card`);

  return html.indexOf(fact);
}

const labelOf = (rolle: AdminKontaktSeat["rolle"]): string => KONTAKT_ROLLEN.find((offered) => offered.value === rolle)!.label;

describe("the seats a contacts card carries", () => {
  /* An eyebrow at the seat, never a heading row over three blocks: a row whose middle seat is empty
     then files the third person's address under the second seat's name. */
  it("seats every detail under the label of the seat that holds it, in whatever order the seats arrive", () => {
    for (const seats of [SEATS, [...SEATS].reverse()]) {
      const html = liste(seats);

      let reached = -1;
      for (const held of seats) {
        const label = at(html, held.label);
        assert.ok(label > reached, `${held.label} opens at ${String(label)}, behind the seat before it`);

        for (const fact of [
          `${PEOPLE[held.rolle].vorname} ${PEOPLE[held.rolle].nachname}`,
          PEOPLE[held.rolle].email,
          PEOPLE[held.rolle].telefon,
        ])
          assert.ok(at(html, fact) > label, `„${fact}“ stands above the ${held.label} label it belongs to`);

        reached = Math.max(label, ...[PEOPLE[held.rolle].email, PEOPLE[held.rolle].telefon].map((fact) => at(html, fact)));
      }
    }
  });

  /* A seat holding nobody keeps its own cell: dropping it would slide the next seat's person up
     under this seat's label, which is the one reading a card's own eyebrow exists to refuse. */
  it("names an empty seat rather than letting the next seat's person stand under it", () => {
    const emptied = SEATS.map((held) => (held.rolle === "stellvertretung" ? seat(held.rolle, held.label, false) : held));
    const html = liste(emptied);

    const leer = at(html, labelOf("stellvertretung"));
    const danach = at(html, labelOf("trainer"));

    assert.ok(at(html, "Niemand hinterlegt") > leer, "the empty seat's cell says nothing about being empty");
    assert.ok(at(html, "Niemand hinterlegt") < danach, "the emptiness stands outside the cell of the seat it is about");
    assert.ok(danach > leer, "the seats no longer stand in the order they arrived");
    assert.ok(at(html, PEOPLE.trainer.email) > danach, "the Trainer's address stands under the emptied seat");
  });

  /* The badge is a claim about the seat it sits on. Beside `Trainer` it would name that seat back at
     itself, and the reader would still not know which of the other two is the same person. */
  it("puts the coach claim on the seat it points at", () => {
    const claimed = SEATS.map((held) => (held.rolle === "ansprechperson" ? seat(held.rolle, held.label, true, true) : held));
    const html = liste(claimed);

    const badge = at(html, "Zugleich Trainer");

    assert.ok(badge > at(html, labelOf("ansprechperson")), "the claim stands above the seat it is about");
    assert.ok(badge < at(html, labelOf("stellvertretung")), "the claim has left the Ansprechperson's own cell");
  });

  /* The cards carry the seat names, so a heading over the list would be a second place to read them
     from and the two could then disagree; the list's own name is what an assistive reader gets. */
  it("carries its own name and stands under no heading", () => {
    const html = liste(SEATS);

    assert.match(html, /<ul aria-label="[^"]+"/, "the list of cards is unnamed");
    assert.doesNotMatch(html, /<h[1-6][\s>]/, "a heading stands over the cards");
    assert.doesNotMatch(html, /<th[\s>]|columnheader/, "the cards are headed by a column row");
  });
});
