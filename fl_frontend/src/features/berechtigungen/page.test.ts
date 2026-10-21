import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import { GELOESCHTE_PERSON } from "@/features/berechtigungen/constants.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { assertLeerMarkup } from "@/shared/testing/leerGrade.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, renderPage } from "@/shared/testing/pageHarness.ts";
import { refusalWrappers, renderTree, textOf } from "@/shared/testing/renderTest.ts";

const { setSession } = doubleActionRequest();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminAdministratorenPage } = await import("@/app/bereich/admin/administratoren/page.tsx");

const INHABER = {
  id: "6890a1b2c3d4e5f6071b0001",
  adresse: "inhaber@schule.de",
  gesperrt: false,
  verwaltung: "owner",
  erteilt_von: "PLAYGROUND",
  erteilt_von_gesperrt: false,
  erteilt_am: "2026-09-27T01:00:00Z",
  adresswechsel: null,
};
const VORSTAND = {
  id: "6890a1b2c3d4e5f6071b0002",
  adresse: "vorstand@schule.de",
  gesperrt: false,
  verwaltung: "administration",
  erteilt_von: "inhaber@schule.de",
  erteilt_von_gesperrt: false,
  // Past 22:00 UTC: already the 28th in Berlin.
  erteilt_am: "2026-09-27T22:30:00Z",
  adresswechsel: null,
};
const GESPERRT = {
  id: "6890a1b2c3d4e5f6071b0003",
  adresse: null,
  gesperrt: true,
  verwaltung: "administration",
  erteilt_von: null,
  erteilt_von_gesperrt: true,
  erteilt_am: "2026-09-27T03:00:00Z",
  adresswechsel: null,
};

const ZWEITER_INHABER = { ...VORSTAND, id: "6890a1b2c3d4e5f6071b0004", adresse: "kasse@schule.de", verwaltung: "owner" };

/** The tier the lookup answers the signed-in administrator, until a case names another. */
let eigeneVerwaltung: "owner" | "administration" = "administration";

/** When an `owner` tier took effect: before the session each case signs in, until a case names a later one. */
const VOR_JEDER_SITZUNG = "2026-01-01T00:00:00Z";
let inhaberSeit = VOR_JEDER_SITZUNG;

/** The grants the list answers, until a case names others. */
let zeilen: object[] = [INHABER, VORSTAND, GESPERRT];

/** The requests the list answers, none until a case names some. */
let antraege: object[] = [];

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/berechtigungen") return answer(schema, endpoint, { berechtigungen: zeilen, uebersprungen: 0, antraege });
  if (endpoint === "/identitaet/subjekt") {
    return answer(schema, endpoint, {
      verwaltung: eigeneVerwaltung,
      berechtigt_seit: VOR_JEDER_SITZUNG,
      inhaber_seit: eigeneVerwaltung === "owner" ? inhaberSeit : null,
    });
  }
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

beforeEach(() => {
  eigeneVerwaltung = "administration";
  inhaberSeit = VOR_JEDER_SITZUNG;
  zeilen = [INHABER, VORSTAND, GESPERRT];
  antraege = [];
  setSession({ user: { email: "vorstand@schule.de" } });
});

const PAGE = underNext(h(AdminAdministratorenPage, {}), { pathname: "/bereich/admin/administratoren" });

/** The words on each button the page renders. */
const buttonWords = (html: string): string[] =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((hit) =>
    textOf(hit[1] ?? "", " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

/** The name a screen reader hears for each button: its `aria-label` where it has one, else its words. */
const buttonNames = (html: string): string[] =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    (hit) =>
      /\saria-label="([^"]*)"/.exec(hit[1] ?? "")?.[1] ??
      textOf(hit[2] ?? "", " ")
        .replace(/\s+/g, " ")
        .trim(),
  );

describe("the page the administrators stand on", () => {
  it("raises no heading the shell already owns", async () => {
    const markup = await renderPage(PAGE);

    assert.ok(markup.includes(VORSTAND.adresse), "the list renders no grant, so the absence below proves nothing");
    assert.ok(!markup.includes("<h1"), "the page raises an h1 the shell already owns");
  });

  it("renders its chrome before the list resolves", () => {
    const markup = renderTree(PAGE);

    assert.ok(markup.includes('role="status"'), "no fallback stands where the list will resolve");
    assert.ok(markup.includes('type="search"'), "the page's bar waits on the list");
  });

  /* The runbook's paste writes a marker, not a person: the row says where it came from instead. */
  it("names a grant pasted into the database by where it came from", async () => {
    const text = textOf(await renderPage(PAGE), " ");

    assert.ok(text.includes("Direkt in der Datenbank"));
    assert.ok(!text.includes("PLAYGROUND"), "the paste's raw marker reached the page");
  });

  /* An administrator barred since is withheld as a barred grant is: the row names the state, never an empty cell. */
  it("names a grant's barred administrator by their state", async () => {
    const text = textOf(await renderPage(PAGE), " ");

    assert.equal(text.split("Gesperrte Adresse").length - 1, 2, "the barred row's address and its administrator are not both named by state");
    const html = await renderPage(PAGE);
    assert.equal(
      html.split(`<span class="text-foreground-muted not-italic">Gesperrte Adresse</span>`).length - 1,
      2,
      "a withheld address keeps a name's ink",
    );
  });

  /* An erasure leaves a marker naming nobody in the granter's place, which the row's own paste check
     must pass through to the shared words rather than print. */
  it("names a grant's administrator erased since by that state, and never as barred", async () => {
    zeilen = [INHABER, { ...VORSTAND, erteilt_von: ERASED_ACTOR_MARKER }];
    const html = await renderPage(PAGE);
    const text = textOf(html, " ");

    assertLeerMarkup(html, GELOESCHTE_PERSON);
    assert.ok(!text.includes(ERASED_ACTOR_MARKER), "the marker reached the page");
    assert.ok(!text.includes("Gesperrte Adresse"), "an erased administrator reads as barred");
  });

  it("dates a grant by the Berlin day it was made on", async () => {
    const text = textOf(await renderPage(PAGE), " ");

    assert.ok(text.includes("28.09.2026"), "the grant is dated by its UTC day");
  });

  /* A barred address is answered on no route, so the row names the state and never an address. */
  it("names a barred grant by its state, and badges the `owner` grant", async () => {
    const text = textOf(await renderPage(PAGE), " ");

    assert.ok(text.includes("Gesperrte Adresse"));
    assert.ok(text.includes("Inhaber"));
  });
});

describe("who is offered the revoke", () => {
  /* Only an `owner` grant revokes, and the backend refuses everybody else: the control stands closed, saying why. */
  it("shows an administrator holding no `owner` grant every revoke closed, with the reason", async () => {
    const markup = await renderPage(PAGE);
    const revokes = [...markup.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?entziehen(?:(?!<\/button>)[\s\S])*?<\/button>/g)].map(
      ([tag]) => tag,
    );

    assert.equal(revokes.length, 2, "not one revoke per grant but the owner's");
    assert.ok(
      revokes.every((tag) => /\bdisabled\b/.test(tag)),
      "a revoke the backend refuses is open to press",
    );
    assert.ok(textOf(markup, " ").includes("Den Zugang entziehen können nur Inhaberinnen und Inhaber."), "the closed revoke says not why");
    // Every revoke closed at once is where one name per row matters most: the overlay is each one's only stop.
    assert.deepEqual(
      refusalWrappers(markup).map(({ name }) => name),
      ["Zugang entziehen: vorstand@schule.de", "Zugang entziehen: Zugang vom 27.09.2026"],
    );
  });

  /* No request changes an `owner` grant, so its row carries no control even for an owner. */
  it("offers an owner a revoke on every grant but an `owner` one", async () => {
    eigeneVerwaltung = "owner";
    setSession({ user: { email: INHABER.adresse } });

    const markup = await renderPage(PAGE);
    const names = buttonNames(markup);

    // Each named by its row, the withheld address by its day, so a screen reader tells one from the next.
    assert.deepEqual(
      names.filter((name) => name.startsWith("Zugang entziehen")),
      ["Zugang entziehen: vorstand@schule.de", "Zugang entziehen: Zugang vom 27.09.2026"],
    );
    assert.ok(!textOf(markup, " ").includes("Den Zugang entziehen können nur Inhaberinnen und Inhaber."), "the owner's revoke is closed");
  });
});

describe("who is offered the tier change", () => {
  const stufenNamen = (html: string): string[] =>
    buttonNames(html).filter((name) =>
      /^(Mich zur Verwaltung herabstufen|Zur Inhaberin oder zum Inhaber ernennen|Zur Verwaltung herabstufen)\b/.test(name),
    );

  /* An owner's control alone: shown closed to anybody else, it would offer a change nothing on the page can make. */
  it("shows an administrator holding no `owner` grant no tier change at all", async () => {
    assert.deepEqual(stufenNamen(await renderPage(PAGE)), []);
  });

  /* Each named by its row and the tier it moves to, the signed-in row as the administrator's own; a session
     spelling its address in capitals still finds that row, every grant being stored folded. */
  it("offers an owner a promotion on each administrator's grant and a step-down on their own", async () => {
    eigeneVerwaltung = "owner";
    setSession({ user: { email: "Inhaber@Schule.de" } });

    const markup = await renderPage(PAGE);

    assert.deepEqual(stufenNamen(markup), [
      "Mich zur Verwaltung herabstufen",
      "Zur Inhaberin oder zum Inhaber ernennen: vorstand@schule.de",
      "Zur Inhaberin oder zum Inhaber ernennen: Zugang vom 27.09.2026",
    ]);
    // A barred address is made an owner by no request: its promotion stands closed, saying why.
    const gesperrt = [...markup.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g)]
      .map(([tag]) => tag)
      .find((tag) => tag.includes('aria-label="Zur Inhaberin oder zum Inhaber ernennen: Zugang vom 27.09.2026"'));
    assert.ok(gesperrt !== undefined && /\bdisabled\b/.test(gesperrt), "a promotion the backend refuses is open to press");
    assert.ok(textOf(markup, " ").includes("Diese Adresse ist gesperrt."), "the closed promotion says not why");
    assert.deepEqual(
      refusalWrappers(markup).map(({ name }) => name),
      ["Zur Inhaberin oder zum Inhaber ernennen: Zugang vom 27.09.2026"],
      "the closed promotion's one stop names no row",
    );
  });

  /* An address is one word a phone's width cannot seat beside a verb, so the words on a control stay short
     and the row goes in the name a screen reader hears. */
  it("keeps the words on each control short, the row in its name", async () => {
    eigeneVerwaltung = "owner";
    setSession({ user: { email: INHABER.adresse } });
    zeilen = [INHABER, VORSTAND, GESPERRT, ZWEITER_INHABER];

    const words = buttonWords(await renderPage(PAGE)).filter((word) => /ernennen$|herabstufen$|entziehen$/.test(word));

    assert.deepEqual([...new Set(words)].sort(), [
      "Mich zur Verwaltung herabstufen",
      "Zugang entziehen",
      "Zur Inhaberin oder zum Inhaber ernennen",
      "Zur Verwaltung herabstufen",
    ]);
  });

  /* The backend refuses an owner's write from a sign-in older than the promotion (`docs/frontend/spec.md :: I535`),
     so that session stands where an administrator does until it signs in again. */
  it("offers an owner signed in before the promotion no tier change, and every revoke closed with the reason", async () => {
    eigeneVerwaltung = "owner";
    inhaberSeit = new Date(Date.now() + 60_000).toISOString();
    setSession({ user: { email: INHABER.adresse } });

    const markup = await renderPage(PAGE);

    assert.deepEqual(stufenNamen(markup), []);
    assert.ok(textOf(markup, " ").includes("Den Zugang entziehen können nur Inhaberinnen und Inhaber."), "the closed revoke says not why");
  });

  it("offers an owner the demotion of another owner, and no revoke of either `owner` grant", async () => {
    eigeneVerwaltung = "owner";
    setSession({ user: { email: INHABER.adresse } });
    zeilen = [INHABER, ZWEITER_INHABER];

    const names = buttonNames(await renderPage(PAGE));

    assert.deepEqual(
      names.filter((name) => /ernennen|herabstufen|entziehen/.test(name)),
      ["Mich zur Verwaltung herabstufen", "Zur Verwaltung herabstufen: kasse@schule.de"],
    );
  });
});

describe("who is offered an address change's approval", () => {
  const wartend = (verwehrt: "eigene" | "gestartet" | "inhaber" | "juenger" | null) => ({
    ...VORSTAND,
    adresswechsel: {
      id: "68c1f0a2b3c4d5e6f7a8b9e0",
      email: "vorstand@neu.de",
      email_gesperrt: false,
      weg: "konto" as const,
      gestartet_von: null,
      gestartet_von_gesperrt: false,
      grund: null,
      bestaetigt: true,
      bis: "2026-10-27T11:30:00Z",
      verwehrt,
    },
  });

  /* On the grant the change moves, where granting and revoking already are: one place for the approval. */
  it("shows the change on the grant it moves, with the press named by its row and its deadline in Berlin", async () => {
    zeilen = [INHABER, wartend(null)];

    const markup = await renderPage(PAGE);

    assert.match(
      textOf(markup, " ").replace(/\s+/g, " "),
      /Neue Adresse für diesen Zugang: vorstand@neu\.de ?\. Sie ist bestätigt\. Genehmigen bis 27\. Oktober 2026 um 12:30 ?\./,
    );
    assert.deepEqual(
      buttonNames(markup).filter((name) => name.startsWith("Adressänderung genehmigen")),
      ["Adressänderung genehmigen: vorstand@schule.de"],
    );
  });

  /* The backend refuses each of these: the press stands closed, saying why in its refusal's words. */
  for (const [verwehrt, satz] of [
    [
      "eigene",
      "Eine Änderung Deiner eigenen Adresse genehmigt eine andere Person aus der Verwaltung, die neue Adresse eines Zugangs als Inhaberin oder Inhaber nur eine andere Inhaberin oder ein anderer Inhaber.",
    ],
    [
      "gestartet",
      "Eine Änderung, die Du selbst begonnen hast, genehmigt eine andere Person aus der Verwaltung, die neue Adresse eines Zugangs als Inhaberin oder Inhaber nur eine andere Inhaberin oder ein anderer Inhaber.",
    ],
    // An owner signed in before their promotion is refused too, and is told the repair.
    [
      "inhaber",
      "Die neue Adresse eines Zugangs als Inhaberin oder Inhaber genehmigt nur eine andere Inhaberin oder ein anderer Inhaber. Bist Du erst nach Deiner Anmeldung Inhaberin oder Inhaber geworden, melde Dich neu an.",
    ],
    [
      "juenger",
      "Genehmigen kann nur, wer schon vor dem Beginn der Änderung Zugang zur Verwaltung hatte, die neue Adresse eines Zugangs als Inhaberin oder Inhaber nur, wer schon vorher Inhaberin oder Inhaber war.",
    ],
  ] as const) {
    it(`closes the press where the read says ${verwehrt}, saying why`, async () => {
      zeilen = [INHABER, wartend(verwehrt)];

      const markup = await renderPage(PAGE);

      assert.deepEqual(
        refusalWrappers(markup)
          .map(({ name }) => name)
          .filter((name) => name.startsWith("Adressänderung genehmigen")),
        ["Adressänderung genehmigen: vorstand@schule.de"],
      );
      assert.ok(textOf(markup, " ").includes(satz), "the closed approval says not why");
    });
  }

  it("shows no approval on a grant no change waits at", async () => {
    const names = buttonNames(await renderPage(PAGE));

    assert.deepEqual(
      names.filter((name) => name.startsWith("Adressänderung genehmigen")),
      [],
    );
  });
});

describe("the grants and promotions waiting on a second administrator", () => {
  // Asked on a summer day and open until after the clocks change, so each instant is read in its own Berlin offset.
  const antrag = (felder: object = {}) => ({
    id: "68c1f0a2b3c4d5e6f7a8b9e1",
    adresse: "neu@schule.de",
    gesperrt: false,
    berechtigung_id: null,
    verwaltung: "administration",
    gestartet_von: "inhaber@schule.de",
    gestartet_von_gesperrt: false,
    angefragt_am: "2026-10-20T11:30:00Z",
    bis: "2026-10-27T11:30:00Z",
    steht: true,
    verwehrt: null,
    ...felder,
  });
  const antragNamen = (html: string): string[] => buttonNames(html).filter((name) => name.startsWith("Antrag "));
  const geschlossen = (html: string): string[] =>
    refusalWrappers(html)
      .map(({ name }) => name)
      .filter((name) => name.startsWith("Antrag "));

  /* A request is a decision owed: with none, nothing stands where one would, its heading included. */
  it("shows no section while no request waits", async () => {
    const markup = await renderPage(PAGE);

    assert.ok(!textOf(markup, " ").includes("Offene Anträge"), "an empty section stands on the page");
  });

  it("lists a request under its heading with what it asks, who asked and when, and until when, each in Berlin", async () => {
    antraege = [antrag()];

    const markup = await renderPage(PAGE);
    const text = textOf(markup, " ").replace(/\s+/g, " ");

    assert.match(markup, /<h2\b[^>]*>Offene Anträge<\/h2>/);
    for (const fakt of ["Zugang zur Verwaltung", "inhaber@schule.de", "20. Oktober 2026 um 13:30", "27. Oktober 2026 um 12:30"]) {
      assert.ok(text.includes(fakt), `the request's row says not ${fakt}`);
    }
    assert.deepEqual(antragNamen(markup), ["Antrag genehmigen: neu@schule.de", "Antrag ablehnen: neu@schule.de"]);
    assert.deepEqual(geschlossen(markup), [], "an approver's controls stand closed");
  });

  it("names a promotion by what it asks", async () => {
    antraege = [antrag({ verwaltung: "owner", berechtigung_id: VORSTAND.id, adresse: VORSTAND.adresse })];

    assert.ok(textOf(await renderPage(PAGE), " ").includes("Ernennung zur Inhaberin oder zum Inhaber"));
  });

  /* The backend refuses both presses to each of these readers: each stands closed, saying why in its refusal's words. */
  for (const [verwehrt, satz] of [
    [
      "eigene",
      "Über einen Antrag, der Dich betrifft, entscheidet eine andere Person aus der Verwaltung, über eine Ernennung eine andere Inhaberin oder ein anderer Inhaber.",
    ],
    ["inhaber", "Über eine Ernennung zur Inhaberin oder zum Inhaber entscheidet nur eine andere Inhaberin oder ein anderer Inhaber."],
    ["juenger", "Entscheiden kann nur, wer schon vor dem Antrag Zugang zur Verwaltung hatte"],
  ] as const) {
    it(`closes both presses where the read says ${verwehrt}, saying why`, async () => {
      antraege = [antrag({ verwehrt })];

      const markup = await renderPage(PAGE);

      assert.deepEqual(geschlossen(markup), ["Antrag genehmigen: neu@schule.de", "Antrag ablehnen: neu@schule.de"]);
      assert.ok(textOf(markup, " ").includes(satz), "the closed presses say not why");
    });
  }

  /* Who made a request may always take it back, and never approves it. */
  it("offers its requester the withdrawal and the approval closed, saying why", async () => {
    antraege = [antrag({ verwehrt: "gestartet" })];

    const markup = await renderPage(PAGE);

    assert.deepEqual(antragNamen(markup), ["Antrag genehmigen: neu@schule.de", "Antrag zurückziehen: neu@schule.de"]);
    assert.deepEqual(geschlossen(markup), ["Antrag genehmigen: neu@schule.de"]);
    assert.ok(
      textOf(markup, " ").includes(
        "Einen Antrag, den Du gestellt hast, genehmigt eine andere Person aus der Verwaltung, eine Ernennung eine andere Inhaberin oder ein anderer Inhaber.",
      ),
    );
  });

  /* A request outlives no revoke, demotion or ban of who made it: nobody approves it, and its refusal clears the address. */
  it("closes the approval of a request whose requester has lost the tier since, and leaves its refusal open", async () => {
    antraege = [antrag({ steht: false })];

    const markup = await renderPage(PAGE);

    assert.deepEqual(geschlossen(markup), ["Antrag genehmigen: neu@schule.de"]);
    assert.ok(textOf(markup, " ").includes("Wer den Antrag gestellt hat, hat diesen Zugang inzwischen nicht mehr"));
  });

  /* A barred address is answered on no route, so the row names the state and each control its moment. */
  it("names a barred address and a barred requester by their state, and each control by the request's moment", async () => {
    antraege = [antrag({ adresse: null, gesperrt: true, gestartet_von: null, gestartet_von_gesperrt: true })];

    const markup = await renderPage(PAGE);

    assert.deepEqual(antragNamen(markup), [
      "Antrag genehmigen: Antrag vom 20. Oktober 2026 um 13:30",
      "Antrag ablehnen: Antrag vom 20. Oktober 2026 um 13:30",
    ]);
    assert.ok(!markup.includes("neu@schule.de"));
  });
});
