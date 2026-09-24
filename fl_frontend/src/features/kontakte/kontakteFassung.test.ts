import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import type { FLKontaktperson, FLKontaktpersonPayload, FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { FLPatchSaisonTeamKontaktePayload } from "./schemas";

/* Replaced at the module boundary rather than the action being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real session store a database. */
const API = `export const apiClient = async (endpoint, _schema, options = {}) => {
  globalThis.__flFassungCalls.push({ endpoint, method: options.method ?? "GET" });
  return globalThis.__flFassungAnswer(endpoint);
};`;
const AUTH = `export const getAdminSession = async () => ({ user: { email: "vorstand@example.org" } });`;
const LOGGING = `export const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };`;
const CONFIG = `export const frontend_config = { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" };`;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/** Every package the action reaches that this process cannot load, doubled at resolve time. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/cache":
    "export const refresh = () => {}; export const updateTag = () => {}; export const cacheLife = () => {}; export const cacheTag = () => {};",
  "next/headers": "export const headers = async () => new Headers();",
  "next/navigation": "export const unstable_rethrow = () => {};",
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API, shortCircuit: true };
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { patchSaisonTeamKontakteAction } = await import("./actions.ts");
const { BEWERBUNG_VERALTET } = await import("@/features/bewerbungen/utils.ts");
const { BESTAETIGUNG_KENNTNISNAHME, LIGA_KENNTNISNAHME } = await import("@/core/einwilligung.ts");

const TEAM_ID = `${"a".repeat(23)}1`;
const SAISON_ID = "2526";
const LAUFEND = LIGA_KENNTNISNAHME.textVersion;
/** A label an older build stamped, which the running one still resolves. */
const AELTER = "2026-09-bestaetigung-4";
/** What the person's own confirmation page stores, which is never the running application label. */
const BESTAETIGT = BESTAETIGUNG_KENNTNISNAHME.textVersion;

const calls: { endpoint: string; method: string }[] = [];
let stored: FLSaisonTeamKontakte | null = null;
const recorders = globalThis as unknown as Record<string, unknown>;
recorders.__flFassungCalls = calls;
recorders.__flFassungAnswer = (endpoint: string) =>
  endpoint === "/teams/memberships"
    ? { teams: [{ id: TEAM_ID, memberships: [{ saison_id: SAISON_ID, kontakte: stored, kontakte_stand: "stand" }] }] }
    : { acknowledged: 1, saison_id: SAISON_ID, team_id: TEAM_ID, kontakte: null, kontakte_stand: "neu" };

const storedSeat = (vorname: string, textVersion: string): FLKontaktperson => ({
  vorname,
  nachname: "Muster",
  email: `${vorname.toLowerCase()}@schule.example`,
  telefon: "069 3333333",
  geburtsdatum: "1990-12-10",
  einwilligung: { umfang: "kontaktdaten", erfasst_von: "person", text_version: textVersion, datum: "2026-09-01", bestaetigt_am: "2026-09-02" },
});

/** A seat as the editor sends it, under whichever label it carries. */
const sentSeat = (vorname: string, textVersion: string): FLKontaktpersonPayload => ({
  vorname,
  nachname: "Muster",
  email: `${vorname.toLowerCase()}@schule.example`,
  telefon: "069 3333333",
  einwilligung: { umfang: "kontaktdaten", text_version: textVersion, datum: "2026-09-01" },
});

const save = (kontakte: FLPatchSaisonTeamKontaktePayload["kontakte"]) =>
  patchSaisonTeamKontakteAction({ team_id: TEAM_ID, saison_id: SAISON_ID, kontakte, kontakte_stand: "stand" });

const wrote = (): boolean => calls.some(({ method }) => method === "PATCH");

beforeEach(() => {
  calls.length = 0;
  stored = null;
});

describe("the labels a contacts save may carry", () => {
  /* The control: a block of new seats under the running label reaches the write, and no stored block
     is read for it, so a check refusing everything fails here rather than passing the refusals. */
  it("saves new seats under the running label without reading the stored block", async () => {
    const answer = await save({
      trainer: sentSeat("Ada", LAUFEND),
      ansprechperson: sentSeat("Grace", LAUFEND),
      stellvertretung: sentSeat("Alan", LAUFEND),
      trainer_ist_zugleich: null,
    });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(
      calls.map(({ endpoint }) => endpoint),
      [`/teams/${TEAM_ID}/saisons/${SAISON_ID}/kontakte`],
    );
  });

  /* A page opened before a deploy moved the label: the new person would be recorded under words the
     running build does not serve. */
  it("refuses a new seat under an older label, writing nothing", async () => {
    stored = { trainer: null, ansprechperson: storedSeat("Grace", BESTAETIGT), stellvertretung: null, trainer_ist_zugleich: null };

    const answer = await save({
      trainer: sentSeat("Ada", AELTER),
      ansprechperson: sentSeat("Grace", BESTAETIGT),
      stellvertretung: null,
      trainer_ist_zugleich: null,
    });

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.equal(wrote(), false);
  });

  /* The case the check exists to admit: every save of a block holding a confirmed seat sends that
     seat back under the confirmation page's label. */
  it("saves a confirmed seat under the label it stores", async () => {
    stored = {
      trainer: storedSeat("Ada", LAUFEND),
      ansprechperson: storedSeat("Grace", BESTAETIGT),
      stellvertretung: storedSeat("Alan", AELTER),
      trainer_ist_zugleich: null,
    };

    const answer = await save({
      trainer: sentSeat("Ada", LAUFEND),
      ansprechperson: sentSeat("Grace", BESTAETIGT),
      stellvertretung: sentSeat("Alan", AELTER),
      trainer_ist_zugleich: null,
    });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.equal(wrote(), true);
  });

  it("refuses a stored seat relabelled to a label it never stored, writing nothing", async () => {
    stored = { trainer: null, ansprechperson: storedSeat("Grace", BESTAETIGT), stellvertretung: null, trainer_ist_zugleich: null };

    const answer = await save({ trainer: null, ansprechperson: sentSeat("Grace", AELTER), stellvertretung: null, trainer_ist_zugleich: null });

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.equal(wrote(), false);
  });

  /* The Trainer the claim composes is a copy of the named seat, label included, so it is judged by
     what that seat stores rather than by a Trainer seat that may hold nobody. */
  it("judges a mirrored Trainer through the seat it copies", async () => {
    stored = { trainer: null, ansprechperson: storedSeat("Grace", BESTAETIGT), stellvertretung: null, trainer_ist_zugleich: null };

    const answer = await save({
      trainer: sentSeat("Grace", BESTAETIGT),
      ansprechperson: sentSeat("Grace", BESTAETIGT),
      stellvertretung: null,
      trainer_ist_zugleich: "ansprechperson",
    });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.equal(wrote(), true);
  });
});
