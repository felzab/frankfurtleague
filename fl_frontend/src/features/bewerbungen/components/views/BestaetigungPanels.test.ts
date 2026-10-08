import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRef } from "react";

import { act, renderHook } from "@testing-library/react";

import { readEinwilligungDocument } from "@/core/einwilligungDocument.ts";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";
import { filledSlots } from "@/shared/testing/stampedText.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdresseGesperrt, LinkUnlesbar, useLinkSeite } = await import("./BestaetigungPanels.tsx");
const { Gefuellt } = await import("../ui/Gefuellt.tsx");

const PFAD = "/bestaetigung/kontakt";
const MIT_TOKEN = `${PFAD}?token=kein-echtes-token`;

/** The address the page stands at, as the address bar shows it. */
const adresse = (): string => `${window.location.pathname}${window.location.search}`;

describe("a stamped sentence with its slots filled", () => {
  it("leaves a slot no record filled standing", () => {
    const html = renderMarkup(Gefuellt, { text: "{rolle} für {schule}", werte: { schule: "Lessing-Kolleg" }, eigene: new Set<string>() });

    assert.equal(textOf(html), "{rolle} für Lessing-Kolleg");
  });

  /* The suites compare a rendered page with `filledSlots`: where the two part, a negative comparison
     passes on a sentence no page could show. */
  it("reads as the suites' oracle fills it, for every stamped paragraph and every map", () => {
    const vorlagen = [
      ...Object.values(readEinwilligungDocument().fassungen).flatMap((fassung) => fassung.absaetze),
      "in der {datenschutz}",
      "{constructor}, {toString} und {__proto__}",
      "{rolle} für {unbekannt}",
    ];
    const namen = [...new Set(vorlagen.flatMap((vorlage) => [...vorlage.matchAll(/\{(\w+)\}/g)].map((treffer) => treffer[1] ?? "")))];
    const karten: Readonly<Record<string, string>>[] = [
      {},
      Object.fromEntries(
        namen.filter((name) => !["datenschutz", "constructor", "toString", "__proto__"].includes(name)).map((name) => [name, `Wert ${name}`]),
      ),
      Object.fromEntries(namen.map((name) => [name, `Wert ${name}`])),
    ];
    const gelesen = (html: string): string => {
      const knoten = document.createElement("div");
      knoten.innerHTML = html;
      return knoten.textContent;
    };

    const abweichend = karten.flatMap((werte) =>
      vorlagen.flatMap((text) => {
        const seite = gelesen(renderMarkup(Gefuellt, { text: text, werte: werte, eigene: new Set(Object.keys(werte)) }));
        return seite === filledSlots(text, werte) ? [] : [`${text.slice(0, 40)} under ${String(Object.keys(werte).length)} slots`];
      }),
    );

    assert.ok(vorlagen.length > 4, "no stamped paragraph was read, so nothing was compared");
    assert.deepEqual(abweichend, [], "the oracle fills these as no page shows them");
  });
});

describe("the address a link page opened under", () => {
  it("loses the token and keeps the path", () => {
    window.history.replaceState(null, "", MIT_TOKEN);
    renderHook(() => useLinkSeite("gueltig"));

    assert.equal(adresse(), PFAD, "the token stays in the address bar, a bookmark and a screenshot");
  });

  it("keeps the token while the read failed", () => {
    window.history.replaceState(null, "", MIT_TOKEN);
    renderHook(() => useLinkSeite("unlesbar"));

    assert.equal(adresse(), MIT_TOKEN, "a reload can no longer retry the read the page could not make");
  });
});

describe("the panel that answers a press", () => {
  it("takes the focus once the press is answered, and not before", () => {
    const panel = document.body.appendChild(document.createElement("section"));
    panel.tabIndex = -1;
    const { result } = renderHook(() => useLinkSeite("gueltig"));
    result.current.ergebnisRef.current = panel;

    // A boolean rather than the node: a failing `assert.equal` inspects its operand without a depth
    // bound, and a DOM node's graph exhausts the machine's memory before the message is built.
    const vorher = document.activeElement === panel;
    act(() => result.current.beantwortet());
    const nachher = document.activeElement === panel;
    panel.remove();

    assert.ok(!vorher, "the panel took the focus before anything was pressed");
    assert.ok(nachher, "the answer replaced the form and the focus fell to the page");
  });

  /* A dead link renders the panel carrying the ref at load, so the ref is attached before the first effects run:
     attached afterwards, as above, a focus on mount would find no panel and pass unseen. */
  it("takes no focus on the first render, with the panel already attached", () => {
    const panel = document.body.appendChild(document.createElement("section"));
    panel.tabIndex = -1;
    renderHook(() => {
      const seite = useLinkSeite("abgelaufen");
      seite.ergebnisRef.current = panel;
      return seite;
    });

    // A boolean rather than the node, as above.
    const genommen = document.activeElement === panel;
    panel.remove();

    assert.ok(!genommen, "the panel took the focus as the page loaded");
  });
});

describe("what a link to a barred address opens on", () => {
  /* The page is the sentence and nothing else: a Widerspruch or a question goes by mail to the
     address the sentence names, so no heading, form, press or link stands beside it. */
  it("shows the approved sentence and nothing else", () => {
    const html = renderMarkup(AdresseGesperrt, { panelRef: createRef<HTMLElement>() });

    // Written out here, once: every other barred-link case compares with the constant, which a
    // rewording of the constant alone would carry along with it.
    assert.equal(
      textOf(html, " ").replace(/\s+/g, " ").trim(),
      "Deine E-Mail-Adresse ist gesperrt. Wenn Du das für einen Fehler hältst, schreib uns an kontakt@frankfurtleague.de.",
    );
    assert.doesNotMatch(html, /<(h[1-6]|form|button|a|input)\b/, "the barred page renders something beside the sentence");
    assert.match(html, /role="status"/, "the barred page is announced to nobody");
  });

  it("stands in the column every other state of the page stands in", () => {
    const html = renderMarkup(AdresseGesperrt, { panelRef: createRef<HTMLElement>() });

    assert.ok(html.startsWith(`<section class="${SEITE_CLASSES}">`), "the barred page draws a column of its own");
  });
});

/* Every page a token link opens shows this panel where its read failed, so its words are pinned here once. */
describe("what a link nobody could check opens on", () => {
  it("says it does not know and offers the mailbox, calling the link neither live nor void", () => {
    const html = renderMarkup(LinkUnlesbar, {});

    assert.equal(
      textOf(html, " ").replace(/\s+/g, " ").trim(),
      "Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns. Frage stellen",
    );
    assert.match(html, /href="mailto:kontakt@frankfurtleague\.de"/);
  });
});
