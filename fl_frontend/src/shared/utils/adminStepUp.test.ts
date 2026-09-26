import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { filesUnder } from "@/core/treeWalk.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { CONDITIONALLY_STEPPED_UP, STEP_UP_WRITES } from "@/shared/testing/stepUpWrites.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

const { setFresh } = doubleActionRequest();

// The sign-in actions take `after` from it: Node resolves the package's subpath only with its extension,
// where Next's own bundler needs none.
registerHooks({
  resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
});

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
      }
    : null,
  bestaetigung: null,
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
      ? { acknowledged: 1, schiedsrichter: referee() }
      : { acknowledged: 1, updated_document: referee(), fanned_out_to_spiele: 0, bestaetigung: null };
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
  return { ...key, saison_id: "2526", kontakte: null, kontakte_stand: "a1b2" };
}

const { calls } = doubleApiAnswers((call: ApiCall) => Promise.resolve(landed(call)));

const { stepUpRequired } = await import("./adminMutation.ts");

const SLICES = path.resolve(import.meta.dirname, "..", "..", "features");

/** The two actions that authorize nobody, which `fl_frontend/src/shared/utils/adminActionSpine.test.ts` exempts for their own reasons. */
const AUTHORIZES_NOBODY: ReadonlySet<string> = new Set(["auth :: handleSignIn", "auth :: signOutAction"]);

/** The account page's slices, whose every write its own spine holds to the window (`docs/frontend/spec.md :: I422`). */
const ACCOUNT_SLICES: ReadonlySet<string> = new Set(["konto", "passkeys"]);

/** The action named, off its slice's real actions module. */
async function action(name: string): Promise<(payload?: unknown) => Promise<unknown>> {
  const slice = STEP_UP_WRITES[name] ?? assert.fail(`${name} is no step-up write`);
  const actions = (await import(pathToFileURL(path.join(SLICES, slice, "actions.ts")).href)) as Record<string, unknown>;
  const found = actions[name];
  assert.equal(typeof found, "function", `${slice} exports no ${name}`);
  return found as (payload?: unknown) => Promise<unknown>;
}

const refused = stepUpRequired();

const standingLink = {
  id: "b".repeat(24),
  saison_id: SAISON_ID,
  team_id: TEAM_ID,
  erstellt_am: "2026-09-01",
  erstellt_von: "vorstand@example.org",
  widerrufen_am: null,
  versand: null,
};

beforeEach(() => {
  standing = null;
  answered = false;
});

describe("an administrator write the server holds to the step-up window", () => {
  /* Two listings by different routes: every export called bare from a stale session, against the list.
     An action declaring the step-up and missing from the list escapes every sweep of its callers. */
  it("is refused before its body exactly where the list names it", async () => {
    setFresh(false);
    const refusedBeforeTheBody: string[] = [];

    for (const file of filesUnder(SLICES, (name) => name === "actions.ts", 10).sort()) {
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

  /* The cleared block alone is irreversible: an edit of the seats keeps its undo, and asking for the
     passkey there would ask on every save of the contact editor. */
  it("refuses clearing a team's contacts, and never an edit of them", async () => {
    const patch = await action("patchSaisonTeamKontakteAction");
    const key = { team_id: TEAM_ID, saison_id: "2526", kontakte_stand: "9f2c" };
    const emptySeats = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null };
    setFresh(false);

    const sent = calls.length;
    assert.deepEqual(await patch({ ...key, kontakte: null }), refused, "a stale session cleared a team's contacts");
    assert.equal(calls.length, sent, "the clearing reached the backend for a session past the window");

    // A valid edit, so the answer is past the payload's parse and never the parse's own refusal.
    assert.notDeepEqual(await patch({ ...key, kontakte: emptySeats }), refused, "a stale session was refused an edit of the contacts");
    assert.ok(calls.length > sent, "the edit stopped short of the backend");
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

  /* The save mints where it moves an unanswered referee's address, and only there: a fee changed on a
     stale session asks nothing, nor does an address moved on a referee who has answered. */
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
    assert.notDeepEqual(await save(payload("anna@neu.example")), refused, "a stale session was refused an answered referee's new address");
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
