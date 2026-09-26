import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActionRequest, doubleEveryAction, exportingModule } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, clearSteps, EMPTIEST_ANSWER, readsOf, renderPage, steps } from "@/shared/testing/pageHarness.ts";

import type { FLSubjektResponse, FLSubjektSitz } from "@/core/schemas.ts";
import type { SubjectSession } from "@/core/subject.ts";
import type * as NextError from "next/error";

const { setSubject, subjectReads } = doubleActionRequest();
// The shells hand a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();

/* `next/error` is CommonJS whose exports Node's static reader cannot see, so an area boundary's ESM
   import of `catchError` fails at link. The shim hands on the real function rather than a stand-in. */
const NEXT_ERROR_INTEROP = exportingModule({ catchError: (createRequire(import.meta.filename)("next/error") as typeof NextError).catchError });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/error") return { url: `data:text/javascript,${encodeURIComponent(NEXT_ERROR_INTEROP)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { default: PersoenlichLayout } = await import("@/app/bereich/(persoenlich)/layout.tsx");
const { default: AdminLayout } = await import("@/app/bereich/admin/layout.tsx");

const TEAM_A = "6890a1b2c3d4e5f607250011";

const sitz = (fields: Partial<FLSubjektSitz> = {}): FLSubjektSitz => ({
  saison_id: "2526",
  team_id: TEAM_A,
  rolle: "ansprechperson",
  team_name: "Goethe-Gymnasium",
  saison_status: "active",
  ...fields,
});

/** A person holding what `records` names and nothing else. */
const person = (records: Partial<SubjectSession["subjekt"]> = {}): SubjectSession => ({
  email: "pia@example.org",
  admin: false,
  subjekt: { sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: false, ...records },
});

const SPIELER_ROW = { spieler_id: TEAM_A };
const SCHIEDSRICHTER_ROW = { schiedsrichter_id: TEAM_A };

/** The records the lookup answers the administrator's own address with, until a case names others. */
let adminRecords: Partial<FLSubjektResponse> = {};

answerReadsWith((endpoint, schema, params) =>
  endpoint === "/identitaet/subjekt" ? answer(schema, endpoint, adminRecords) : EMPTIEST_ANSWER(endpoint, schema, params),
);

/** The name the switcher's trigger carries in the markup, or `null` where the shell shows no switcher. */
const triggerIn = (markup: string): string | null => /aria-label="([^"]*, Funktion wechseln)"/.exec(markup)?.[1] ?? null;

const teamAt = (pathname: string) => {
  const params = Promise.resolve({ team_id: TEAM_A, saison_id: "2526" });
  return renderPage(underNext(h(TeamLayout, { params: params, children: null }), { pathname }));
};

describe("the switcher each signed-in shell heads its sidemenu with", () => {
  it("names the team a seat holder stands in, where they hold another place", async () => {
    setSubject(person({ sitze: [sitz()], spieler: [SPIELER_ROW] }));

    assert.equal(triggerIn(await teamAt(`/bereich/team/${TEAM_A}/2526`)), "Goethe-Gymnasium, Funktion wechseln");
  });

  /* Two seats at one team and season are one place, which is no choice to offer. */
  it("shows none to a person whose seats all lead to the one team and season", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" }), sitz()] }));

    assert.equal(triggerIn(await teamAt(`/bereich/team/${TEAM_A}/2526`)), null);
  });

  it("names the person-lane page a person stands on", async () => {
    setSubject(person({ spieler: [SPIELER_ROW], schiedsrichter: [SCHIEDSRICHTER_ROW] }));
    const markup = await renderPage(underNext(h(PersoenlichLayout, { children: null }), { pathname: "/bereich/spieler" }));

    assert.equal(triggerIn(markup), "Spieler, Funktion wechseln");
  });
});

describe("the administrator's switcher", () => {
  const adminAt = async (records: Partial<FLSubjektResponse>) => {
    adminRecords = records;
    setSubject(null);
    clearSteps();
    const markup = await renderPage(underNext(h(AdminLayout, { children: null }), { pathname: "/bereich/admin/teams" }));

    return { markup: markup, lookups: readsOf(steps).filter((read) => read.endpoint === "/identitaet/subjekt").length };
  };

  it("names the administration where the administrator also holds a seat", async () => {
    const { markup } = await adminAt({ sitze: [sitz()] });

    assert.equal(triggerIn(markup), "Verwaltung, Funktion wechseln");
  });

  it("shows none where the allowlist is all the administrator holds", async () => {
    const { markup } = await adminAt({});

    assert.equal(triggerIn(markup), null);
  });

  /* The records keyed on the admin session's own address, in one lookup: never the person lane's guard,
     which reads the sign-in again and sets a second actor on an administrator's request. */
  it("reads the records once through the lookup and never through the person guard", async () => {
    const { lookups } = await adminAt({ sitze: [sitz()] });

    assert.equal(lookups, 1, `the administrator's render looked the records up ${String(lookups)} times`);
    assert.equal(subjectReads(), 0, "the administrator's render ran the person lane's guard");
  });
});
