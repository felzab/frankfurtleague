import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { SCHIEDSRICHTER_EINWILLIGUNG, SPIELER_EINWILLIGUNG } from "@/core/einwilligung.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import { EDGE_RATE_LIMIT_STATUS, postPublicForm } from "./publicSubmit.ts";

import type { ReactNode } from "react";

/* The real module hands its raising to HeroUI's queue rather than back to the form that raised. */
const { raised } = doubleToasts();

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { BewerbungForm } = await import("@/features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx");
const { BestaetigungFormPanel } = await import("@/features/bewerbungen/components/views/BestaetigungFormPanel.tsx");
const { SchiedsrichterBestaetigungView } = await import("@/features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx");
const { RegistrierungFormPanel } = await import("@/features/registrierungen/components/views/RegistrierungFormPanel.tsx");
const { SpielerBestaetigungView } = await import("@/features/registrierungen/components/views/SpielerBestaetigungView.tsx");
const { BEWERBUNG_SEATS } = await import("@/features/bewerbungen/constants.ts");
const { SCHIEDSRICHTER_UMFANG_OPTIONS } = await import("@/features/schiedsrichter/constants.ts");
const { TRIKOT_FARBE_OPTIONS } = await import("@/features/teams/constants.ts");

// The three sentences a visitor can be shown, spelled here rather than imported: what this file
// holds is the wording, and a test reading the module's own constant would agree with any rewording.
const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann noch einmal.";
const KEINE_ANTWORT_VON_UNS = "Die Antwort auf Deine Anfrage kam nicht von uns. Warte einen Moment und versuche es dann noch einmal.";
const KEINE_VERBINDUNG = "Prüfe Deine Verbindung und versuche es erneut.";

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
  /* nginx generates the limit before any route handler runs, so the body is its own HTML and the
     status is the whole of what arrived. The wait is a repair, which is why it is said out loud. */
  it("names the wait on the edge's rate limit", async () => {
    antwortet("<html>429</html>", { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/html" } });

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
        () => antwortet("<html>429</html>", { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/html" } }),
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
    route: "/api/bewerbung",
    render: () =>
      h(BewerbungForm, { saisonId: "2026", schulen: [{ id: SCHOOL_ID, name: "Lessing-Kolleg" }], isSchulenLesbar: true, vergebeneFarben: [] }),
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
    route: "/api/bestaetigung/kontakt",
    render: () =>
      h(BestaetigungFormPanel, {
        token: "kein-echtes-token",
        vorname: "Mira",
        schule: "Lessing-Kolleg",
        saison: "2026",
        rolle: "Ansprechperson",
        mindestalter: 18,
        onAbschluss: () => undefined,
      }),
    submit: (user) => pressTwice(user, { resting: "Ich möchte nicht eingetragen sein", armed: /Widerspruch/ }),
  },
  "the referee's confirmation page": {
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
            text_version: SCHIEDSRICHTER_EINWILLIGUNG.textVersion,
            mindestalter: 16,
            medien_mindestalter: 18,
            frist: "2026-10-05",
          },
        },
      }),
    submit: async (user) => {
      await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
      await user.keyboard(typedBirthdate(40));
      await user.click(screen.getByRole("radio", { name: SCHIEDSRICHTER_UMFANG_OPTIONS[1]?.label ?? "" }));
      await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));
    },
  },
  "the registration form": {
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
        onLinkTot: () => undefined,
      }),
    submit: async (user) => {
      await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
      await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
      await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), "mira.kern@beispiel.test");
      await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    },
  },
  "the pupil's confirmation page": {
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
            text_version: SPIELER_EINWILLIGUNG.textVersion,
            mindestalter: 16,
            medien_mindestalter: 18,
            geburtsdatum: null,
            umfang: null,
            medien: null,
          },
        },
        fassung: {
          textVersion: SPIELER_EINWILLIGUNG.textVersion,
          absaetze: SPIELER_EINWILLIGUNG.absaetzeNachSchluessel,
          schalter: SPIELER_EINWILLIGUNG.schalter,
          bedienelemente: SPIELER_EINWILLIGUNG.bedienelemente,
        },
      }),
    submit: async (user) => {
      await user.click(screen.getByRole("radio", { name: SPIELER_EINWILLIGUNG.bedienelemente.intern }));
      const [tag] = screen.getAllByRole("spinbutton");
      await user.click(tag ?? assert.fail("the page renders no date to type"));
      await user.keyboard(typedBirthdate(17));
      await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));
    },
  },
};

describe("where each public form's write is transported", () => {
  /* The edge answers its rate limit in nginx's own HTML, which `postPublicForm` alone reads as a
     refusal that ruled the write out. A form spelling a write of its own tells the visitor
     something else about a request the edge turned away. */
  for (const [name, form] of Object.entries(FORMS)) {
    it(`${name} posts once to its own route, and passes on the shared helper's reading of the edge's refusal`, async () => {
      const posted: string[] = [];
      transportiert((url, init) => {
        if (init.method !== "POST") return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: ENVELOPE }));

        posted.push(url);
        return Promise.resolve(new Response("<html>429</html>", { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/html" } }));
      });
      raised.length = 0;

      render(form.render());
      await form.submit(userEvent.setup());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

      assert.deepEqual(posted, [form.route], `${name} posted somewhere other than once to its own route`);
      assert.deepEqual(
        raised.filter((toast) => toast.variant === "danger").map((toast) => toast.description),
        [ZU_VIELE_VERSUCHE],
        `${name} told the visitor something other than the shared helper's sentence for the edge's rate limit`,
      );
    });
  }
});
