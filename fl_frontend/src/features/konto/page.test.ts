import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pageBody } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { SubjectSession } from "@/core/subject.ts";
import type { Sicherheit } from "./types.ts";

const { setSubject } = doubleActionRequest();
// The shells hand a sign-out action to the bar, and the section's actions are called nowhere here.
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: KontoPage } = await import("@/app/bereich/(persoenlich)/konto/page.tsx");
const { KontoPanel } = await import("@/shared/components/ui/KontoPanel.tsx");
const { SicherheitSection } = await import("./components/views/SicherheitSection.tsx");
const { SicherheitPanel } = await import("./components/views/SicherheitPanel.tsx");
const { AdminShell } = await import("@/features/admin/components/ui/AdminShell.tsx");
const { PersonShell } = await import("@/features/funktionen/components/ui/PersonShell.tsx");
const { TeamShell } = await import("@/features/funktionen/components/ui/TeamShell.tsx");
const { DashboardShell } = await import("@/features/dashboard/components/ui/DashboardShell.tsx");
const { KONTO_HREF } = await import("@/core/kontoHref.ts");

const NO_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** A person holding nothing the league records: the account page is theirs all the same. */
const OHNE_FUNKTION: SubjectSession = {
  email: "pia@example.org",
  admin: false,
  subjekt: { sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: true, gesperrt: false },
};

/** The page's one heading, which is the bar's: a view under it carries none. */
function heading(html: string): string {
  const found = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)];
  assert.equal(found.length, 1, `the page renders ${String(found.length)} h1 elements`);
  return textOf(found[0]?.[1] ?? "", " ").trim();
}

const kontoLinks = (html: string): string[] => [...html.matchAll(/<a [^>]*href="\/bereich\/konto"[^>]*>/g)].map(([tag]) => tag);

describe("the account page", () => {
  /* One page per person, reached whatever they hold: a person whose every record is unconfirmed still
     has a sign-in, and so passkeys and devices to manage. */
  it("hands the panel the person's address and the security section, a Funktion held or none", async () => {
    setSubject(OHNE_FUNKTION);

    const body = await pageBody(KontoPage, NO_PROPS);

    assert.equal(body.type, KontoPanel);
    const props = body.props as { email: string; sicherheit: { type: unknown } };
    assert.equal(props.email, "pia@example.org");
    assert.equal(props.sicherheit.type, SicherheitSection);
  });

  it("draws the address under a panel heading and carries no second h1", () => {
    const html = renderTree(h(KontoPanel, { email: "pia@example.org", sicherheit: null }));

    assert.equal([...html.matchAll(/<h1/g)].length, 0, "the panel carries an h1 beside the bar's");
    assert.ok(textOf(html, " ").includes("Zugang"));
    assert.ok(textOf(html, " ").includes("pia@example.org"));
  });
});

/** Every shell a session stands behind, as its layout mounts it at `pathname`. */
const SHELLS = {
  admin: (pathname: string) =>
    underNext(h(AdminShell, { saisonMetadataDisplay: null, funktionSwitcher: null, children: h("p", null, "Seite") }), { pathname }),
  person: (pathname: string) => underNext(h(PersonShell, { structure: [], orte: [], children: h("p", null, "Seite") }), { pathname }),
  team: (pathname: string) =>
    underNext(
      h(TeamShell, {
        teamId: "6890a1b2c3d4e5f607250011",
        saisonId: "2526",
        structure: [],
        saison: null,
        orte: [],
        children: h("p", null, "Seite"),
      }),
      {
        pathname,
      },
    ),
};

describe("how every shell reaches the account page (`docs/frontend/spec.md :: I414`)", () => {
  for (const [name, shell] of Object.entries(SHELLS)) {
    /* One address, declared once per shell: the bar's link and the drawer's item both lead there. */
    it(`links the one account page from the ${name} shell`, () => {
      assert.ok(kontoLinks(renderTree(shell("/bereich/landing-irgendwo"))).length >= 1, `the ${name} shell offers no way to the account page`);
    });
  }

  /* The page is headed as itself, never as the shell's own name or as an entry whose address it
     sits under. */
  it("heads the account page „Konto“ and marks the bar's link as the current page", () => {
    const html = renderTree(SHELLS.person(KONTO_HREF));

    assert.equal(heading(html), "Konto");
    assert.ok(
      kontoLinks(html).some((tag) => tag.includes('aria-current="page"')),
      "the bar's link does not say it is the page the reader is on",
    );
  });

  /* The public shell has no session behind it, so it offers no account page at all. */
  it("offers no account page from the public dashboard", () => {
    const html = renderTree(
      underNext(h(DashboardShell, { saisonMetadataDisplay: null, children: h("p", null, "Seite") }), { pathname: "/dashboard" }),
    );

    assert.deepEqual(kontoLinks(html), []);
  });
});

/** The section's read with nothing held and one sign-in: this device's, by code. */
const sicherheit = (fields: Partial<Sicherheit> = {}): Sicherheit => ({
  passkeys: [],
  kannHinzufuegen: true,
  anmeldungen: [
    {
      id: "diese",
      diesesGeraet: true,
      angemeldetAm: "2026-09-26T08:00:00.000Z",
      zuletztAktivAm: "2026-09-26T09:00:00.000Z",
      endetSpaetestensAm: "2026-10-26T08:00:00.000Z",
      faktor: { art: "code" },
    },
  ],
  verwaltung: false,
  bestaetigtBis: null,
  ...fields,
});

const karte = (id: string) => ({
  id: id,
  name: null,
  anbieter: null,
  eingerichtetAm: "2026-09-01T08:00:00.000Z",
  zuletztVerwendetAm: null,
  diesesGeraet: false,
});

const shown = (fields: Partial<Sicherheit>): string =>
  textOf(renderTree(underNext(h(SicherheitPanel, { sicherheit: sicherheit(fields) }))), " ");

describe("what the security section tells its reader", () => {
  it("offers a person holding no passkey the sign-in without a code", () => {
    const text = shown({});

    assert.ok(text.includes("Melde Dich ohne Code an"));
    assert.ok(text.includes("Passkey einrichten"));
  });

  /* An administrator's last passkey is their way into the administration: the second is what keeps
     them in when one is lost. */
  it("asks an administrator holding one passkey for a second, and closes the removal of that one", () => {
    const html = renderTree(underNext(h(SicherheitPanel, { sicherheit: sicherheit({ verwaltung: true, passkeys: [karte("eins")] }) })));

    assert.ok(textOf(html, " ").includes("Richte einen zweiten Passkey ein"));
    assert.ok(!textOf(html, " ").includes("Melde Dich ohne Code an"));
    assert.ok(textOf(html, " ").includes("Der letzte Passkey lässt sich nicht löschen."), "the last passkey's removal stands open");
  });

  it("draws each passkey's fallback name and set-up date, and no last use for one never stamped", () => {
    const text = shown({ passkeys: [karte("eins")] });

    assert.ok(text.includes("Passkey"));
    assert.ok(text.includes("Eingerichtet am 1. September 2026"));
    assert.ok(!text.includes("Zuletzt verwendet"), "a passkey whose uses were never stamped claims a last use");
  });

  it("marks this device's sign-in, names its factor, and offers no sign-out of it beside the bar's", () => {
    const text = shown({});

    assert.ok(text.includes("Dieses Gerät"));
    assert.ok(text.includes("Mit Code per E-Mail"));
    assert.ok(!text.includes("Alle anderen abmelden"), "a sign-out of other devices is offered where there are none");
  });
});
