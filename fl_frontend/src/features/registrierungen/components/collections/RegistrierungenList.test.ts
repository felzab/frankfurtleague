import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleSubjectLookup, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, clearSteps, EMPTIEST_ANSWER, pageBody, readsOf, renderPage, steps } from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { UserEvent } from "@testing-library/user-event";

const { setSubject } = doubleSubjectLookup(person({ sitze: [sitz({ rolle: "trainer" })] }));
const { calls, answered } = doubleActions({ modules: ["/src/features/registrierungen/personActions.ts"] });
const { raised } = doubleToasts();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: RegistrierungenPage } = await import("@/app/bereich/team/[team_id]/[saison_id]/registrierungen/page.tsx");
const { RegistrierungenView } = await import("@/features/registrierungen/components/views/RegistrierungenView.tsx");
const { ANGABEN_WEICHEN_AB, NOCH_NICHT_BESTAETIGT, REGISTRIERUNGEN_LEER } = await import("@/features/registrierungen/utils.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

const TEAM_A = SITZ.team_id;
const ADRESSE = { team_id: TEAM_A, saison_id: SITZ.saison_id };
const OFFEN_ENDPOINT = `/registrierungen/kader/${TEAM_A}/${SITZ.saison_id}`;

const LENA = "68c1f0a2b3c4d5e6f7a8b941";
const MIA = "68c1f0a2b3c4d5e6f7a8b942";
const STORED = "68c1f0a2b3c4d5e6f7a8b951";
const VORSCHLAG = "68c1f0a2b3c4d5e6f7a8b952";

/** One pending registration as the backend serves it to a seat holder. */
const zeile = (registrierung_id: string, vorname: string, nachname: string, fields: Record<string, unknown> = {}) => ({
  registrierung_id,
  eingereicht_am: "2026-09-20",
  vorname,
  nachname,
  nummer: "7",
  position: "Tor",
  stufe: "Q1",
  aufnehmbar: true,
  nummer_doppelt: false,
  person: null,
  vorschlag: null,
  ...fields,
});

/** Lena confirmed and was in the league before; Mia has not answered her link. Both carry a leak a schema must stop. */
const OFFEN = {
  acknowledged: 1,
  team_id: TEAM_A,
  saison_id: SITZ.saison_id,
  vollstaendig: true,
  registrierungen: [
    zeile(LENA, "Lena", "Meier", {
      nummer_doppelt: true,
      person: { spieler_id: STORED, vorname: "Lena", nachname: "Meier", weicht_ab: false, geburtsdatum: "2008-01-01" },
      email: "lena@registrierung.invalid",
    }),
    zeile(MIA, "Mia", "Schmidt", { aufnehmbar: false, einwilligung: { telefon: "0151 2345678" } }),
  ],
};

const answeringOffen = (offen: unknown) =>
  answerReadsWith((endpoint, schema, params) => (endpoint === OFFEN_ENDPOINT ? offen : EMPTIEST_ANSWER(endpoint, schema, params)));

const pageProps = (search: Record<string, string> = {}) => ({
  params: Promise.resolve({ team_id: TEAM_A, saison_id: SITZ.saison_id }),
  searchParams: Promise.resolve(search),
});

/** What a browser holds once the registrations page has run at team A this season, and what it read. */
async function renderedPage(search: Record<string, string> = {}): Promise<{ markup: string; text: string; reads: ReturnType<typeof readsOf> }> {
  clearSteps();
  const markup = await renderPage(
    underNext(h(RegistrierungenPage, pageProps(search)), { pathname: `/bereich/team/${TEAM_A}/2526/registrierungen` }),
  );

  return { markup, text: textOf(markup, " ").replace(/\s+/g, " "), reads: readsOf(steps) };
}

/** Every key at any depth of `value`, which is what a payload handed a page or a component could carry on. */
const keysOf = (value: unknown): string[] =>
  typeof value !== "object" || value === null ? [] : Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);

/** What a seat holder must never be handed about a pupil: a way to reach them, their birthdate, their consent. */
const PRIVATE_KEY = /mail|telefon|phone|geburtsdatum|einwilligung/i;

describe("a pending row without a number", () => {
  /* An `aria-label` on a span with no role is one a screen reader may skip, so the empty chip says it in text. */
  it("says so in text a screen reader reads, and nowhere in an aria-label", async () => {
    answeringOffen({ ...OFFEN, registrierungen: [zeile(LENA, "Lena", "Meier", { nummer: null })] });
    try {
      const { markup } = await renderedPage();

      assert.ok(markup.includes('<span class="sr-only">Keine Nummer</span>'), "the empty chip says nothing a screen reader reads");
      assert.doesNotMatch(markup, /aria-label="Keine Nummer"/, "the empty chip is named by an aria-label again");
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });
});

describe("the registrations page, as a seat holder reads it", () => {
  /* A Trainer-only seat, the narrowest there is: whatever an Ansprechperson reads, it reads too. */
  it("lists every pending row with its marker, the unconfirmed one closed to admission, and whom to ask for a fresh link", async () => {
    answeringOffen(OFFEN);
    try {
      const { text, reads } = await renderedPage();

      assert.deepEqual(reads, [{ endpoint: OFFEN_ENDPOINT, params: { order: "desc" } }]);
      for (const name of ["Lena Meier", "Mia Schmidt"]) assert.ok(text.includes(name), `${name} is not listed`);
      assert.ok(text.includes("War schon in der Liga") && text.includes("Nummer doppelt"), text);
      assert.ok(
        text.includes("Noch nicht bestätigt") && text.includes(NOCH_NICHT_BESTAETIGT),
        "the unconfirmed row does not say why it admits nobody",
      );
      assert.ok(text.includes("Einen neuen Registrierungslink schickt die Liga."), text);
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The read's answer carries an address, a number, a birthdate and a consent here, as a backend leak
     would: the page's schema is what keeps each off the page and out of every prop it hands its view. */
  it("carries nothing a seat holder is not to see, in the markup or in what the page hands its view", async () => {
    answeringOffen(OFFEN);
    try {
      const { markup } = await renderedPage();
      const body = await pageBody(RegistrierungenPage, pageProps());

      assert.ok(
        !markup.includes("registrierung.invalid") && !markup.includes("0151") && !markup.includes("2008"),
        "the page renders a private value",
      );
      assert.deepEqual(
        keysOf(body.props).filter((key) => PRIVATE_KEY.test(key)),
        [],
        "the page hands its view a private value",
      );
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  it("says nothing is pending where nothing is", async () => {
    answeringOffen({ ...OFFEN, registrierungen: [] });
    try {
      const { text } = await renderedPage();

      assert.ok(text.includes(REGISTRIERUNGEN_LEER), text);
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* A flooded queue keeps its newest rows: reading from the other end is the one way to its oldest. */
  it("names a cut-short queue's loaded end and links to the other, which the read then asks for", async () => {
    answeringOffen({ ...OFFEN, vollstaendig: false });
    try {
      const { markup, text } = await renderedPage();
      assert.ok(text.includes("Diese Liste ist unvollständig") && text.includes("Geladen sind die neuesten Registrierungen."), text);
      assert.ok(markup.includes('href="?order=asc"'), "the notice offers no way to the oldest rows");

      const { reads } = await renderedPage({ order: "asc" });
      assert.deepEqual(reads, [{ endpoint: OFFEN_ENDPOINT, params: { order: "asc" } }]);
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The page's own check found the seat and the backend's, a moment later, did not. */
  it("renders the forbidden panel where the seat went between the check and the read", async () => {
    answerReadsWith((endpoint, schema, params) => {
      if (endpoint !== OFFEN_ENDPOINT) return EMPTIEST_ANSWER(endpoint, schema, params);
      throw refusedOn("GET /registrierungen/kader/{team_id}/{saison_id}", "REQ-FUNKTION-001");
    });
    try {
      const { text } = await renderedPage();

      assert.ok(text.includes("Hier bist Du nicht eingetragen."), text);
      assert.ok(!text.includes(REGISTRIERUNGEN_LEER), "the empty queue renders beside the forbidden panel");
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
      setSubject(person({ sitze: [sitz({ rolle: "trainer" })] }));
    }
  });
});

/** The view with one confirmed row, `fields` over it. */
const viewWith = (fields: Record<string, unknown>) =>
  render(
    underNext(
      h(RegistrierungenView, {
        registrierungen: [zeile(LENA, "Lena", "Meier", fields)] as never,
        adresse: ADRESSE,
        unvollstaendig: null,
      }),
    ),
  );

/** The admission armed, then `control` pressed past the window the hook reads as one double click. */
async function armedThen(user: UserEvent, control: string | RegExp, whileArmed?: () => void): Promise<void> {
  mock.timers.enable({ apis: ["Date"] });
  try {
    await user.click(screen.getByRole("button", { name: "Aufnehmen: Lena Meier" }));
    whileArmed?.();
    mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: control }));
  } finally {
    mock.timers.reset();
  }
  await act(answered);
}

/** The armed row's primary control, by its accessible name: the press a habitual second click sends. */
const primaryName = (): string | null => document.querySelector("[data-confirm-press]")?.textContent?.trim() ?? null;

describe("deciding a registration", () => {
  const ZIEL = { ...ADRESSE, registrierung_id: LENA };

  beforeEach(() => {
    calls.length = 0;
  });

  it("admits a row whose address resolves nobody as a new person", async () => {
    viewWith({});
    await pressTwice(userEvent.setup(), { resting: "Aufnehmen: Lena Meier", armed: "Ja, aufnehmen" });
    await act(answered);

    assert.deepEqual(calls, [{ action: "aufnehmenRegistrierungAction", payload: { ...ZIEL, spieler_id: null } }]);
    assert.equal(raised.at(-1)?.title, "Registrierung aufgenommen");
  });

  /* The question names the stored person and nothing else: the stored birthdate was promised to the
     administrators alone, so the row carries a flag and the page never a date. */
  it("asks about a differing stored person by name alone, admitting into them on yes", async () => {
    viewWith({ person: { spieler_id: STORED, vorname: "Lena", nachname: "Schulz", weicht_ab: true } });
    const user = userEvent.setup();
    await pressTwice(user, {
      resting: "Aufnehmen: Lena Meier",
      armed: "Als Lena Schulz aufnehmen",
      whileArmed: () => {
        assert.equal(primaryName(), "Als Lena Schulz aufnehmen", "the stored record is not the armed primary");
        // The question alone: the card above it shows the registration's own date, which is no stored person's.
        const shown = screen.getByRole("alert").textContent;
        assert.ok(shown.includes(`${ANGABEN_WEICHEN_AB} Ist das dieselbe Person wie Lena Schulz?`), shown);
        assert.doesNotMatch(shown, /\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}/, "the question shows a date");
      },
    });
    await act(answered);

    assert.deepEqual(calls, [{ action: "aufnehmenRegistrierungAction", payload: { ...ZIEL, spieler_id: STORED } }]);
  });

  /* The address arm's no names its effect: the decline under its fixed reason, which the pupil's note
     words as an address of their own. */
  it("declines as another person from the control naming that decline", async () => {
    viewWith({ person: { spieler_id: STORED, vorname: "Lena", nachname: "Schulz", weicht_ab: true } });

    await armedThen(userEvent.setup(), "Andere Person, ablehnen");

    assert.deepEqual(calls, [{ action: "ablehnenRegistrierungAction", payload: { ...ZIEL, grund: "andere_person" } }]);
  });

  /* A name alone is the weaker key, so the armed primary makes a new person and the proposed record
     is the secondary, each named by its effect. */
  it("admits as a new person on the armed primary, and into a proposed person on its own control", async () => {
    viewWith({ vorschlag: { spieler_id: VORSCHLAG, vorname: "Lena", nachname: "Meier" } });
    await armedThen(userEvent.setup(), "Als neue Person aufnehmen", () => {
      assert.equal(primaryName(), "Als neue Person aufnehmen", "a new person is not the armed primary");
    });
    assert.deepEqual(calls.at(-1), { action: "aufnehmenRegistrierungAction", payload: { ...ZIEL, spieler_id: null } });

    await armedThen(userEvent.setup(), "Als Lena Meier aufnehmen");
    assert.deepEqual(calls.at(-1), { action: "aufnehmenRegistrierungAction", payload: { ...ZIEL, spieler_id: VORSCHLAG } });
  });

  /* A stored pupil may hold no surname, so every name the row gives a stored or proposed person is
     the squad's own full name, never the two fields joined. */
  it("names a proposed or a differing stored person holding no surname by the first name alone", async () => {
    const vorgeschlagen = viewWith({ vorschlag: { spieler_id: VORSCHLAG, vorname: "Lena", nachname: null } });
    await armedThen(userEvent.setup(), "Als Lena aufnehmen", () => {
      const shown = screen.getByRole("alert").textContent;
      assert.ok(shown.includes("Ist das dieselbe Person wie Lena?"), shown);
    });
    assert.deepEqual(calls.at(-1), { action: "aufnehmenRegistrierungAction", payload: { ...ZIEL, spieler_id: VORSCHLAG } });
    vorgeschlagen.unmount();

    viewWith({ person: { spieler_id: STORED, vorname: "Lena", nachname: null, weicht_ab: true } });
    await pressTwice(userEvent.setup(), {
      resting: "Aufnehmen: Lena Meier",
      armed: "Als Lena aufnehmen",
      whileArmed: () => {
        const shown = screen.getByRole("alert").textContent;
        assert.ok(shown.includes(`${ANGABEN_WEICHEN_AB} Ist das dieselbe Person wie Lena?`), shown);
      },
    });
    await act(answered);
    assert.deepEqual(calls.at(-1), { action: "aufnehmenRegistrierungAction", payload: { ...ZIEL, spieler_id: STORED } });
  });

  it("declines a row with no reason from its own control", async () => {
    viewWith({ aufnehmbar: false });
    await pressTwice(userEvent.setup(), { resting: "Ablehnen: Registrierung von Lena Meier", armed: "Ja, ablehnen" });
    await act(answered);

    assert.deepEqual(calls, [{ action: "ablehnenRegistrierungAction", payload: { ...ZIEL, grund: null } }]);
  });
});
