import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { TURNSTILE_HEADER } from "@/core/turnstileToken.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import {
  laufendeBewerbungFassung,
  laufendeKontaktFassung,
  laufendeSchiedsrichterFassung,
  laufendeSpielerFassung,
} from "@/shared/testing/einwilligungAnswers.ts";
import { TEST_SITE_KEY } from "@/shared/testing/siteverifyDouble.ts";
import { doubleTurnstile } from "@/shared/testing/turnstileDouble.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { EDGE_REFUSAL_BODY } from "@/shared/utils/actionError.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import { EDGE_RATE_LIMIT_STATUS, postPublicForm, UNKLAR_TITEL } from "./publicSubmit.ts";

import type { ReactNode } from "react";

/* The real module hands its raising to HeroUI's queue rather than back to the form that raised. */
const { raised } = doubleToasts();
/* Cloudflare's script, which jsdom never loads: without it the two forms holding the bot check wait for a token and post nothing. */
doubleTurnstile();

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { BewerbungForm } = await import("@/features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx");
const { BestaetigungFormPanel } = await import("@/features/bewerbungen/components/views/BestaetigungFormPanel.tsx");
const { BestaetigungSaisonVorbei } = await import("@/features/bewerbungen/components/views/BestaetigungSaisonVorbei.tsx");
const { SchiedsrichterBestaetigungView } = await import("@/features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx");
const { JA_MEINE_ADRESSE, SchiedsrichterAdresswechselView } =
  await import("@/features/schiedsrichter/components/views/SchiedsrichterAdresswechselView.tsx");
const { CodeStep } = await import("@/features/auth/components/forms/CodeStep.tsx");
const { RegistrierungFormPanel } = await import("@/features/registrierungen/components/views/RegistrierungFormPanel.tsx");
const { SpielerBestaetigungView } = await import("@/features/registrierungen/components/views/SpielerBestaetigungView.tsx");
const { BEWERBUNG_SEATS } = await import("@/features/bewerbungen/constants.ts");
const { TRIKOT_FARBE_OPTIONS } = await import("@/features/teams/constants.ts");

/** Each public page's running words, off the registry the backend generated, as its page hands them in. */
const SCHIEDSRICHTER = laufendeSchiedsrichterFassung();
const SPIELER = laufendeSpielerFassung();

// The three sentences a visitor can be shown, spelled here rather than imported: what this file
// holds is the wording, and a test reading the module's own constant would agree with any rewording.
const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann erneut.";
const KEINE_ANTWORT_VON_UNS = "Die Website ist gerade nicht erreichbar. Warte einen Moment und versuche es dann erneut.";
const KEINE_VERBINDUNG = "Prüfe die Verbindung und versuche es erneut.";

const ENVELOPE = { "content-type": "application/json" };

const ECHTES_FETCH = globalThis.fetch;

/** What the transport is made to do; every case here is something a real one produces. */
function transportiert(answer: (url: string, init: RequestInit) => Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => answer(String(input), init ?? {})) as typeof fetch;
}

const antwortet = (body: string, init: ResponseInit): void => {
  transportiert(() => Promise.resolve(new Response(body, init)));
};

afterEach(() => {
  globalThis.fetch = ECHTES_FETCH;
});

describe("what a public form is told when the answer was not this application's", () => {
  /* nginx generates the limit before any route handler runs, so the body is its own sentence and the
     status is the whole of what arrived. The wait is a repair, which is why it is said out loud. */
  it("names the wait on the edge's rate limit", async () => {
    antwortet(EDGE_REFUSAL_BODY, { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/plain" } });

    const answered = await postPublicForm("/api/bewerbung", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: true, error: ZU_VIELE_VERSUCHE });
  });

  /* A challenge reaching a POST at all is the edge misconfigured (`docs/ops/spec.md :: I177`), so
     both bodies: the shape a refusal from in front of us takes is nothing this side chose. */
  it("names no cause on a challenged POST, whatever the challenge answered with", async () => {
    for (const body of ["<html>challenge</html>", JSON.stringify({ success: false, error: "Forbidden" })]) {
      antwortet(body, { status: 403, headers: { "cf-mitigated": "challenge" } });

      const answered = await postPublicForm("/api/bewerbung", {});

      assert.deepEqual(
        answered,
        { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS },
        `the challenge answering ${body} reached the form`,
      );
    }
  });

  /* The same interstitial can arrive under a 200, where the status alone would pass it through as
     an answer of this application's. */
  it("refuses a body that is no JSON at all", async () => {
    antwortet("<html>interstitial</html>", { status: 200, headers: { "content-type": "text/html" } });

    const answered = await postPublicForm("/api/bestaetigung/kontakt", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS });
  });

  /* JSON parses from anything that wrote JSON, this application included in nothing about it. Every
     route's answer opens on `success`, so its absence is what separates the two. */
  it("refuses parsed JSON that is not the envelope", async () => {
    antwortet(JSON.stringify({ result: "ok" }), { status: 200, headers: ENVELOPE });

    const answered = await postPublicForm("/api/bewerbung", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS });
  });

  /* A rejection reached no judgement, so the connection is the one thing worth naming and nothing
     the visitor typed may be. */
  it("blames the connection where the request left no judgement", async () => {
    transportiert(() => Promise.reject(new TypeError("Failed to fetch")));

    const answered = await postPublicForm("/api/bestaetigung/kontakt", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: false, error: KEINE_VERBINDUNG });
  });

  /* nginx refuses the REQUEST, so the write is ruled out and the form may say so; a challenge and a
     dead transport each leave a POST that may already have been written. */
  it("rules the write out on the edge's limit and on neither other refusal", async () => {
    for (const [name, arrange, wroteNothing] of [
      [
        "the rate limit",
        () => antwortet(EDGE_REFUSAL_BODY, { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/plain" } }),
        true,
      ],
      ["the challenge", () => antwortet("<html>challenge</html>", { status: 403, headers: { "cf-mitigated": "challenge" } }), false],
      ["the dead transport", () => transportiert(() => Promise.reject(new TypeError("Failed to fetch"))), false],
    ] as const) {
      arrange();

      const answered = await postPublicForm("/api/bewerbung", {});

      assert.ok(!answered.answered, `${name}: the answer was taken for this application's`);
      assert.equal(answered.wroteNothing, wroteNothing, `${name}: what a form may tell a visitor about the write is wrong`);
    }
  });

  /* The refused arm carries a sentence and no map: a form laying field errors over its controls from
     an answer nothing in this application wrote would paint a refusal nobody made. */
  it("carries no field errors on any of them", async () => {
    for (const [name, init] of [
      ["the rate limit", { status: EDGE_RATE_LIMIT_STATUS, headers: ENVELOPE }],
      ["the challenge", { status: 403, headers: { ...ENVELOPE, "cf-mitigated": "challenge" } }],
    ] as const) {
      antwortet(JSON.stringify({ success: false, fieldErrors: { "schule.shorthand": "Kein Kürzel" } }), init);

      const answered = await postPublicForm("/api/bewerbung", {});

      assert.equal(answered.answered, false, `${name}: the answer was taken for this application's`);
      assert.ok(!Object.hasOwn(answered, "fieldErrors"), `${name}: a field error survived an answer this application never gave`);
    }
  });
});

describe("what a public form is told when the application did answer", () => {
  it("hands the envelope over whole, its refusal and its field errors with it", async () => {
    const envelope = { success: false, error: "Die Bewerbung wurde nicht gespeichert.", fieldErrors: { "schule.shorthand": "Schon vergeben" } };
    antwortet(JSON.stringify(envelope), { status: 200, headers: ENVELOPE });

    const answered = await postPublicForm("/api/bewerbung", {});

    assert.deepEqual(answered, { answered: true, body: envelope });
  });

  it("sends the payload as JSON on a POST", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    transportiert((url, init) => {
      sent.push({ url: url, init: init });
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: ENVELOPE }));
    });

    await postPublicForm("/api/bestaetigung/kontakt", { token: "abc" });

    assert.deepEqual(
      sent.map(({ url }) => url),
      ["/api/bestaetigung/kontakt"],
    );
    assert.equal(sent[0]?.init.method, "POST");
    assert.deepEqual(new Headers(sent[0]?.init.headers).get("content-type"), "application/json");
    assert.equal(sent[0]?.init.body, JSON.stringify({ token: "abc" }));
  });

  /* Beside the body and never in it: the body is the backend's payload, whose schema holds no token. */
  it("carries a bot check's token in its own header, and sends none where the form gave none", async () => {
    const sent: RequestInit[] = [];
    transportiert((_url, init) => {
      sent.push(init);
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: ENVELOPE }));
    });

    await postPublicForm("/api/bewerbung", { schule: "x" }, { turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" });
    await postPublicForm("/api/bewerbung", { schule: "x" });

    assert.deepEqual(
      sent.map((init) => new Headers(init.headers).get(TURNSTILE_HEADER)),
      ["XXXX.DUMMY.TOKEN.XXXX", null],
    );
    assert.equal(sent[0]?.body, JSON.stringify({ schule: "x" }));
  });
});

/** A date as a picker's segments take it typed, day then month then year: `years` whole years before the German today. */
const typedBirthdate = (years: number): string => {
  const [jahr, monat, tag] = parseDate(getGermanTodayStr()).subtract({ years }).toString().split("-");

  return `${tag ?? ""}${monat ?? ""}${jahr ?? ""}`;
};

type User = ReturnType<typeof userEvent.setup>;

const control = (name: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[name="${name}"]`) ?? assert.fail(`the form renders no control named ${name}`);

async function typeInto(user: User, box: HTMLElement, value: string): Promise<void> {
  await user.clear(box);
  await user.paste(value);
}

type PublicForm = {
  /** The module calling `postPublicForm`, below `src/`, which the caller reader below matches against. */
  module: string;
  /** The route the form's write is addressed to. */
  route: string;
  render: () => ReactNode;
  /** Everything the form asks for, answered as a visitor answers it, and the press that sends it. */
  submit: (user: User) => Promise<void>;
};

const SCHOOL_ID = "68d0f2a4c1e2b3a4d5e6f708";

/** Every public form a visitor can submit, each named as this file reports it. */
const FORMS: Record<string, PublicForm> = {
  "the application form": {
    module: "features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx",
    route: "/api/bewerbung",
    render: () =>
      h(BewerbungForm, {
        saisonId: "2026",
        fassung: laufendeBewerbungFassung(),
        schulen: [{ id: SCHOOL_ID, name: "Lessing-Kolleg" }],
        isSchulenLesbar: true,
        vergebeneFarben: [],
        siteKey: TEST_SITE_KEY,
      }),
    submit: async (user) => {
      await user.selectOptions(control("team_id"), SCHOOL_ID);
      await typeInto(user, screen.getByRole("textbox", { name: "Größe der Stufe" }), "90");
      for (const [index, { value }] of BEWERBUNG_SEATS.entries()) {
        const person = {
          vorname: ["Anna", "Bernd", "Clara"][index] ?? "Dora",
          nachname: "Muster",
          email: `person${String(index)}@schule.example`,
          telefon: `069 ${String(index + 1).repeat(7)}`,
        };
        for (const field of ["vorname", "nachname", "email", "telefon"] as const) {
          await typeInto(user, control(`kontakte.${value}.${field}`), person[field]);
        }
      }
      await user.click(screen.getByRole("switch").closest("label") ?? assert.fail("the switch renders no label to press"));
      await user.selectOptions(control("trikot.wunschfarbe"), TRIKOT_FARBE_OPTIONS[0]!.value);
      await typeInto(user, screen.getByRole("textbox", { name: "Voraussichtliche Kadergröße" }), "14");
      await typeInto(user, screen.getByRole("textbox", { name: "Davon im Verein aktiv (mind. Verbandsliga)" }), "3");
      await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));
    },
  },
  // The objection, which the panel sends with no field filled in.
  "the confirmation panel": {
    module: "features/bewerbungen/components/views/BestaetigungFormPanel.tsx",
    route: "/api/bestaetigung/kontakt",
    render: () =>
      h(BestaetigungFormPanel, {
        fassung: laufendeKontaktFassung(),
        token: "kein-echtes-token",
        vorname: "Mira",
        schule: "Lessing-Kolleg",
        saison: "2026",
        rolle: "Ansprechperson",
        mindestalter: 18,
        medienMindestalter: 18,
        onAbschluss: () => undefined,
      }),
    submit: (user) => pressTwice(user, { resting: "Ich möchte nicht eingetragen sein", armed: /Widerspruch/ }),
  },
  // A link whose season ended, which takes the Widerspruch alone.
  "the season-over confirmation page": {
    module: "features/bewerbungen/components/views/BestaetigungSaisonVorbei.tsx",
    route: "/api/bestaetigung/kontakt",
    render: () =>
      h(BestaetigungSaisonVorbei, {
        ansicht: {
          acknowledged: 1,
          zustand: "saison_vorbei",
          quelle: "saison",
          zeile: "saison_vorbei",
          saison_id: "2026",
          schule: "Lessing-Kolleg",
          rolle: "ansprechperson",
          zugleich_rolle: null,
          vorname: "Mira",
          text_version: laufendeKontaktFassung().textVersion,
          laufende_fassung: laufendeKontaktFassung().textVersion,
          mindestalter: 18,
          medien_mindestalter: 18,
        },
        token: "kein-echtes-token",
        onAbschluss: () => undefined,
      }),
    submit: (user) => pressTwice(user, { resting: "Ich möchte nicht eingetragen sein", armed: /Widerspruch/ }),
  },
  "the referee's confirmation page": {
    module: "features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx",
    route: "/api/bestaetigung/schiedsrichter",
    render: () =>
      h(SchiedsrichterBestaetigungView, {
        start: {
          zustand: "gueltig",
          token: "kein-echtes-token",
          ansicht: {
            acknowledged: 1,
            zustand: "gueltig",
            vorname: "Anna",
            text_version: SCHIEDSRICHTER.textVersion,
            mindestalter: 16,
            medien_mindestalter: 18,
            frist: "2026-10-05",
          },
          fassung: SCHIEDSRICHTER,
        },
      }),
    submit: async (user) => {
      await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
      await user.keyboard(typedBirthdate(40));
      await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER.bedienelemente.intern }));
      await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));
    },
  },
  "the referee's address page": {
    module: "features/schiedsrichter/components/views/SchiedsrichterAdresswechselView.tsx",
    route: "/api/bestaetigung/schiedsrichter/adresse",
    render: () =>
      h(SchiedsrichterAdresswechselView, { start: { zustand: "gueltig", vorname: "Anna", frist: "2026-10-05", token: "kein-echtes-token" } }),
    submit: (user) => user.click(screen.getByRole("button", { name: JA_MEINE_ADRESSE })),
  },
  // The sixth digit sends the check by itself.
  "the sign-in code step": {
    module: "features/auth/components/forms/CodeStep.tsx",
    route: "/api/signin/code",
    render: () =>
      h(CodeStep, {
        address: "vorstand@example.org",
        message: "Falls zu dieser Adresse ein Konto gehört, ist ein Anmeldecode unterwegs.",
        hint: "Ein Hinweis dieser Seite.",
        submitLabel: { rest: "Weiter", pending: "Läuft..." },
        isSending: false,
        onResend: () => undefined,
        onSignedIn: () => undefined,
      }),
    submit: (user) => user.type(screen.getByLabelText("Code aus der E-Mail"), "048213"),
  },
  "the registration form": {
    module: "features/registrierungen/components/views/RegistrierungFormPanel.tsx",
    route: "/api/registrierung",
    render: () =>
      h(RegistrierungFormPanel, {
        token: "kein-echtes-token",
        ansicht: {
          acknowledged: 1,
          team: "Lessing-Kolleg",
          schule: "Lessing-Kolleg Oberstufengymnasium",
          saison_id: "2026",
          saison_status: "future",
          laeuft: true,
          erlaubte_stufen: ["Q1", "Q2"],
          kader_frei: true,
          team_eingetragen: true,
          nachnominierung: false,
        },
        siteKey: TEST_SITE_KEY,
        onLinkTot: () => undefined,
      }),
    submit: async (user) => {
      await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
      await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
      await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), "mira.kern@beispiel.example");
      await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    },
  },
  "the pupil's confirmation page": {
    module: "features/registrierungen/components/views/SpielerBestaetigungView.tsx",
    route: "/api/bestaetigung/spieler",
    render: () =>
      h(SpielerBestaetigungView, {
        start: {
          zustand: "gueltig",
          token: "kein-echtes-token",
          ansicht: {
            acknowledged: 1,
            zustand: "gueltig",
            team: "Lessing-Kolleg",
            schule: "Lessing-Kolleg Oberstufengymnasium",
            saison_id: "2026",
            vorname: "Mira",
            seite: SPIELER.seite,
            mindestalter: 16,
            medien_mindestalter: 18,
            geburtsdatum: null,
            umfang: null,
            medien: null,
          },
        },
        fassung: SPIELER,
      }),
    submit: async (user) => {
      await user.click(screen.getByRole("radio", { name: SPIELER.bedienelemente.intern }));
      const [tag] = screen.getAllByRole("spinbutton");
      await user.click(tag ?? assert.fail("the page renders no date to type"));
      await user.keyboard(typedBirthdate(17));
      await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));
    },
  },
};

const SRC = path.resolve(import.meta.dirname, "..", "..");
const PUBLIC_SUBMIT = path.join(SRC, "shared", "utils", "publicSubmit");

/** Whether `file` imports `postPublicForm`, or the module whole, read off its syntax tree. */
function importsPostPublicForm(file: string): boolean {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    const specifier = statement.moduleSpecifier.text;
    const resolved = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
    if (resolved.replace(/\.ts$/, "") !== PUBLIC_SUBMIT) return false;

    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) return true;
    return bindings?.elements.some((element) => (element.propertyName ?? element.name).text === "postPublicForm") ?? false;
  });
}

/** Every production module calling `postPublicForm`, below `src/`, read off the tree. */
const CALLERS = filesUnder(SRC, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 200)
  .filter((file) => importsPostPublicForm(file))
  .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
  .sort();

describe("where each public form's write is transported", () => {
  /* The sweep below drives what `FORMS` names, so a caller left out of it answers the edge's refusal
     however it likes with nothing failing. */
  it("drives every module that calls the shared helper", () => {
    assert.deepEqual(
      CALLERS,
      Object.values(FORMS)
        .map(({ module }) => module)
        .sort(),
    );
  });

  /* Only `postPublicForm` reads the edge's rate limit, answered in nginx's own sentence, as a refusal
     that ruled the write out: a form writing on its own tells the visitor something else. */
  for (const [name, form] of Object.entries(FORMS)) {
    it(`${name} posts once to its own route, and passes on the shared helper's reading of the edge's refusal`, async () => {
      const { posted, shown } = await unanswered(form, () =>
        Promise.resolve(new Response(EDGE_REFUSAL_BODY, { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/plain" } })),
      );

      assert.deepEqual(posted, [form.route], `${name} posted somewhere other than once to its own route`);
      assert.deepEqual(
        shown.map(({ description }) => description),
        [ZU_VIELE_VERSUCHE],
        `${name} told the visitor something other than the shared helper's sentence for the edge's rate limit`,
      );
      // The refusal ruled the write out, so its title is the form's own failure, never the unclear one.
      assert.notEqual(shown[0]?.title, UNKLAR_TITEL, `${name} titles a write the edge refused as one of unknown outcome`);
    });

    /* A lost answer may have written, so its title is the one every public form gives an unknown
       outcome: a form titling both arms alike tells one of them something false. */
    it(`${name} titles an answer lost in transport as of unknown outcome`, async () => {
      const { shown } = await unanswered(form, () => Promise.reject(new TypeError("Failed to fetch")));

      // The title alone: a form whose resend cannot land twice says so in its own sentence.
      assert.deepEqual(
        shown.map(({ title }) => title),
        [UNKLAR_TITEL],
        `${name} titles a press nobody can tell landed as something other than of unknown outcome`,
      );
    });
  }
});

/** One submit of `form` whose POST `post` answers, every other request answered as a success. */
async function unanswered(
  form: PublicForm,
  post: () => Promise<Response>,
): Promise<{ posted: string[]; shown: { title: unknown; description: unknown }[] }> {
  const posted: string[] = [];
  transportiert((url, init) => {
    if (init.method !== "POST") return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: ENVELOPE }));

    posted.push(url);
    return post();
  });
  raised.length = 0;

  render(form.render());
  await form.submit(userEvent.setup());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  return { posted, shown: raised.filter((toast) => toast.variant === "danger").map(({ title, description }) => ({ title, description })) };
}
