import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { person } from "@/core/subjectFixtures.ts";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { callPage, pageBody, redirectTarget } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { SubjectSession } from "@/core/subject.ts";
import type { Anmeldung, Sicherheit } from "./types.ts";

const { setSubject } = doubleActionRequest();
// The shells hand a sign-out action to the bar, and the section's actions are called nowhere here.
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: KontoPage } = await import("@/app/bereich/(persoenlich)/konto/page.tsx");
const { KontoPanel } = await import("@/shared/components/ui/KontoPanel.tsx");
const { SicherheitSection } = await import("./components/views/SicherheitSection.tsx");
const { EinwilligungSection } = await import("./components/views/EinwilligungSection.tsx");
const { SicherheitPanel } = await import("./components/views/SicherheitPanel.tsx");
const { AdminShell } = await import("@/features/admin/components/ui/AdminShell.tsx");
const { PersonShell } = await import("@/features/funktionen/components/ui/PersonShell.tsx");
const { TeamShell } = await import("@/features/funktionen/components/ui/TeamShell.tsx");
const { DashboardShell } = await import("@/features/dashboard/components/ui/DashboardShell.tsx");
const { KONTO_HREF } = await import("@/core/kontoHref.ts");

const NO_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** A person holding nothing the league records: the account page is theirs all the same. */
const OHNE_FUNKTION = person({ unbestaetigt: true });

/** The same person holding a grant: the administrator's lane decides what the page shows them. */
const MIT_ZUGANG: SubjectSession = {
  ...OHNE_FUNKTION,
  subjekt: { ...OHNE_FUNKTION.subjekt, verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z" },
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
  it("hands the panel the person's address, the security section and the consent section, a Funktion held or none", async () => {
    setSubject(OHNE_FUNKTION);

    const body = await pageBody(KontoPage, NO_PROPS);

    assert.equal(body.type, KontoPanel);
    const props = body.props as { email: string; sicherheit: { type: unknown }; einwilligung: { type: unknown } };
    assert.equal(props.email, "pia@example.org");
    assert.equal(props.sicherheit.type, SicherheitSection);
    assert.equal(props.einwilligung.type, EinwilligungSection);
  });

  /* The section is the administrator's lane's to fill, so a lapsed administrator verdict is sent on to
     that lane's step, as the landing sends it, rather than shown an empty section. */
  it("sends an address holding a grant whose administrator verdict lapsed to the admin subtree", async () => {
    setSubject(MIT_ZUGANG);
    const { thrown } = await callPage(KontoPage, NO_PROPS);
    assert.deepEqual(
      thrown.flatMap((error) => redirectTarget(error) ?? []),
      ["/bereich/admin"],
    );

    // The control: the administrator's own verdict standing, the page renders.
    setSubject({ ...MIT_ZUGANG, admin: true });
    assert.equal((await pageBody(KontoPage, NO_PROPS)).type, KontoPanel);
  });

  it("draws the address under a panel heading and carries no second h1", () => {
    const html = renderTree(h(KontoPanel, { email: "pia@example.org", sicherheit: null, einwilligung: null }));

    assert.equal([...html.matchAll(/<h1/g)].length, 0, "the panel carries an h1 beside the bar's");
    // Headed „Anmeldung“: „Zugang“ names the administration grant alone.
    assert.match(html, /<h2[^>]*>Anmeldung<\/h2>/);
    assert.ok(!textOf(html, " ").includes("Zugang"), "the sign-in address is headed by the grant's word");
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
        isRefused: false,
        orte: [],
        children: h("p", null, "Seite"),
      }),
      {
        pathname,
      },
    ),
};

describe("how every shell reaches the account page (`docs/frontend/spec.md :: I423`)", () => {
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
  inhaberId: "inhaber",
  inhaberAdresse: "pia@example.org",
  freshUntil: null,
  enrolmentUntil: null,
  servedAt: Date.now(),
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

const HOUR_MS = 60 * 60 * 1000;

/** A button whose own label is „Abmelden“, which „Alle anderen abmelden“ is not. */
const ABMELDEN_BUTTON = /<button[^>]*>(?:(?!<\/button>)[\s\S])*>Abmelden<\/button>/;

const shown = (fields: Partial<Sicherheit>): string =>
  textOf(renderTree(underNext(h(SicherheitPanel, { sicherheit: sicherheit(fields) }))), " ");

describe("what the security section tells its reader", () => {
  it("offers a person holding no passkey the sign-in without a code", () => {
    const text = shown({ freshUntil: Date.now() + HOUR_MS, enrolmentUntil: Date.now() + HOUR_MS / 20 });

    assert.ok(text.includes("Melde Dich ohne Code an"));
    assert.ok(text.includes("Passkey einrichten"));
  });

  /* The sudo pattern: past the window the add control is the confirmation itself, and it turns into
     the add control once confirmed (the flow's own cases are `SicherheitPanel.test.ts`). */
  it("offers the confirmation in the add control's place once the window has closed", () => {
    const text = shown({ passkeys: [karte("eins")], freshUntil: null });

    assert.ok(text.includes("Mit Passkey bestätigen"));
    assert.ok(!text.includes("Passkey hinzufügen"), "a stale session is offered the enrolment the server refuses it");
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
    const html = renderTree(underNext(h(SicherheitPanel, { sicherheit: sicherheit({ passkeys: [karte("eins")] }) })));

    // The name line alone, which every other „Passkey“ on the page is not.
    assert.match(html, />Passkey<\/span>/);
    assert.ok(textOf(html, " ").includes("Eingerichtet am 1. September 2026"));
    assert.ok(!textOf(html, " ").includes("Zuletzt verwendet"), "a passkey whose uses were never stamped claims a last use");

    // The control: a name the holder chose is the line instead.
    const named = renderTree(
      underNext(h(SicherheitPanel, { sicherheit: sicherheit({ passkeys: [{ ...karte("eins"), name: "Mein iPhone" }] }) })),
    );
    assert.doesNotMatch(named, />Passkey<\/span>/);
  });

  /* A screen reader meets „Abmelden“, „Löschen“ and „Umbenennen“ once per row, so each is named by its
     row, the visible label inside the name (WCAG 2.4.6, 2.5.3), from the facts a row holds. */
  it("names each row's controls by the row they act on", () => {
    const andere: Anmeldung = {
      id: "andere",
      diesesGeraet: false,
      angemeldetAm: "2026-09-25T08:00:00.000Z",
      zuletztAktivAm: "2026-09-25T09:00:00.000Z",
      endetSpaetestensAm: "2026-10-25T08:00:00.000Z",
      faktor: { art: "code" },
    };
    const html = renderTree(
      underNext(
        h(SicherheitPanel, {
          sicherheit: sicherheit({
            anmeldungen: [...sicherheit().anmeldungen, andere],
            passkeys: [karte("unbenannt"), { ...karte("benannt"), name: "Mein iPhone" }],
          }),
        }),
      ),
    );

    for (const name of [
      "Anmeldung per Code vom 25. September 2026, 10:00 abmelden",
      "Passkey vom 1. September 2026 löschen",
      "Passkey vom 1. September 2026 umbenennen",
      "Passkey „Mein iPhone“ löschen",
      "Passkey „Mein iPhone“ umbenennen",
    ]) {
      assert.ok(html.includes(`aria-label="${name}"`), `no control is named „${name}“`);
    }
  });

  /* The activity stamp refreshes hourly, so a minute printed beside it would claim a precision the
     row does not hold; the sign-in's own time is exact and keeps its minute. */
  it("prints the last activity by the day and the sign-in by the minute", () => {
    const text = shown({});

    assert.match(text, /Zuletzt aktiv am 26\. September 2026(?! um)/);
    assert.match(text, /Angemeldet am 26\. September 2026 um \d{2}:\d{2}/);
  });

  it("marks this device's sign-in, names its factor, and offers no sign-out of it beside the bar's", () => {
    const html = renderTree(underNext(h(SicherheitPanel, { sicherheit: sicherheit() })));

    assert.ok(textOf(html, " ").includes("Dieses Gerät"));
    assert.ok(textOf(html, " ").includes("Mit Code per E-Mail"));
    assert.doesNotMatch(html, ABMELDEN_BUTTON, "this device's own row offers a sign-out beside the bar's");
    assert.ok(!textOf(html, " ").includes("Alle anderen abmelden"), "a sign-out of other devices is offered where there are none");

    // The control: another device's row carries one.
    const andere: Anmeldung = {
      id: "andere",
      diesesGeraet: false,
      angemeldetAm: "2026-09-25T08:00:00.000Z",
      zuletztAktivAm: "2026-09-25T09:00:00.000Z",
      endetSpaetestensAm: "2026-10-25T08:00:00.000Z",
      faktor: { art: "code" },
    };
    const both = renderTree(underNext(h(SicherheitPanel, { sicherheit: sicherheit({ anmeldungen: [...sicherheit().anmeldungen, andere] }) })));
    assert.match(both, ABMELDEN_BUTTON);
  });
});

const { answerReadsWith, EMPTIEST_ANSWER, renderPage } = await import("@/shared/testing/pageHarness.ts");
const { einwilligungAnswer, publishedFassung, publishedLaufendeFassung } = await import("@/core/einwilligungDocument.ts");
const { bestaetigteWorte, sitzMindestalter } = await import("./components/forms/EinwilligungForm/kontoWorte.tsx");

const SITZ_TEAM_ID = "6890a1b2c3d4e5f607250011";

/**
 * A Trainer who is also the Stellvertretung, confirmed on the contact page. The read names the Trainer's
 * seat first, so a floor read off that one seat states the Trainer's 16 where the contact page asked 18.
 */
const SITZ = {
  team_id: SITZ_TEAM_ID,
  team_name: "Lessing Lions",
  saison_id: "2526",
  rollen: ["stellvertretung", "trainer"],
  bestaetigt_text_version: "2026-09-bestaetigungsseite-6",
  kontext: { vorname: "Jonas", team: "Lessing Lions", schule: "Lessing-Gymnasium", saison: "2526", rolle: "trainer" },
  medien: false,
  medien_angeboten: true,
  erteilbar: true,
};

const EINWILLIGUNG = {
  umfang: "kader_oeffentlich",
  erteilt_von: "volljaehrig",
  datum: "2026-09-01",
  bestaetigt_am: "2026-09-01",
  text_version: "2026-09-spielerseite-3",
  medien: false,
};

/** A pupil confirmed on the pupil's page, the registration's team, school and season served. */
const SPIELER = {
  spieler_id: "6890a1b2c3d4e5f607390031",
  vorname: "Alina",
  nachname: "Fischer",
  geburtsdatum: "2008-05-02",
  inactive_since: null,
  einwilligung: EINWILLIGUNG,
  bestaetigt_text_version: "2026-09-spielerseite-3",
  kontext: { vorname: "Alina", team: "Lessing Lions", schule: "Lessing-Gymnasium", saison: "2526" },
  erteilbar: true,
  medien_angeboten: true,
  kader: [],
};

const SCHIEDSRICHTER = {
  schiedsrichter_id: "6890a1b2c3d4e5f607390041",
  name: "Mara Okafor",
  schule: null,
  kontakt: { telefon: null, email: "mara@example.org" },
  geburtsdatum: "2007-03-01",
  inactive_since: null,
  einwilligung: { ...EINWILLIGUNG, text_version: "2026-09-schiedsrichterseite-3" },
  bestaetigt_text_version: "2026-09-schiedsrichterseite-3",
  kontext: { vorname: "Mara" },
  erteilbar: true,
  medien_angeboten: true,
};

/** The section's reads answered: the consent words off the backend's generated registry, the person's records as given. */
function answeringKonto(konto: Record<string, unknown>): void {
  answerReadsWith((endpoint, schema, params) => {
    if (endpoint === "/konto/einwilligungen") return { acknowledged: 1, spieler: null, schiedsrichter: [], sitze: [], ...konto };
    return einwilligungAnswer(endpoint) ?? EMPTIEST_ANSWER(endpoint, schema, params);
  });
}

const sectionText = async (): Promise<string> => textOf(await renderPage(underNext(h(EinwilligungSection))), " ").replace(/\s+/g, " ");

/** Every disclosure the section offers, one per record whose confirmed words it shows. */
const disclosures = async (): Promise<number> =>
  [...(await renderPage(underNext(h(EinwilligungSection)))).matchAll(/Was Du bestätigt hast/g)].length;

describe("the account page's consent section", () => {
  it("renders nothing for a person holding no consent record", async () => {
    setSubject(OHNE_FUNKTION);
    answeringKonto({});

    assert.equal(await renderPage(underNext(h(EinwilligungSection))), "");
  });

  /* The control's words are the account page's own running wording; the words beside it are the ones
     the seat's person confirmed, a different label of a different page. */
  it("draws a seat's control in the account page's words and the confirmed words beside it", async () => {
    setSubject(OHNE_FUNKTION);
    answeringKonto({ sitze: [SITZ] });

    const text = await sectionText();
    const konto = publishedLaufendeFassung("konto_kontakt");

    assert.ok(text.includes("Deine Einwilligung"));
    assert.ok(text.includes("Fotos, Videos und Interviews: Lessing Lions, Saison 2526"));
    assert.ok(text.includes(konto.schalter), "the seat's switch is not named by the account page's words");
    assert.equal(await disclosures(), 1);
  });

  /* Every slot of each kind's confirmation page filled from the record: every seat held named as the
     contact page names it, the objection control's own label. A literal slot left standing fails. */
  for (const [art, konto, erwartet] of [
    [
      "a seat holder",
      { sitze: [SITZ] },
      ["Lessing-Gymnasium", "Stellvertretung und Trainerin oder Trainer", "mindestens 18 Jahre", "Ich möchte nicht eingetragen sein"],
    ],
    ["a pupil", { spieler: SPIELER }, ["Lessing Lions", "Lessing-Gymnasium", "Alina"]],
    ["a referee", { schiedsrichter: [SCHIEDSRICHTER] }, ["Mara", "Konto löschen"]],
  ] as const) {
    it(`fills every slot of ${art}'s confirmed words from the record`, async () => {
      setSubject(OHNE_FUNKTION);
      answeringKonto(konto);

      const text = await sectionText();

      assert.equal(await disclosures(), 1, `${art}'s confirmed words are not shown`);
      assert.doesNotMatch(text, /\{\w+\}/, `${art}'s confirmed words spell a slot`);
      for (const wort of erwartet) assert.ok(text.includes(wort), `${art}'s confirmed words lack „${wort}“`);
    });
  }

  /* A slot served empty, a pupil holding no squad row: a sentence with its subject blanked misstates the
     agreement as a literal slot does, so the words stay out and the control stands. */
  it("leaves the confirmed words out where a slot they need is served empty, and keeps the control", async () => {
    setSubject(OHNE_FUNKTION);
    answeringKonto({ spieler: { ...SPIELER, kontext: { vorname: "Alina", team: null, schule: null, saison: null } } });

    assert.equal(await disclosures(), 0);
    assert.ok((await sectionText()).includes(publishedLaufendeFassung("konto_spieler").schalter));
  });

  it("names the highest floor any seat held asks, as the contact page judged the person", () => {
    assert.equal(sitzMindestalter(["trainer"]), 16);
    assert.equal(sitzMindestalter(["trainer", "ansprechperson"]), 18);
  });

  /* A slot nothing maps, a page naming one the section never fills, fails the render loudly. */
  it("fails the render for a slot nothing maps", () => {
    assert.throws(() => bestaetigteWorte(publishedFassung("2026-09-spielerseite-3"), {}), /has no value for/);
  });
});
