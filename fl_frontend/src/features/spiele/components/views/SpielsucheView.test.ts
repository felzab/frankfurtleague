import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { fireEvent, render, screen } from "@testing-library/react";

import { spielbestaetigungFields } from "@/shared/testing/fixtures.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { formatSpielDatum } from "@/shared/utils/format.ts";

import type { FLSpiel } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielsucheView } = await import("./SpielsucheView.tsx");
const { FLSpielbestaetigungSchema } = await import("@/features/spielbestaetigungen/schemas.ts");

type ViewProps = Parameters<typeof SpielsucheView>[0];

const ALPHA = "6890a1b2c3d4e5f607184011";
/** A club entered nowhere this season's fixtures reach. */
const GAMMA = "6890a1b2c3d4e5f607184013";
const NORD = "6890a1b2c3d4e5f607184021";
const SUED = "6890a1b2c3d4e5f607184022";
const BEISPIEL = "6890a1b2c3d4e5f607184032";
/** Well-formed, and naming nothing any list holds. */
const NIEMAND = "6890a1b2c3d4e5f6071840ff";

/** The one fixture of the season on screen, so a filter narrowing to nothing is told apart from an empty season. */
const SPIEL: FLSpiel = {
  id: "6890a1b2c3d4e5f607184001",
  spieltag_id: "6890a1b2c3d4e5f607184041",
  team1: { team_id: ALPHA, name: "FC Alpha", shorthand: "AL", tore: null, austritt_type: null },
  team2: { team_id: "6890a1b2c3d4e5f607184012", name: "SV Beta", shorthand: "BE", tore: null, austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
  datum: "2026-08-01",
  uhrzeit: "18:00",
  ort: { spielort_id: NORD, name: "Sportpark Nord", maps_link: "Sportpark Nord, Frankfurt" },
  schiedsrichter: { schiedsrichter_id: "6890a1b2c3d4e5f607184031", name: "Pierluigi Collina" },
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 1,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2526",
  notiz: null,
  ansetzung_bestaetigt: null,
};

/** The public route's props: its tier reads the season's clubs and no venue or referee list. */
const OEFFENTLICH: ViewProps = {
  spiele: [SPIEL],
  today: "2026-07-29",
  isFinishedSaison: false,
  teams: [
    { id: ALPHA, name: "FC Alpha" },
    { id: GAMMA, name: "TSV Gamma" },
  ],
};

/** The admin route's props: every venue and referee as well. */
const ADMIN: ViewProps = {
  ...OEFFENTLICH,
  isAdmin: true,
  spielorte: [
    { id: NORD, name: "Sportpark Nord" },
    { id: SUED, name: "Sportplatz Süd" },
  ],
  schiedsrichter: [{ id: BEISPIEL, name: "Rafael Beispiel" }],
};

const renderView = (query: string, props: ViewProps = ADMIN) => render(underNext(h(SpielsucheView, props), { search: query }));

/** What a reader types into the bar, which the view holds and the URL never carries. */
const typeQuery = (query: string): void => {
  fireEvent.change(screen.getByRole("searchbox", { name: "Spiele suchen" }), { target: { value: query } });
};

const PROMPT = "Suche nach einem Spiel oder setze einen Filter.";

describe("a link naming a value no fixture of the season holds", () => {
  /* The referee list's „Einsätze anzeigen“ opens the running season, where the referee may have officiated
     nothing: the page still has to say whose fixtures it was asked for, and that none match. */
  it("keeps the club, venue or referee as a pill under its own name, and says nothing matches", () => {
    for (const [query, pill] of [
      [`schiedsrichter=${BEISPIEL}`, "Rafael Beispiel: Schiedsrichter"],
      [`team=${GAMMA}`, "TSV Gamma: Team"],
      [`ort=${SUED}`, "Sportplatz Süd: Ort"],
    ] as const) {
      const { unmount } = renderView(query);

      screen.getByRole("button", { name: `${pill} ändern` });
      screen.getByText("Keine Spiele für diese Filter.");
      unmount();
    }
  });

  it("keeps a club on the public route, and drops a venue its tier reads no list of", () => {
    const { unmount } = renderView(`team=${GAMMA}`, OEFFENTLICH);
    screen.getByRole("button", { name: "TSV Gamma: Team ändern" });
    unmount();

    renderView(`ort=${SUED}`, OEFFENTLICH);
    assert.ok(screen.queryByRole("button", { name: /: Ort ändern$/ }) === null, "a venue no list labels is kept as a pill");
    screen.getByText(PROMPT);
  });

  /* The other half of the kept value, which a view keeping every value would pass. */
  it("drops an id naming nothing that exists, and prompts for a search", () => {
    renderView(`schiedsrichter=${NIEMAND}`);

    assert.ok(screen.queryByRole("button", { name: /^Schiedsrichter: / }) === null, "a referee no list labels is kept as a pill");
    screen.getByText(PROMPT);
  });
});

describe("the sentence under the bar", () => {
  it("draws none where a filter finds a fixture", () => {
    renderView(`team=${ALPHA}`);

    screen.getByRole("button", { name: "FC Alpha: Team ändern" });
    assert.ok(screen.queryByText(/^Keine Spiele|^Suche nach/) === null, "a list with rows still shows an empty state");
  });

  // Every other list closes its empty sentence with a full stop.
  it("names the search that found nothing, closed like every other list's sentence", () => {
    renderView("");
    typeQuery("zzzzzz");

    screen.getByText("Keine Spiele für „zzzzzz“.");
  });
});

describe("the query a reader types", () => {
  /* The search reaches a referee's name, and a URL is a request line the edge keeps, a history entry
     and a `Referer` (`docs/frontend/spec.md :: I680`). */
  it("finds by what is typed and writes no URL", async () => {
    // Every timer held to the case's own clock, so a write owed after any debounce is flushed below.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const before = window.location.href;
      const { router, seen } = recordingRouter();
      render(underNext(h(SpielsucheView, ADMIN), { router: router }));

      typeQuery("Collina");
      assert.ok(screen.queryAllByText("FC Alpha").length > 0, "the referee's fixture was not found, so the absence below proves nothing");
      await act(async () => {
        mock.timers.runAll();
      });

      assert.deepEqual([...seen.replaced, ...seen.pushed], [], "the bar navigated, which is the request line nginx logs");
      assert.equal(window.location.href, before, "the bar wrote the query into the browser's history");
    } finally {
      mock.timers.reset();
    }
  });

  /* The read half: a link or a bookmark carrying `?q=` is no way into a search. */
  it("finds nothing by a query the URL carries", () => {
    renderView("q=Collina");

    screen.getByText(PROMPT);
  });
});

describe("the date a typed query is matched against", () => {
  /** Two fixtures a stored spelling would confuse: the day of the first reads, stored, as the second's month. */
  const MAERZ: FLSpiel = { ...SPIEL, datum: "2026-03-14" };
  const NOVEMBER: FLSpiel = {
    ...SPIEL,
    id: "6890a1b2c3d4e5f607184002",
    spiel_nr: 2,
    datum: "2026-11-03",
    team1: { team_id: GAMMA, name: "TSV Gamma", shorthand: "GA", tore: null, austritt_type: null },
    team2: { team_id: "6890a1b2c3d4e5f607184014", name: "SC Delta", shorthand: "DE", tore: null, austritt_type: null },
  };

  /** Which of the two fixtures a typed query leaves on screen. */
  const found = (query: string): string[] => {
    const { unmount } = renderView("", { ...ADMIN, spiele: [MAERZ, NOVEMBER] });
    typeQuery(query);
    const shown = ["FC Alpha", "TSV Gamma"].filter((team) => screen.queryAllByText(team).length > 0);
    unmount();

    return shown;
  };

  /* One formatter for both spellings, or the searched date drifts off the rendered one the day the
     rendered format changes. */
  it("finds a fixture by the date its card prints", () => {
    assert.deepEqual(found(formatSpielDatum(MAERZ.datum)), ["FC Alpha"]);
  });

  /* No surface renders the stored spelling, so nobody has seen one to type, and a key for it would
     only widen a numeric query: "2026-03" would then also reach the fixture played in November. */
  it("reaches no fixture of another month through the stored spelling", () => {
    assert.deepEqual(found("2026-03"), [], "the stored date is searched, and a month typed in its spelling reaches November");
  });
});

describe("the clubs' answers on the admin search's cards", () => {
  const ANGESETZT = { ...SPIEL, uhrzeit: "18:00:00" };
  const ZUSAGE = FLSpielbestaetigungSchema.parse(
    spielbestaetigungFields({
      spiel_id: SPIEL.id,
      partei: { art: "team", team_id: ALPHA },
      ansetzung: {
        datum: SPIEL.datum ?? "",
        uhrzeit: "18:00:00",
        spielort_id: NORD,
        team1_id: ALPHA,
        team2_id: "6890a1b2c3d4e5f607184012",
        stand: "0".repeat(64),
      },
      antwort: { art: "zugesagt", am: "2026-07-20", von: { art: "kontakt", rolle: "trainer" }, vorschlag: null, begruendung: null },
    }),
  );

  it("names each club's answer on the card it found", () => {
    renderView(`team=${ALPHA}`, { ...ADMIN, spiele: [ANGESETZT], bestaetigungen: [ZUSAGE] });

    screen.getByText("FC Alpha: Zugesagt");
  });

  // An unread answer and an unasked fixture would read alike on the card, so the page says which it is.
  it("says the answers could not be read, rather than showing cards that read as asked nothing", () => {
    renderView("", { ...ADMIN, bestaetigungen: null });

    screen.getByText("Die Spielbestätigungen ließen sich gerade nicht lesen");
  });

  // A cut read names what it cut, or the cards it shorted read as complete.
  it("says the answers were cut, and what the cut can leave out", () => {
    renderView("", { ...ADMIN, spiele: [ANGESETZT], bestaetigungen: [ZUSAGE], bestaetigungenVollstaendig: false });

    screen.getByText("Die Spielbestätigungen sind unvollständig");
    screen.getByText(/von den geschlossenen nur die neuesten/);
  });
});
