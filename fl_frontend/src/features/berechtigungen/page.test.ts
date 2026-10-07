import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, renderPage } from "@/shared/testing/pageHarness.ts";
import { refusalWrappers, renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { ReactElement } from "react";

const { setSession } = doubleActionRequest();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminAdministratorenPage } = await import("@/app/bereich/admin/administratoren/page.tsx");
const { AdminCrudShell } = await import("@/shared/components/ui/AdminCrudShell.tsx");

const INHABER = {
  id: "6890a1b2c3d4e5f6071b0001",
  adresse: "inhaber@schule.de",
  gesperrt: false,
  verwaltung: "owner",
  erteilt_von: "PLAYGROUND",
  erteilt_von_gesperrt: false,
  erteilt_am: "2026-09-27T01:00:00Z",
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
};
const GESPERRT = {
  id: "6890a1b2c3d4e5f6071b0003",
  adresse: null,
  gesperrt: true,
  verwaltung: "administration",
  erteilt_von: null,
  erteilt_von_gesperrt: true,
  erteilt_am: "2026-09-27T03:00:00Z",
};

const ZWEITER_INHABER = { ...VORSTAND, id: "6890a1b2c3d4e5f6071b0004", adresse: "kasse@schule.de", verwaltung: "owner" };

/** The tier the lookup answers the signed-in administrator, until a case names another. */
let eigeneVerwaltung: "owner" | "administration" = "administration";

/** When an `owner` tier took effect: before the session each case signs in, until a case names a later one. */
const VOR_JEDER_SITZUNG = "2026-01-01T00:00:00Z";
let inhaberSeit = VOR_JEDER_SITZUNG;

/** The grants the list answers, until a case names others. */
let zeilen: object[] = [INHABER, VORSTAND, GESPERRT];

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/berechtigungen") return answer(schema, endpoint, { berechtigungen: zeilen, uebersprungen: 0 });
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

  /* The box takes an address, and a `?q=` is a request line the edge logs. */
  it("asks the shell to hold the typed query instead of writing it", () => {
    const shell = AdminAdministratorenPage() as ReactElement<{ privateQuery?: boolean }>;

    assert.equal(shell.type, AdminCrudShell);
    assert.equal(shell.props.privateQuery, true);
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
    assert.ok(textOf(markup, " ").includes("Den Zugang entziehen kann nur der Inhaber."), "the closed revoke says not why");
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
    assert.ok(!textOf(markup, " ").includes("Den Zugang entziehen kann nur der Inhaber."), "the owner's revoke is closed");
  });
});

describe("who is offered the tier change", () => {
  const stufenNamen = (html: string): string[] =>
    buttonNames(html).filter((name) => /^(Mich zur Verwaltung herabstufen|Zum Inhaber ernennen|Zur Verwaltung herabstufen)\b/.test(name));

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
      "Zum Inhaber ernennen: vorstand@schule.de",
      "Zum Inhaber ernennen: Zugang vom 27.09.2026",
    ]);
    // A barred address is made an owner by no request: its promotion stands closed, saying why.
    const gesperrt = [...markup.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g)]
      .map(([tag]) => tag)
      .find((tag) => tag.includes('aria-label="Zum Inhaber ernennen: Zugang vom 27.09.2026"'));
    assert.ok(gesperrt !== undefined && /\bdisabled\b/.test(gesperrt), "a promotion the backend refuses is open to press");
    assert.ok(textOf(markup, " ").includes("Diese Adresse ist gesperrt."), "the closed promotion says not why");
    assert.deepEqual(
      refusalWrappers(markup).map(({ name }) => name),
      ["Zum Inhaber ernennen: Zugang vom 27.09.2026"],
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
      "Zum Inhaber ernennen",
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
    assert.ok(textOf(markup, " ").includes("Den Zugang entziehen kann nur der Inhaber."), "the closed revoke says not why");
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
