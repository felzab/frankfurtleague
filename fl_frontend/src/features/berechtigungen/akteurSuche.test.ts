import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { fireEvent, render, within } from "@testing-library/react";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import { PLAYGROUND_MARKER } from "./constants.ts";

import type { AdminAktionRow } from "@/features/aktionen/types.ts";
import type { FLSperrlisteZeile } from "@/features/sperrliste/schemas.ts";
import type { ReactElement } from "react";
import type { FLBerechtigungZeile } from "./schemas.ts";

doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminCrudSearch } = await import("@/shared/components/ui/AdminCrudSearch.tsx");
const { AdminCrudShell } = await import("@/shared/components/ui/AdminCrudShell.tsx");
const { AdminBerechtigungenView } = await import("./components/views/AdminBerechtigungenView.tsx");
const { AdminSperrlisteView } = await import("@/features/sperrliste/components/views/AdminSperrlisteView.tsx");
const { AdminAktionenView } = await import("@/features/aktionen/components/views/AdminAktionenView.tsx");

const LABEL = "Suchen";

/**
 * Which rows a list shows once `query` is typed into the shell's bar, each found by a token only it
 * prints: a card prints an actor's label rather than what is stored, and only the label can be typed.
 */
function foundAfterTyping(view: ReactElement, query: string, rows: Readonly<Record<string, string>>): string[] {
  const { container, unmount } = render(
    underNext(h(AdminCrudShell, { search: h(AdminCrudSearch, { searchLabel: LABEL, searchPlaceholder: LABEL }), children: view }), {
      search: "saison_id=2526",
    }),
  );
  fireEvent.change(within(container).getByRole("searchbox", { name: LABEL }), { target: { value: query } });
  const shown = container.textContent ?? "";
  unmount();

  return Object.entries(rows)
    .filter(([, token]) => shown.includes(token))
    .map(([row]) => row);
}

describe("the grants list's search, over the actor and the address its cards print", () => {
  // A barred grant's own address is withheld as `null`, and only its card's label can be typed.
  const zeile = (adresse: string | null, von: string | null, vonGesperrt: boolean, id: string): FLBerechtigungZeile => ({
    id: id,
    adresse: adresse,
    gesperrt: adresse === null,
    verwaltung: "administration",
    erteilt_von: von,
    erteilt_von_gesperrt: vonGesperrt,
    erteilt_am: "2026-09-27T10:00:00Z",
    adresswechsel: null,
  });
  const ROWS = {
    benannt: "vorstand@schule.de",
    geloescht: "kasse@schule.de",
    gesperrt: "beisitz@schule.de",
    eingefuegt: "inhaber@schule.de",
    // Found by its author, the one address this card prints.
    gesperrterZugang: "schriftfuehrung@schule.de",
  };
  const view = h(AdminBerechtigungenView, {
    antraege: [],
    berechtigungen: [
      zeile(ROWS.benannt, "inhaber@schule.de", false, "6890a1b2c3d4e5f6071b0011"),
      zeile(ROWS.geloescht, ERASED_ACTOR_MARKER, false, "6890a1b2c3d4e5f6071b0012"),
      zeile(ROWS.gesperrt, null, true, "6890a1b2c3d4e5f6071b0013"),
      zeile(ROWS.eingefuegt, PLAYGROUND_MARKER, false, "6890a1b2c3d4e5f6071b0014"),
      zeile(null, ROWS.gesperrterZugang, false, "6890a1b2c3d4e5f6071b0015"),
    ],
    uebersprungen: 0,
    inhaberAdresse: null,
  });

  it("finds an erased author by the word its card prints, and never by the stored marker", () => {
    assert.deepEqual(foundAfterTyping(view, "Gelöschte", ROWS), ["geloescht"]);
    assert.deepEqual(foundAfterTyping(view, ERASED_ACTOR_MARKER, ROWS), []);
  });

  it("finds a barred grant and a barred author as „Gesperrte Adresse“, and a paste by its origin rather than its marker", () => {
    assert.deepEqual(foundAfterTyping(view, "Gesperrte Adresse", ROWS), ["gesperrt", "gesperrterZugang"]);
    assert.deepEqual(foundAfterTyping(view, "Direkt in der Datenbank", ROWS), ["eingefuegt"]);
    assert.deepEqual(foundAfterTyping(view, PLAYGROUND_MARKER, ROWS), []);
  });
});

describe("the ban list's search, over the author its cards print", () => {
  const eintrag = (grund: string, von: string | null, vonGesperrt: boolean, id: string): FLSperrlisteZeile => ({
    id: id,
    grund: grund,
    erstellt_von: von,
    erstellt_von_gesperrt: vonGesperrt,
    erstellt_am: "2026-03-12",
    gesperrt_bis_saison_id: "2031",
  });
  const ROWS = {
    benannt: "Falsches Geburtsdatum angegeben",
    geloescht: "Wiederholt fremde Namen eingetragen",
    gesperrt: "Doppelte Anmeldung in zwei Teams",
  };
  const view = h(AdminSperrlisteView, {
    sperrliste: [
      eintrag(ROWS.benannt, "vorstand@example.org", false, "6890a1b2c3d4e5f607190011"),
      eintrag(ROWS.geloescht, ERASED_ACTOR_MARKER, false, "6890a1b2c3d4e5f607190012"),
      eintrag(ROWS.gesperrt, null, true, "6890a1b2c3d4e5f607190013"),
    ],
    anzahlGesamt: 3,
  });

  it("finds an erased author by the word its card prints, and never by the stored marker", () => {
    assert.deepEqual(foundAfterTyping(view, "Gelöschte", ROWS), ["geloescht"]);
    assert.deepEqual(foundAfterTyping(view, ERASED_ACTOR_MARKER, ROWS), []);
  });

  it("finds a barred author as „Gesperrte Adresse“", () => {
    assert.deepEqual(foundAfterTyping(view, "Gesperrte Adresse", ROWS), ["gesperrt"]);
  });
});

describe("the change log's search, over the actor its rows print", () => {
  const aktion = (actor: AdminAktionRow["actor"], documentId: string): AdminAktionRow => ({
    id: documentId,
    at: "2026-08-20T14:23:05+00:00",
    actor: actor,
    trace_id: "8f14e45fceea167a",
    request: { method: "PATCH", path: "/api/v1/teams/x" },
    collection: "teams",
    operation: "patch_one",
    document_id: documentId,
    db_filter: null,
    modified_count: null,
    redacted_at: null,
    anlass: null,
    stand_gesichert: true,
  });
  // A row is found by its record's id, which no actor's label can contain.
  const ROWS = {
    benannt: "68c1f0a2b3c4d5e6f7a8b901",
    geloescht: "68c1f0a2b3c4d5e6f7a8b902",
    gesperrt: "68c1f0a2b3c4d5e6f7a8b903",
    personGeloescht: "68c1f0a2b3c4d5e6f7a8b904",
    oeffentlich: "68c1f0a2b3c4d5e6f7a8b905",
  };
  const view = h(AdminAktionenView, {
    aktionen: [
      aktion({ kind: "admin_session", email: "eine.person@beispiel.de", email_gesperrt: false }, ROWS.benannt),
      aktion({ kind: "admin_session", email: ERASED_ACTOR_MARKER, email_gesperrt: false }, ROWS.geloescht),
      aktion({ kind: "admin_session", email: null, email_gesperrt: true }, ROWS.gesperrt),
      aktion({ kind: "person_session", pseudonym: ERASED_ACTOR_MARKER, funktion: "kontakt" }, ROWS.personGeloescht),
      aktion({ kind: "public", email: "PUBLIC", email_gesperrt: false }, ROWS.oeffentlich),
    ],
    vollstaendig: true,
    anzahlJeCollection: { teams: 5 },
    anzahlJeOperation: { patch_one: 5 },
    anzahlJeHerkunft: { person: 4, public: 1 },
    dokumentId: null,
    vorgangId: null,
    richtung: "desc",
  });

  it("finds an erased actor by the word its row prints, and never by the stored marker", () => {
    assert.deepEqual(foundAfterTyping(view, "Gelöschte", ROWS), ["geloescht", "personGeloescht"]);
    assert.deepEqual(foundAfterTyping(view, ERASED_ACTOR_MARKER, ROWS), []);
  });

  it("finds a barred administrator as „Gesperrte Adresse“, and the public form by its label rather than its sentinel", () => {
    assert.deepEqual(foundAfterTyping(view, "Gesperrte Adresse", ROWS), ["gesperrt"]);
    assert.deepEqual(foundAfterTyping(view, "Öffentliches Formular", ROWS), ["oeffentlich"]);
    assert.deepEqual(foundAfterTyping(view, "PUBLIC", ROWS), []);
  });
});
