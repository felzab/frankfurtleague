import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import {
  BESTAETIGUNG_ABSAETZE,
  SCHIEDSRICHTER_ABSAETZE,
  SCHIEDSRICHTER_EINWILLIGUNG,
  SCHIEDSRICHTER_MEDIEN_SCHALTER,
} from "@/core/einwilligung.ts";
import {
  SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE,
  SCHIEDSRICHTER_UMFANG_FRAGE,
  SCHIEDSRICHTER_UMFANG_OPTIONS,
} from "@/features/schiedsrichter/constants.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";
import { ANTWORT_UNKLAR } from "@/shared/utils/publicSubmit.ts";

import type { SchiedsrichterBestaetigungStart } from "./SchiedsrichterBestaetigungView.tsx";

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SchiedsrichterBestaetigungView } = await import("./SchiedsrichterBestaetigungView.tsx");
const { UNHANDLED_FIELD_REFUSAL } = await import("@/shared/hooks/useServerFieldErrors.ts");

const TOKEN = "abc123";
/** Typed rather than taken from `SCHIEDSRICHTER_MIN_ALTER`: the page judges by the floor the read serves, which is the one the link was minted under. */
const MINDESTALTER = 16;
/** The media age this fixture's read answers, for `MINDESTALTER`'s reason. */
const MEDIEN_ALTER = 18;
const FASSUNG = SCHIEDSRICHTER_EINWILLIGUNG.textVersion;

const OFFEN: SchiedsrichterBestaetigungStart = {
  zustand: "gueltig",
  token: TOKEN,
  ansicht: {
    acknowledged: 1,
    zustand: "gueltig",
    vorname: "Anna",
    text_version: FASSUNG,
    mindestalter: MINDESTALTER,
    medien_mindestalter: MEDIEN_ALTER,
    frist: "2026-10-05",
  },
};

/** A birthdate this many whole years before the German day the page judges by, moved later by `tageSpaeter`. */
const geborenVor = (jahre: number, tageSpaeter = 0): string =>
  parseDate(getGermanTodayStr()).subtract({ years: jahre }).add({ days: tageSpaeter }).toString();

/** A date as the picker's segments take it typed: day, month, year. */
const getippt = (datum: string): string => {
  const [jahr, monat, tag] = datum.split("-");

  return `${tag ?? ""}${monat ?? ""}${jahr ?? ""}`;
};

/** Types a date into the empty picker, which is what offers the media switch to a person of the media age. */
async function tippeGeburtsdatum(user: ReturnType<typeof userEvent.setup>, datum: string): Promise<void> {
  await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
  await user.keyboard(getippt(datum));
}

/**
 * Every slot the page fills, so a paragraph is compared as a reader meets it. `{loeschung}` is left
 * standing on both sides, the account page it names being Programme 2's.
 */
const gefuellt = (absatz: string): string =>
  absatz
    .replaceAll("{minAlter}", String(MINDESTALTER))
    .replaceAll("{medienMinAlter}", String(MEDIEN_ALTER))
    .replaceAll("{vorname}", "Anna")
    .replaceAll("{kontakt}", KONTAKT_EMAIL)
    .replaceAll("{loeschung}", "Konto löschen")
    .replaceAll("{datenschutz}", "Datenschutzerklärung");

/**
 * The words on screen. Read across element boundaries so a marked name does not fuse with its
 * neighbour, then closed up again at the punctuation that followed an inline link.
 */
const words = (html: string): string =>
  textOf(html, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

const markup = (start: SchiedsrichterBestaetigungStart): string => renderTree(h(SchiedsrichterBestaetigungView, { start }));

/** A `fetch` that records the body and answers what the case chose, standing in for the route handler. */
function answerEveryFetch(answer: unknown): { sent: unknown[] } {
  const sent: unknown[] = [];

  globalThis.fetch = (async (_input: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(init?.body ?? "null"));

    return { ok: true, status: 200, json: async () => answer };
  }) as unknown as typeof globalThis.fetch;

  return { sent: sent };
}

const schalter = (name: string | RegExp): HTMLInputElement => screen.getByRole("switch", { name: name }) as HTMLInputElement;

afterEach(() => {
  toasts.length = 0;
});

describe("the referee's confirmation page", () => {
  /* Rendered rather than read off the module: a declared paragraph nobody mounts is copy nobody is
     shown (`.claude/rules/cross-surface.md`, tests). An element each, because Art. 21(4) DSGVO asks
     the objection to stand apart. */
  it("renders every paragraph of the referee's own label as an element of its own", () => {
    const elemente = [...markup(OFFEN).matchAll(/<(p|li)\b[^>]*>(.*?)<\/\1>/gs)].map((treffer) => words(treffer[2] ?? ""));

    for (const [schluessel, absatz] of Object.entries(SCHIEDSRICHTER_ABSAETZE)) {
      assert.ok(elemente.includes(words(gefuellt(absatz))), `the page renders ${schluessel} inside another element's text`);
    }
  });

  /* The label stamps the words the confirming person read, so a paragraph of the contact page on
     this screen is a record citing a text its person was never shown. */
  it("renders no paragraph of the contact person's label", () => {
    const shown = words(markup(OFFEN));

    for (const [schluessel, absatz] of Object.entries(BESTAETIGUNG_ABSAETZE)) {
      // The click points are word-for-word shared with the referee's label, so only the paragraphs
      // that differ can be compared.
      if (schluessel.startsWith("klick")) continue;

      assert.ok(!shown.includes(words(gefuellt(absatz))), `the page renders the contact page's ${schluessel}`);
    }
  });

  it("names the person once the link is open and nowhere else", () => {
    assert.match(words(markup(OFFEN)), /Anna/);

    for (const zustand of ["bestaetigt", "abgelaufen", "ungueltig", "unlesbar"] as const) {
      assert.ok(!words(markup({ zustand })).includes("Anna"), `the ${zustand} panel names the person`);
    }
  });

  it("states the deadline the endpoint refuses on in its dead-link panel", () => {
    assert.ok(words(markup({ zustand: "abgelaufen" })).includes(`${String(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage`));
  });

  /* A failed read is its own panel: folded into the dead-link one it would call a live link void on
     a day the backend was merely unreachable. */
  it("keeps the unreadable link apart from the dead one", () => {
    assert.match(words(markup({ zustand: "unlesbar" })), /gerade nicht prüfen/);
    assert.ok(!words(markup({ zustand: "unlesbar" })).includes("ungültig oder abgelaufen"));
  });

  it("announces every panel that replaces the form", () => {
    for (const zustand of ["bestaetigt", "abgelaufen", "ungueltig", "unlesbar"] as const) {
      assert.match(markup({ zustand }), /role="status"/, `the ${zustand} panel is announced to nobody`);
    }
  });
});

describe("the controls the page collects an answer with", () => {
  /* Found BY their accessible names: a page a sixteen-year-old must understand before consenting is
     one nobody needs a mouse or a sighted guess for. */
  it("gives the date control, the publication chips and the media switch an accessible name", async () => {
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    // A date of the media age, which is what puts the switch on the page at all.
    await tippeGeburtsdatum(userEvent.setup(), geborenVor(MEDIEN_ALTER + 2));

    assert.ok(screen.getByRole("group", { name: "Dein Geburtsdatum" }));
    assert.ok(screen.getByRole("radiogroup", { name: SCHIEDSRICHTER_UMFANG_FRAGE }));
    for (const option of SCHIEDSRICHTER_UMFANG_OPTIONS) assert.ok(screen.getByRole("radio", { name: option.label }));
    assert.ok(schalter(SCHIEDSRICHTER_MEDIEN_SCHALTER));
    assert.ok(screen.getByRole("button", { name: "Eintrag bestätigen" }));
  });

  /* The sibling page's order, which the tab ring cannot see: „Was Du mit dem Klick bestätigst“
     carries no control, so moving it above the answers would pass every case. A reader meets
     what they confirm after the answers. */
  it("orders the answer's sections as the pupil's page does", () => {
    const html = markup(OFFEN);
    const titel = ["Dein Geburtsdatum", "Auf der Website", "Freiwillig", "Was Du mit dem Klick bestätigst"];
    const stellen = titel.map((eins) => html.indexOf(`>${eins}<`));

    for (const [index, stelle] of stellen.entries()) assert.notEqual(stelle, -1, `the page renders no heading „${titel[index] ?? ""}“`);
    assert.deepEqual(
      [...stellen].sort((left, right) => left - right),
      stellen,
      "the sections stand in an order the copy does not read in",
    );
  });

  /* The REAL ring rather than the absence of `tabindex="-1"`: a page whose three controls were
     reordered would keep every stop and still ask the media question before the publication one. */
  it("reaches all three by keyboard, in the order the copy reads in", async () => {
    const user = userEvent.setup();
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));

    // A date of the media age first, then the ring walked again from the top of the page.
    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER + 2));
    (document.activeElement as HTMLElement | null)?.blur();

    const datum = screen.getByRole("group", { name: "Dein Geburtsdatum" });
    const wahl = screen.getByRole("radiogroup", { name: SCHIEDSRICHTER_UMFANG_FRAGE });
    const medien = schalter(SCHIEDSRICHTER_MEDIEN_SCHALTER);

    const erreicht: string[] = [];
    for (let step = 0; step < 24; step++) {
      await user.tab();
      const active = document.activeElement;
      if (active === null) continue;
      if (datum.contains(active)) erreicht.push("geburtsdatum");
      else if (wahl.contains(active)) erreicht.push("umfang");
      else if (medien === active || medien.contains(active)) erreicht.push("medien");
    }

    assert.deepEqual([...new Set(erreicht)], ["geburtsdatum", "umfang", "medien"], "the keyboard does not reach all three in the copy's order");
  });

  it("answers a keyboard press on a publication chip", async () => {
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    const user = userEvent.setup();

    const intern = screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" });
    intern.focus();
    await user.keyboard(" ");

    assert.equal(intern.getAttribute("aria-checked"), "true");
  });

  /* A field message alone says the date is refused and not what that costs the person, which is the
     one thing they act on: the pupil's page and the contact seat's each announce it. */
  it("announces what an under-age birthdate costs, saying the entry stands", async () => {
    const user = userEvent.setup();
    // A floor this page could not have retyped: at the register's own 16 a hardcoded sentence and
    // the served one read alike, and the case would pass over either.
    const anderesAlter = 18;
    render(h(SchiedsrichterBestaetigungView, { start: { ...OFFEN, ansicht: { ...OFFEN.ansicht, mindestalter: anderesAlter } } }));

    await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
    await user.keyboard("01012020");
    await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" }));
    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));

    const meldung = await screen.findByText(/noch nicht pfeifen/);
    const callout = meldung.closest("[role='status'], [role='alert']");

    assert.ok(callout !== null, "the callout reaches a reader who cannot see it appear");
    assert.match(callout.textContent ?? "", /Dein Eintrag bleibt bestehen/);
    // The SERVED floor, never a retyped one: this page's paragraphs render the same value, and a
    // literal here would say one number beside a paragraph saying another.
    assert.match(callout.textContent ?? "", new RegExp(`mindestens ${String(anderesAlter)} Jahre alt`));
  });

  /* Nothing preselected: a chip pressed on first paint records a choice the reader did not make,
     which is exactly what this page exists to ask. */
  it("preselects neither publication chip", () => {
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));

    for (const chip of screen.getAllByRole("radio")) {
      assert.equal(chip.getAttribute("aria-checked"), "false", "a publication chip is pressed before anybody pressed it");
    }
  });

  /* Off on first paint and switched by nothing but a press: a pre-ticked consent records nothing. */
  it("leaves the media switch off on first paint", async () => {
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    await tippeGeburtsdatum(userEvent.setup(), geborenVor(MEDIEN_ALTER + 2));

    for (const control of screen.getAllByRole("switch")) {
      assert.equal((control as HTMLInputElement).checked, false, "a switch is on before anybody pressed it");
    }
  });
});

describe("what the press sends", () => {
  /* The publication question is the one thing this page cannot answer for the person, so an
     unanswered one is refused here rather than stored as a scope nobody picked. */
  it("refuses a press that picked no publication answer, and sends nothing", async () => {
    const { sent } = answerEveryFetch({ success: true, umfang: "intern", medien: false, bestaetigt_am: "2026-09-21" });

    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
    await user.keyboard("01011990");
    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));

    assert.deepEqual(sent, []);
  });

  it("sends the picked scope and a false media flag rather than omitting either", async () => {
    const { sent } = answerEveryFetch({ success: true, umfang: "intern", medien: false, bestaetigt_am: "2026-09-21" });

    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
    await user.keyboard("01011990");
    await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" }));
    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));

    assert.deepEqual(sent, [{ token: TOKEN, geburtsdatum: "1990-01-01", umfang: "intern", medien: false, text_version: FASSUNG }]);
  });
});

describe("what a refused press does to the page", () => {
  /* The link died between the open and the press: the handler answers a state, and the page swaps
     the form for that panel rather than raising a toast over a form nobody can submit again. */
  for (const [zustand, ueberschrift] of [
    ["ungueltig", "Link ungültig"],
    ["abgelaufen", "Link ungültig"],
    ["bestaetigt", "Schon erledigt"],
  ] as const) {
    it(`swaps the form for the ${zustand} panel`, async () => {
      answerEveryFetch({ success: false, zustand: zustand });

      render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
      const user = userEvent.setup();

      await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
      await user.keyboard("01011990");
      await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" }));
      await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));

      assert.ok(screen.getByRole("heading", { name: ueberschrift }), "the page kept the form the press cannot use again");
      assert.ok(screen.queryByRole("button", { name: "Eintrag bestätigen" }) === null);
      assert.deepEqual(toasts, [], "a dead link was reported as a toast over a dead form");
    });
  }

  /* A refusal naming only a path no control renders: the sentence the answer brings is the one
     announced, and the generic one only where the answer brings none. */
  const EIGENER_SATZ = "Der Satz, den die Antwort für diesen Fall mitbringt.";
  for (const [angesagt, mitgebracht, erwartet] of [
    ["the answer's own sentence", { unplacedError: EIGENER_SATZ }, EIGENER_SATZ],
    ["the generic sentence where the answer brings none", {}, UNHANDLED_FIELD_REFUSAL],
  ] as const) {
    it(`announces a refusal no box can take with ${angesagt}`, async () => {
      answerEveryFetch({ success: false, fieldErrors: { text_version: "abgelehnt" }, ...mitgebracht });

      const { container } = render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
      assert.ok(container.querySelector('[name="text_version"]') === null, "the case's path is one a control renders");
      const user = userEvent.setup();

      await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
      await user.keyboard("01011990");
      await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" }));
      await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));

      await waitFor(() =>
        assert.deepEqual(
          toasts.map((toast) => [toast.variant, toast.title, toast.description]),
          [["danger", "Antwort nicht gespeichert", erwartet]],
        ),
      );
    });
  }

  /* A commit whose answer was lost: the route's sentence sends an administrator to reload and check,
     which this page cannot follow, its token being gone from the address. */
  it("titles an answer of unknown outcome as unclear, and tells the referee to reopen the link", async () => {
    answerEveryFetch({ success: false, error: "Ob die Änderung gespeichert wurde, ist unklar.", outcome: "unknown" });

    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
    await user.keyboard("01011990");
    await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" }));
    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));

    assert.deepEqual(
      toasts.map((toast) => [toast.variant, toast.title, toast.description]),
      [["danger", "Unklar, ob es bei uns angekommen ist", ANTWORT_UNKLAR]],
    );
  });
});

// Every absence below is asserted as a boolean: a failing `assert.equal` on a rendered node hands the
// runner React's whole tree to serialize, which exhausts the machine's memory.
describe("the media switch, offered from the media age alone", () => {
  const keinSchalter = (): boolean => screen.queryByRole("switch") === null;

  it("offers no switch while no birthdate says how old the referee is", () => {
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));

    assert.ok(keinSchalter(), "a referee of unknown age is offered a consent the write refuses below the media age");
  });

  it("offers no switch for a date a day short of the media age", async () => {
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    await tippeGeburtsdatum(userEvent.setup(), geborenVor(MEDIEN_ALTER, 1));

    assert.ok(keinSchalter(), "a referee under the media age is offered the media switch");
  });

  it("offers the switch for a date of the media age to the day", async () => {
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));
    await tippeGeburtsdatum(userEvent.setup(), geborenVor(MEDIEN_ALTER));

    assert.ok(!keinSchalter(), "a referee of the media age is refused the switch the ruling offers them");
  });

  it("withdraws the switch and its yes when the date moves below the media age", async () => {
    const { sent } = answerEveryFetch({ success: true, umfang: "intern", medien: false, bestaetigt_am: "2026-09-21" });
    const user = userEvent.setup();
    render(h(SchiedsrichterBestaetigungView, { start: OFFEN }));

    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER + 2));
    await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" }));
    await user.click(schalter(SCHIEDSRICHTER_MEDIEN_SCHALTER));
    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER - 1));

    assert.ok(keinSchalter(), "the switch stands for a date under the media age");

    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));

    assert.equal(sent.length, 1, "the press sent nothing, so this case compares nothing");
    assert.equal((sent[0] as { medien?: unknown }).medien, false, "the yes given at the older date was sent for the younger one");
  });
});
