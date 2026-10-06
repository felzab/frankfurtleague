import assert from "node:assert/strict";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { publishedOperations } from "@/core/openapiDocument.ts";
import { serverActionModules } from "@/core/treeWalk.ts";
import { cacheCalls, doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { saisonRules } from "@/shared/testing/saisonRules.ts";
import {
  actionReachOf,
  CONDITIONALLY_STEPPED_UP,
  helperReachOf,
  REQUESTS_NAMED,
  STEP_UP_CALLERS,
  STEP_UP_REQUESTS,
  STEP_UP_ROUTES,
  STEP_UP_WRITES,
  UNDECLARED_SENDS,
  UNDO_REPLAYS,
  UNREAD_SENDS,
} from "@/shared/testing/stepUpWrites.ts";
import { undo } from "@/shared/testing/undoRoutes.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

const { setFresh } = doubleActionRequest();

const TEAM_ID = "6890a1b2c3d4e5f607182932";
const SAISON_ID = "2026";
const REFEREE_ID = "6890a1b2c3d4e5f607800001";
const STORED_EMAIL = "anna.koerner@schule.de";

/** The link a mint would end, or none; what the read before a stale mint answers. */
let standing: object | null = null;

/** Whether the stored referee has answered their own link, which decides whether a save or a return mints. */
let answered = false;

const referee = () => ({
  id: REFEREE_ID,
  name: "Anna Körner",
  schule: null,
  default_payment: 20,
  kontakt: { telefon: null, email: STORED_EMAIL },
  inactive_since: "2026-01-10",
  geburtsdatum: answered ? "1990-01-01" : null,
  einwilligung: answered
    ? {
        umfang: "kader_oeffentlich",
        erteilt_von: "volljaehrig",
        datum: "2026-01-02",
        bestaetigt_am: "2026-01-02",
        text_version: "2026-09-schiedsrichterseite",
        medien: false,
        nachweis: { umfang: null, medien: null },
      }
    : null,
  bestaetigung: null,
  adresswechsel: null,
});

/** Each request answered as the backend answers it where it landed, the ones a case here reaches past its step-up. */
function landed({ endpoint, method }: ApiCall): Record<string, unknown> {
  const key = { acknowledged: 1, saison_id: SAISON_ID, team_id: TEAM_ID };
  if (endpoint.endsWith("/einladung")) {
    return method === undefined
      ? { ...key, einladung: standing, laeuft: true }
      : { ...key, einladung_id: "b".repeat(24), token: "t", erstellt_am: "2026-09-01", erstellt_von: "vorstand@example.org" };
  }
  if (endpoint.startsWith("/schiedsrichter/")) {
    return method === undefined
      ? { acknowledged: 1, schiedsrichter: referee(), bestaetigung_abgelaufen: false, adresswechsel_abgelaufen: false }
      : { acknowledged: 1, updated_document: referee(), fanned_out_to_spiele: 0, bestaetigung: null, adresswechsel: null };
  }
  if (endpoint.endsWith("/spielplan")) {
    return {
      acknowledged: 1,
      saison_id: SAISON_ID,
      spieltage: 5,
      spiele: 15,
      generiert_am: "2026-09-01",
      removed_spieltage: 0,
      removed_spiele: 0,
    };
  }
  // No club on file, so every seat a contacts save names is a person the row does not hold.
  if (endpoint === "/teams/memberships") return { acknowledged: 1, teams: [] };
  if (endpoint.endsWith("/bestaetigung/einladen")) {
    return {
      ...key,
      saison_team_id: "c".repeat(24),
      bestaetigung: {
        token: "t",
        rollen: ["ansprechperson"],
        email: STORED_EMAIL,
        vorname: "Anna",
        schule: "Lessing-Kolleg",
        frist: "2026-10-17",
        zeile: "offen",
      },
    };
  }
  return {
    ...key,
    saison_id: "2526",
    saison_team_id: "c".repeat(24),
    kontakte: null,
    kontakte_stand: "a1b2",
    bestaetigungen: [],
    gesperrt: [],
  };
}

/** The label the backend runs on the application form, off the registry it generated. */
const FORM_LABEL = publishedLaufendeFassung("bewerbung").text_version;
// The running label's read answered at its module, so a refusal a case hands the client is the write's alone.
doubleActions({ modules: ["/src/core/einwilligung.ts"], answer: () => Promise.resolve(FORM_LABEL) });

const { calls, answerWith } = doubleApiAnswers((call: ApiCall) => Promise.resolve(landed(call)));

const { stepUpRequired } = await import("./adminMutation.ts");

/** The two actions that authorize nobody, which `fl_frontend/src/shared/utils/adminActionSpine.test.ts` exempts for their own reasons. */
const AUTHORIZES_NOBODY: ReadonlySet<string> = new Set(["auth :: handleSignIn", "auth :: signOutAction"]);

/** The account page's slices, whose every write its own spine holds to the window (`docs/frontend/spec.md :: I422`). */
const ACCOUNT_SLICES: ReadonlySet<string> = new Set(["konto", "passkeys"]);

/** The action named, off the real server action module of its slice that exports it. */
async function action(name: string): Promise<(payload?: unknown) => Promise<unknown>> {
  const slice = STEP_UP_WRITES[name] ?? assert.fail(`${name} is no step-up write`);
  for (const file of serverActionModules(20).filter((module) => path.basename(path.dirname(module)) === slice)) {
    const found = ((await import(pathToFileURL(file).href)) as Record<string, unknown>)[name];
    if (typeof found === "function") return found as (payload?: unknown) => Promise<unknown>;
  }
  return assert.fail(`${slice} exports no ${name}`);
}

const refused = stepUpRequired();

const standingLink = {
  id: "b".repeat(24),
  saison_id: SAISON_ID,
  team_id: TEAM_ID,
  erstellt_am: "2026-09-01",
  erstellt_von: "vorstand@example.org",
  erstellt_von_gesperrt: false,
  widerrufen_am: null,
  versand: null,
};

beforeEach(() => {
  standing = null;
  answered = false;
});

describe("an administrator write the server holds to the step-up window", () => {
  /* The list is read off the declarations, so an action dropping its own falls out of it silently: the
     callers' map, kept by hand for how each press asks, is what still names it. */
  it("declares its step-up wherever a caller was registered as sending one, and has a caller", () => {
    const registered = new Set(Object.values(STEP_UP_CALLERS).flatMap((writes) => Object.keys(writes)));

    assert.deepEqual([...registered].sort(), Object.keys(STEP_UP_WRITES).sort());
  });

  /* Two listings by different routes: every export called bare from a stale session, against the list.
     An action declaring the step-up and missing from the list escapes every sweep of its callers. */
  it("is refused before its body exactly where the list names it", async () => {
    setFresh(false);
    const refusedBeforeTheBody: string[] = [];

    for (const file of serverActionModules(20)) {
      const slice = path.basename(path.dirname(file));
      if (ACCOUNT_SLICES.has(slice)) continue;
      for (const [name, exported] of Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>)) {
        if (AUTHORIZES_NOBODY.has(`${slice} :: ${name}`)) continue;
        const answer: unknown = await (exported as () => Promise<unknown>)();
        if (typeof answer === "object" && answer !== null && Reflect.get(answer, "stepUp") === true) refusedBeforeTheBody.push(name);
      }
    }

    assert.deepEqual(
      refusedBeforeTheBody.sort(),
      Object.keys(STEP_UP_WRITES)
        .filter((name) => !CONDITIONALLY_STEPPED_UP.has(name))
        .sort(),
    );
  });

  /* What each action sends, against what it declares: an action sending a step-up write's request
     with no declaration of its own is missing from every listing above, which starts from one. */
  it("is declared by every action sending a request a step-up write sends", () => {
    const undeclared = Object.entries(UNDECLARED_SENDS)
      .filter(([, sent]) => sent.some((request) => STEP_UP_REQUESTS.has(request)))
      .map(([name, sent]) => `${name} sends ${sent.filter((request) => STEP_UP_REQUESTS.has(request)).join(", ")}`);

    assert.deepEqual(undeclared, []);
  });

  /* The case above sees what the reader attributes, and the reader reads direct calls alone: a request
     sent any other way is undeclared and unseen, so every way of naming one is held to a call it reads. */
  it("sends every request it names where the reader reads it", () => {
    const read = new Set([...STEP_UP_REQUESTS, ...Object.values(UNDECLARED_SENDS).flat(), ...Object.values(UNDO_REPLAYS).flat()]);

    assert.deepEqual(UNREAD_SENDS, []);
    assert.deepEqual([...REQUESTS_NAMED].sort(), [...read].sort(), "the walk and the reader disagree on what the tree sends");
  });

  /* Over a synthetic sample, since the tree holds none of these shapes and a walk finding nothing passes it. */
  it("refuses each way of naming a request the reader cannot read, and no direct call", () => {
    const reachOf = (body: string) =>
      actionReachOf(
        ts.createSourceFile("actions.ts", `import { postSaisonTeam } from "./mutations";\n${body}`, ts.ScriptTarget.Latest, true),
        "teams",
      );
    const UNREAD = ["teams :: postSaisonTeam named where the reader reads no call of it"];

    assert.deepEqual(
      reachOf("export async function a(p: never) { const t: typeof postSaisonTeam = postSaisonTeam; return postSaisonTeam(p); }"),
      {
        referenced: ["teams :: postSaisonTeam"],
        unread: UNREAD,
        reexportedWhole: [],
        importedDynamically: [],
      },
    );
    assert.deepEqual(reachOf("export async function a(p: never): ReturnType<typeof postSaisonTeam> { return postSaisonTeam(p); }").unread, []);
    // Through a local helper, as an exported const, as a const re-exported by name, and handed on as a value.
    for (const body of [
      "async function send(p: never) { return postSaisonTeam(p); }\nexport async function a(p: never) { return send(p); }",
      "export const a = async (p: never) => postSaisonTeam(p);",
      "const a = async (p: never) => postSaisonTeam(p);\nexport { a };",
      "export async function a(p: never) { return run(postSaisonTeam, p); }",
      // Re-exported from the import, with no module of its own named, under its name and under another.
      "export { postSaisonTeam };",
      "export { postSaisonTeam as send };",
    ]) {
      assert.deepEqual(reachOf(body).unread, UNREAD, body);
    }

    const imported = (line: string) => actionReachOf(ts.createSourceFile("actions.ts", line, ts.ScriptTarget.Latest, true), "teams").unread;
    assert.deepEqual(imported('import * as requests from "./mutations";'), ["./mutations as a namespace"]);
    assert.deepEqual(imported('import send from "./mutations";'), ["./mutations's default import"]);
    assert.deepEqual(
      imported('import { postSaisonTeam } from "../teams/mutations.ts";\nexport async function a(p: never) { return postSaisonTeam(p); }'),
      ["../teams/mutations.ts, a specifier the reader does not take"],
    );
    assert.deepEqual(
      imported('export async function a(p: never) { const { postSaisonTeam } = await import("./mutations"); return postSaisonTeam(p); }'),
      ["./mutations imported dynamically"],
    );
    assert.deepEqual(imported("export async function a(where: string) { return import(where); }"), [
      "a dynamic import of a module no literal names",
    ]);
  });

  /* A re-export hands the request to whoever imports this module, which the reader follows no further:
     the planted escape was a `queries.ts` re-exporting a step-up write's request to an undeclared action. */
  it("refuses a request re-exported from a mutations module, by name or whole, and no type", () => {
    const sourceOf = (file: string, line: string) => ts.createSourceFile(file, line, ts.ScriptTarget.Latest, true);
    const inActions = (line: string) => actionReachOf(sourceOf("actions.ts", line), "teams").unread;

    assert.deepEqual(inActions('export { postSaisonTeam as send } from "./mutations";'), [
      "teams :: postSaisonTeam re-exported, where the reader reads no call of it",
    ]);
    assert.deepEqual(inActions('export * from "./mutations";'), ["./mutations re-exported whole"]);
    assert.deepEqual(inActions('export type { FLSaisonTeam } from "./mutations";'), []);

    const inQueries = (line: string) => helperReachOf(sourceOf("queries.ts", line), "teams");
    assert.deepEqual(inQueries('export { postSaisonTeam as plantedSend } from "./mutations";'), [
      "teams :: postSaisonTeam, a step-up write's request",
    ]);
    assert.deepEqual(inQueries('export * as requests from "@/features/teams/mutations";'), ["@/features/teams/mutations re-exported whole"]);
    assert.deepEqual(inQueries('import { postSaisonTeam } from "./mutations";\nexport { postSaisonTeam as plantedSend };'), [
      "teams :: postSaisonTeam, a step-up write's request",
    ]);
    assert.deepEqual(inQueries('export const send = async () => (await import("./mutations")).postSaisonTeam;'), [
      "./mutations imported dynamically",
    ]);
  });

  /* Each export called, never its source read: an action that dropped its declaration validates the
     missing payload, or reaches the backend, and answers something else. */
  for (const name of Object.keys(STEP_UP_WRITES).filter((each) => !CONDITIONALLY_STEPPED_UP.has(each))) {
    it(`${name} is refused before its body, and the page's figure is read again`, async () => {
      setFresh(false);
      const sent = calls.length;

      assert.deepEqual(await (await action(name))(), refused, `${name} did work for a session past the window`);
      assert.equal(calls.length, sent, `${name} reached the backend for a session past the window`);
      assert.deepEqual(
        cacheCalls.map((call) => call.name),
        ["refresh"],
        "the refusal left the page's figure standing, so its next press is refused again",
      );
    });
  }

  /* The declaration refuses a stale session and nothing else: drop the freshness check and every
     write above is refused whatever the session, which a case refusing alone would not see. */
  it("reaches its body from a session inside the window", async () => {
    for (const name of Object.keys(STEP_UP_WRITES)) {
      setFresh(true);
      assert.notDeepEqual(await (await action(name))(), refused, `${name} refused a session inside the window`);
    }
  });

  /* Clearing the block voids every link on the row; an edit moving no link keeps its undo, or every
     save would ask. The row holds nobody here, so an empty block moves nothing. */
  it("refuses clearing a team's contacts, and never an edit moving no link", async () => {
    const patch = await action("patchSaisonTeamKontakteAction");
    const key = { team_id: TEAM_ID, saison_id: "2526", kontakte_stand: "9f2c" };
    const emptySeats = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null };
    setFresh(false);

    const sent = calls.length;
    assert.deepEqual(await patch({ ...key, kontakte: null }), refused, "a stale session cleared a team's contacts");
    assert.equal(calls.length, sent, "the clearing reached the backend for a session past the window");

    // A valid edit, so the answer is past the payload's parse and never the parse's own refusal.
    assert.notDeepEqual(await patch({ ...key, kontakte: emptySeats }), refused, "a stale session was refused an edit moving no link");
    assert.ok(calls.length > sent, "the edit stopped short of the backend");
  });

  /* A save seating a person the row does not hold mints them a bearer link, so it asks; the same save
     from inside the window does not, and the stored row decides only for a session past it. */
  it("refuses a contacts save seating somebody new, and never one from inside the window", async () => {
    const patch = await action("patchSaisonTeamKontakteAction");
    const seated = {
      team_id: TEAM_ID,
      saison_id: "2526",
      kontakte_stand: "9f2c",
      kontakte: {
        trainer: null,
        ansprechperson: {
          vorname: "Anna",
          nachname: "Körner",
          email: STORED_EMAIL,
          telefon: "069 1234567",
          einwilligung: { umfang: "kontaktdaten", text_version: FORM_LABEL, datum: "2026-10-03" },
        },
        stellvertretung: null,
        trainer_ist_zugleich: null,
      },
    };

    setFresh(false);
    const sent = calls.length;
    assert.deepEqual(await patch(seated), refused, "a stale session seated a new contact person");
    assert.ok(
      calls.slice(sent).every(({ method }) => method === undefined),
      "the minting save reached the backend for a session past the window",
    );

    setFresh(true);
    assert.notDeepEqual(await patch(seated), refused, "a fresh session was refused a save seating a new contact person");
  });

  /* A mint ends the standing link, which nothing restores; the first mint ends nothing, and a stale
     session makes it as the page offers it, in one press. */
  it("refuses a mint over a standing link, and never the first mint", async () => {
    const mint = await action("postEinladungAction");
    setFresh(false);

    standing = standingLink;
    assert.deepEqual(await mint({ team_id: TEAM_ID, saison_id: SAISON_ID }), refused, "a stale session ended a standing link");

    standing = null;
    assert.notDeepEqual(await mint({ team_id: TEAM_ID, saison_id: SAISON_ID }), refused, "a stale session was refused the first mint");
  });

  /* A first draw the undraw removes whole; a replacing one deletes what nothing puts back. */
  it("refuses a replacing draw, and never a first one", async () => {
    const draw = await action("generateSpielplanAction");
    setFresh(false);

    assert.deepEqual(await draw({ id: SAISON_ID, replace: true }), refused, "a stale session replaced a draw");
    assert.notDeepEqual(await draw({ id: SAISON_ID }), refused, "a stale session was refused a first draw");
  });

  /* The save mints where it moves a referee's address, a consent link before their answer and an
     address link after it, and only there: a fee changed on a stale session asks nothing. */
  it("refuses a referee's save only where it mints a new link", async () => {
    const save = await action("patchSchiedsrichterAction");
    const payload = (email: string) => ({
      id: REFEREE_ID,
      name: "Anna Körner",
      schule: null,
      default_payment: 25,
      kontakt: { telefon: null, email },
    });
    setFresh(false);

    assert.deepEqual(await save(payload("anna@neu.example")), refused, "a stale session moved an unanswered referee's address");
    assert.notDeepEqual(await save(payload(STORED_EMAIL)), refused, "a stale session was refused a save moving no address");

    answered = true;
    assert.deepEqual(await save(payload("anna@neu.example")), refused, "a stale session moved an answered referee's address");
    assert.notDeepEqual(await save(payload(STORED_EMAIL)), refused, "a stale session was refused an answered referee's unmoved address");
  });

  /* A return asks the referee again only where they never answered, which is the return that mints. */
  it("refuses a referee's return only where it mints a new link", async () => {
    const bringBack = await action("reactivateSchiedsrichterAction");
    setFresh(false);

    assert.deepEqual(await bringBack({ id: REFEREE_ID }), refused, "a stale session brought back an unanswered referee");

    answered = true;
    assert.notDeepEqual(await bringBack({ id: REFEREE_ID }), refused, "a stale session was refused an answered referee's return");
  });
});

const ROUTES = path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin");

/**
 * A referee's undo body as the editor sends it: the save's payload, its address `email`, and the
 * route's own field, as the kontakte drive carries its route's `kontakte_stand`.
 */
const refereeReplay = (email: string) => ({
  id: REFEREE_ID,
  name: "Anna Körner",
  schule: null,
  default_payment: 20,
  kontakt: { telefon: null, email },
  adresswechsel_gespeichert: false,
});

/**
 * Per undo route declaring a step-up, a replay a stale session is refused and one it is not, over what
 * `landed` answers, and the operation the replay sends.
 */
const ROUTE_DRIVES: Record<string, { refused: unknown; admitted: unknown; operation: string }> = {
  kontakte: {
    operation: "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte",
    refused: { team_id: TEAM_ID, saison_id: "2526", kontakte: null, kontakte_stand: "9f2c" },
    admitted: {
      team_id: TEAM_ID,
      saison_id: "2526",
      kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null },
      kontakte_stand: "9f2c",
    },
  },
  // The stored referee has not answered, so moving the address back mints them a link.
  schiedsrichter: {
    operation: "PATCH /schiedsrichter/{schiedsrichter_id}",
    refused: refereeReplay("anna@neu.example"),
    admitted: refereeReplay(STORED_EMAIL),
  },
};

/** A request that writes, as `landed` tells a read from a write. */
const writes = (sent: number): ApiCall[] => calls.slice(sent).filter(({ method }) => method !== undefined);

describe("an undo route the server holds to the step-up window", () => {
  /* A replay is a save, so a route declaring the step-up and driven by nothing here is a second door
     to that save which nothing holds to the window. */
  it("is driven for every route declaring one", () => {
    assert.deepEqual(Object.keys(ROUTE_DRIVES).sort(), [...STEP_UP_ROUTES].sort());
  });

  /* Two listings by different routes, what each replay sends against what each route declares: a route
     replaying a step-up write's request with no `stepUp` of its own drops out of the declared one alone. */
  it("is declared by every route whose replay sends a request a step-up write sends", () => {
    const replaying = Object.entries(UNDO_REPLAYS)
      .filter(([, sent]) => sent.some((request) => STEP_UP_REQUESTS.has(request)))
      .map(([slice]) => slice);

    assert.deepEqual(replaying.sort(), [...STEP_UP_ROUTES].sort());
  });

  /* A replay the reader finds no request in would pass the case above having been asked nothing. */
  it("reads a request off every undo route's replay", () => {
    const unread = Object.entries(UNDO_REPLAYS)
      .filter(([, sent]) => sent.length === 0)
      .map(([slice]) => slice);

    assert.deepEqual(unread, []);
  });

  for (const [slice, drive] of Object.entries(ROUTE_DRIVES)) {
    it(`${slice}'s replay is refused where it steps up and no other, and a fresh session reads nothing to judge it`, async () => {
      const { POST } = (await import(pathToFileURL(path.join(ROUTES, slice, "undo", "route.ts")).href)) as {
        POST: Parameters<typeof undo>[0];
      };
      setFresh(false);

      let sent = calls.length;
      assert.deepEqual(await undo(POST, drive.refused), { ...refused }, `a stale session's ${slice} replay ran`);
      assert.deepEqual(writes(sent), [], `a stale session's ${slice} replay reached the backend`);

      sent = calls.length;
      assert.notDeepEqual(await undo(POST, drive.admitted), { ...refused }, `a stale session was refused a ${slice} replay minting nothing`);
      assert.ok(writes(sent).length > 0, `the ${slice} replay stopped short of the backend`);

      setFresh(true);
      sent = calls.length;
      assert.notDeepEqual(await undo(POST, drive.refused), { ...refused }, `a fresh session was refused a ${slice} replay`);
      assert.equal(calls.length - sent, writes(sent).length, `a fresh session's ${slice} replay read the store to judge a step-up`);
    });
  }

  /* The backend judges the replay on the save's own condition and may refuse it at the window's edge,
     where the page admitted it: a slice's replay table swallowing the code would answer in other words. */
  for (const [slice, drive] of Object.entries(ROUTE_DRIVES)) {
    it(`${slice}'s replay answers the backend's own refusal of it as the step-up refusal`, async () => {
      const { POST } = (await import(pathToFileURL(path.join(ROUTES, slice, "undo", "route.ts")).href)) as {
        POST: Parameters<typeof undo>[0];
      };
      setFresh(true);
      answerWith(() => Promise.reject(refusedOn(drive.operation, "REQ-AUTH-009")));

      assert.deepEqual(await undo(POST, drive.refused), { ...refused }, `the ${slice} replay answered the backend's refusal in other words`);
    });
  }
});

const GRANT_ID = "6890a1b2c3d4e5f6071b0001";
const BEWERBUNG_ID = "6890a1b2c3d4e5f6071c0001";
const SPERRE_ID = "6890a1b2c3d4e5f6071d0001";
const SPIELER_ID = "6890a1b2c3d4e5f6071e0001";
const INCOMING_TEAM_ID = "6890a1b2c3d4e5f607182933";

/** A season both the create's schema and the backend's take, as the season suite's own fixture is. */
const NEW_SAISON = {
  id: "2027",
  start_date: "2027-03-01",
  end_date: "2027-07-01",
  rules: saisonRules(),
  bewerbung: null,
  registrierung: null,
};

/**
 * Per operation publishing the backend's own confirmation refusal, the action sending it and a payload
 * its schema admits; a conditional write's is the call its condition steps up, which the backend judges alike.
 */
const CONFIRMED_BY_THE_BACKEND: Record<string, { name: string; payload: unknown }> = {
  "POST /berechtigungen": { name: "postBerechtigungAction", payload: { email: "neu@schule.de" } },
  "DELETE /berechtigungen/{berechtigung_id}": { name: "deleteBerechtigungAction", payload: { id: GRANT_ID } },
  "PATCH /berechtigungen/{berechtigung_id}": { name: "patchBerechtigungAction", payload: { id: GRANT_ID, verwaltung: "owner" } },
  "POST /bewerbungen/{bewerbung_id}/annehmen": {
    name: "annehmenBewerbungAction",
    payload: { id: BEWERBUNG_ID, gruppe: "A", trikot_farbe: null },
  },
  "POST /bewerbungen/{bewerbung_id}/ablehnen": {
    name: "ablehnenBewerbungAction",
    payload: { id: BEWERBUNG_ID, grund: "Die Gruppen sind voll." },
  },
  "POST /bewerbungen/{bewerbung_id}/einwilligung/{seat}/erneut": {
    name: "einwilligungErneutSendenAction",
    payload: { id: BEWERBUNG_ID, rolle: "ansprechperson" },
  },
  "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}/email": {
    name: "kontaktEmailKorrigierenAction",
    payload: { id: BEWERBUNG_ID, rolle: "ansprechperson", email: "berta@example.de" },
  },
  "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}": {
    name: "besetzeKontaktSitzAction",
    payload: {
      id: BEWERBUNG_ID,
      rolle: "ansprechperson",
      vorname: "Berta",
      nachname: "Beispiel",
      email: "berta@example.de",
      telefon: "069 1234567",
      text_version: FORM_LABEL,
    },
  },
  "POST /teams/{team_id}/saisons/{saison_id}/einladung": { name: "postEinladungAction", payload: { team_id: TEAM_ID, saison_id: SAISON_ID } },
  "DELETE /teams/{team_id}/saisons/{saison_id}/einladung": {
    name: "deleteEinladungAction",
    payload: { team_id: TEAM_ID, saison_id: SAISON_ID },
  },
  "POST /saisons/{saison_id}/einladungen/versand": { name: "postEinladungVersandAction", payload: { id: SAISON_ID } },
  "POST /kontakte/erasure": { name: "eraseKontaktpersonAction", payload: { email: "berta@example.de" } },
  // Clearing the block, one of the two calls of the contacts save the backend steps up, the other
  // being a save that seats somebody new.
  "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte": {
    name: "patchSaisonTeamKontakteAction",
    payload: { team_id: TEAM_ID, saison_id: "2526", kontakte: null, kontakte_stand: "9f2c" },
  },
  "POST /teams/{team_id}/saisons/{saison_id}/kontakte/{seat}/bestaetigung/einladen": {
    name: "einladeKontaktAction",
    payload: { team_id: TEAM_ID, saison_id: "2526", rolle: "ansprechperson" },
  },
  "POST /saisons": { name: "postSaisonAction", payload: NEW_SAISON },
  "POST /saisons/{saison_id}/activate": { name: "activateSaisonAction", payload: { id: SAISON_ID } },
  // A replacing draw, the one the backend steps up.
  "POST /saisons/{saison_id}/spielplan": { name: "generateSpielplanAction", payload: { id: SAISON_ID, replace: true } },
  "DELETE /saisons/{saison_id}/spielplan": { name: "undrawSpielplanAction", payload: { id: SAISON_ID } },
  "POST /schiedsrichter": {
    name: "postSchiedsrichterAction",
    payload: { name: "Anna Körner", schule: null, default_payment: 20, kontakt: { telefon: null, email: STORED_EMAIL } },
  },
  // A moved address, the save the backend steps up where the referee has not answered.
  "PATCH /schiedsrichter/{schiedsrichter_id}": { name: "patchSchiedsrichterAction", payload: refereeReplay("anna@neu.example") },
  "POST /schiedsrichter/{schiedsrichter_id}/reactivate": { name: "reactivateSchiedsrichterAction", payload: { id: REFEREE_ID } },
  "POST /schiedsrichter/{schiedsrichter_id}/bestaetigung/einladen": { name: "einladeSchiedsrichterAction", payload: { id: REFEREE_ID } },
  "POST /schiedsrichter/{schiedsrichter_id}/anonymisieren": { name: "anonymiseSchiedsrichterAction", payload: { id: REFEREE_ID } },
  "POST /schiedsrichter/{schiedsrichter_id}/adresswechsel/einladen": { name: "einladeAdresswechselAction", payload: { id: REFEREE_ID } },
  "DELETE /schiedsrichter/{schiedsrichter_id}/adresswechsel": { name: "verwirfAdresswechselAction", payload: { id: REFEREE_ID } },
  "DELETE /sperrliste/{sperrliste_id}": { name: "deleteSperreAction", payload: { id: SPERRE_ID } },
  "DELETE /spieler/{spieler_id}/erasure": { name: "eraseSpielerAction", payload: { id: SPIELER_ID } },
  "POST /teams/{team_id}/saisons": { name: "postSaisonTeamAction", payload: { team_id: TEAM_ID, saison_id: SAISON_ID, gruppe: "A" } },
  "POST /teams/{team_id}/saisons/{saison_id}/replace": {
    name: "replaceSaisonTeamAction",
    payload: { team_id: TEAM_ID, saison_id: SAISON_ID, incoming_team_id: INCOMING_TEAM_ID },
  },
};

describe("a write the backend refuses for want of a recent confirmation", () => {
  /* Read off the document rather than kept by hand: an operation that starts publishing the refusal
     and is driven by nothing here answers its administrator with the generic fallback. */
  it("is driven for every operation publishing it", () => {
    const publishing = publishedOperations()
      .filter(({ answers }) => answers.some(({ code }) => code === "REQ-AUTH-009"))
      .map(({ operation }) => operation);

    assert.deepEqual(publishing.sort(), Object.keys(CONFIRMED_BY_THE_BACKEND).sort());
  });

  /* The session is inside the spine's window, so only the backend refuses: the answer has to be the
     spine's own refusal, and the figure re-read, for the page's next press to ask. */
  for (const [operation, { name, payload }] of Object.entries(CONFIRMED_BY_THE_BACKEND)) {
    it(`${name} answers the step-up refusal, and the page's figure is read again`, async () => {
      setFresh(true);
      answerWith(() => Promise.reject(refusedOn(operation, "REQ-AUTH-009")));

      assert.deepEqual(await (await action(name))(payload), refused, `${name} answered the backend's refusal in other words`);
      assert.deepEqual(
        cacheCalls.map((call) => call.name),
        ["refresh"],
        "the refusal left the page's figure standing, so its next press is refused again",
      );
    });
  }
});
