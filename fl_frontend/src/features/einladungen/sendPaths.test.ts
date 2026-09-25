import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/* Replaced at the module boundary rather than the actions being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real fan-out reaches a mail provider. */
const AUTH = `export const getAdminSession = async () => globalThis.__flSendSession;`;
const CONFIG = `export const frontend_config = { AUTH_URL: "https://liga.example.de" };`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
// Each double records the write the module it replaces records as it sends one, which the admin spine
// judges its answer by.
const API = `import { mayHaveWritten } from "@/core/errors";
import { recordWriteSent } from "@/core/requestScope";
export const apiClient = async (path, _schema, options = {}) => {
  if (mayHaveWritten({ method: (options.method ?? "GET").toUpperCase(), readOnly: options.readOnly === true })) recordWriteSent();
  return globalThis.__flSendApi(path);
};`;
const TEAMS = `export const getTeamMemberships = async () => globalThis.__flSendTeams();`;
const NOTIFICATIONS = `import { recordWriteSent } from "@/core/requestScope";
export const sendZielMail = async (args) => {
  recordWriteSent();
  globalThis.__flSendLog.push("send:" + args.auftrag.zielId);
  globalThis.__flSendMails.push(args);
  await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.__flSendLog.push("settled:" + args.auftrag.zielId);
  return globalThis.__flSendOutcome(args);
};`;

type MailArgs = {
  auftrag: { ziel: string; zielId: string; anlass: string; idempotenzTag?: string };
  recipients: string[];
  buildMail: (address: string) => { subject: string; html: string; text: string };
};

const recorders = globalThis as unknown as Record<string, unknown>;
const mails: MailArgs[] = [];
const log: string[] = [];
recorders.__flSendMails = mails;
recorders.__flSendLog = log;

const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  // `refresh` writes to the same log the fan-out does, which is how the ordering case below reads
  // which of the two ran first without asserting over either module's source.
  "next/cache": `export const refresh = () => { globalThis.__flSendLog.push("refresh"); }; export const updateTag = () => {}; export const revalidateTag = () => {};`,
  "next/headers": `export const headers = async () => new Headers();`,
  "next/navigation": `export const unstable_rethrow = () => {};`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API, shortCircuit: true };
    if (url.endsWith("/src/features/teams/queries.ts")) return { format: "module", source: TEAMS, shortCircuit: true };
    if (url.endsWith("/src/features/zustellung/notifications.ts")) return { format: "module", source: NOTIFICATIONS, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { mailEinladungAction, postEinladungVersandAction } = await import("./actions.ts");
const { ZURUECKGEHALTEN } = await import("./meldungen.ts");

const SAISON_ID = "2627";
const EINLADUNG_ID = "b".repeat(24);
const TOKEN = "geheimer-linkwert";

const seat = (email: string, bestaetigtAm: string | null) => ({
  vorname: "Erika",
  nachname: "Beispiel",
  email: email,
  telefon: "069 1234567",
  geburtsdatum: bestaetigtAm === null ? null : "1990-04-01",
  einwilligung: {
    umfang: "kontaktdaten",
    erfasst_von: bestaetigtAm === null ? "administrativ" : "person",
    text_version: "2026-08-01",
    datum: "2026-08-02",
    bestaetigt_am: bestaetigtAm,
  },
});

const BEIDE_BESTAETIGT = {
  trainer: seat("jonas@beispiel.de", "2026-08-21"),
  ansprechperson: seat("erika@beispiel.de", "2026-08-20"),
  stellvertretung: null,
  trainer_ist_zugleich: null,
};

/* Each case presses on a team id of its own: `getEinladung` is wrapped in React's `cache`, and one
   shared id would let an earlier case's answer stand where a later one changes the live row. */
const teamsHolding = (teamId: string, kontakte: unknown) => () => ({
  acknowledged: 1,
  teams: [{ id: teamId, name: "Ernst-Reuter-Schule", memberships: [{ saison_id: SAISON_ID, kontakte: kontakte }] }],
});

/** The live invite the read answers, whose id is what the press judges the caller's against. */
const liveRow = (einladungId: string) => () => ({
  acknowledged: 1,
  saison_id: SAISON_ID,
  team_id: "x",
  einladung: {
    id: einladungId,
    saison_id: SAISON_ID,
    team_id: "x",
    erstellt_am: "2026-09-01",
    erstellt_von: "v@b.de",
    widerrufen_am: null,
    versand: { zustellung: null },
  },
  laeuft: true,
});

const outcome = (delivered: string[], unreachable: string[], withheld: string[]) => () => ({
  delivered: delivered,
  unreachable: unreachable,
  withheld: withheld,
});

const press = (teamId: string, einladungId = EINLADUNG_ID) =>
  mailEinladungAction({ team_id: teamId, saison_id: SAISON_ID, einladung_id: einladungId, token: TOKEN });

const sentence = (res: { success: boolean; message?: string; error?: string }): string => res.message ?? res.error ?? "";

beforeEach(() => {
  mails.length = 0;
  log.length = 0;
  recorders.__flSendSession = { user: { email: "admin@example.de" } };
  recorders.__flSendApi = liveRow(EINLADUNG_ID);
  recorders.__flSendTeams = teamsHolding("a".repeat(24), BEIDE_BESTAETIGT);
  recorders.__flSendOutcome = outcome(["jonas@beispiel.de", "erika@beispiel.de"], [], []);
});

describe("what the single invite press answers", () => {
  it("counts a delivered fan-out as a send, and writes to the confirmed seats alone", async () => {
    const teamId = "a".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, { ...BEIDE_BESTAETIGT, stellvertretung: seat("mila@beispiel.de", null) });

    const res = await press(teamId);

    assert.equal(res.success, true);
    assert.equal(sentence(res), "Der Link ist an alle 2 Adressen unterwegs.");
    assert.deepEqual(mails[0]?.recipients, ["jonas@beispiel.de", "erika@beispiel.de"]);
  });

  /* Outside production every address is withheld, so a press that cannot tell the two apart offers
     a retry that no repeat of it can reach. */
  it("counts a wholly withheld fan-out as a send, and says the deployment held it", async () => {
    const teamId = "c".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    recorders.__flSendOutcome = outcome([], ["jonas@beispiel.de", "erika@beispiel.de"], ["jonas@beispiel.de", "erika@beispiel.de"]);

    const res = await press(teamId);

    assert.equal(res.success, true);
    assert.equal(sentence(res), ZURUECKGEHALTEN);
  });

  it("refuses a fan-out that delivered to nobody and was withheld from nobody", async () => {
    const teamId = "d".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    recorders.__flSendOutcome = outcome([], ["jonas@beispiel.de", "erika@beispiel.de"], []);

    const res = await press(teamId);

    assert.equal(res.success, false);
    assert.match(sentence(res), /Die E-Mail konnte nicht gesendet werden/);
  });

  /* The spine leaves a refusal standing, and a refused address is still written to the delivery record
     the panel shows. */
  it("refreshes the panel after a fan-out that delivered to nobody", async () => {
    const teamId = "e".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    recorders.__flSendOutcome = outcome([], ["jonas@beispiel.de", "erika@beispiel.de"], []);

    await press(teamId);

    assert.equal(log.at(-1), "refresh", "the panel keeps a delivery record from before the refused send");
  });

  /* A panel left open while somebody replaced the link would otherwise mail a value a newer mint
     already revoked, and file the delivery record against the closed row. */
  it("refuses where the live row is not the one the caller named, and composes nothing", async () => {
    const teamId = "e".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    recorders.__flSendApi = liveRow("f".repeat(24));

    const res = await press(teamId);

    assert.equal(res.success, false);
    assert.match(sentence(res), /Dieser Link ist nicht mehr der offene Link dieses Teams/);
    assert.deepEqual(mails, [], "a revoked token reached the fan-out");
  });

  it("refuses where no link stands at all, and composes nothing", async () => {
    const teamId = "1a".repeat(12);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    recorders.__flSendApi = () => ({ acknowledged: 1, saison_id: SAISON_ID, team_id: "x", einladung: null, laeuft: true });

    const res = await press(teamId);

    assert.equal(res.success, false);
    assert.match(sentence(res), /Für dieses Team steht kein Link mehr offen/);
    assert.deepEqual(mails, []);
  });

  /* Two refusals, each naming a different repair: entering contacts, or waiting for one of them to
     confirm. One sentence for both would send somebody to a page with nothing to do on it. */
  it("tells a team with no contact block apart from one whose seats have not confirmed", async () => {
    recorders.__flSendTeams = teamsHolding("2b".repeat(12), null);
    const ohneBlock = await press("2b".repeat(12));

    recorders.__flSendTeams = teamsHolding("3c".repeat(12), {
      ...BEIDE_BESTAETIGT,
      trainer: seat("jonas@beispiel.de", null),
      ansprechperson: seat("erika@beispiel.de", null),
    });
    const ohneBestaetigung = await press("3c".repeat(12));

    assert.match(sentence(ohneBlock), /keine Kontaktdaten hinterlegt/);
    assert.match(sentence(ohneBestaetigung), /bisher selbst bestätigt/);
    assert.deepEqual(mails, [], "a team nobody may be written to still reached the fan-out");
  });

  /* This press mints nothing, so two presses compose the identical body for the identical row and
     the day's key is what stops the provider sending it twice. */
  it("keys the send against the German day", async () => {
    const teamId = "4d".repeat(12);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);

    await press(teamId);

    assert.match(mails[0]?.auftrag.idempotenzTag ?? "", /^\d{4}-\d{2}-\d{2}$/);
  });

  /* The delivery record is the only thing this press writes, so a refresh above the send would show
     the panel the state before it. */
  it("refreshes after the send rather than before it", async () => {
    const teamId = "5e".repeat(12);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);

    await press(teamId);

    assert.deepEqual(log, [`send:${EINLADUNG_ID}`, `settled:${EINLADUNG_ID}`, "refresh"]);
  });
});

describe("what the season-wide press answers", () => {
  const zeile = (teamId: string, token: string | null, uebersprungen: string | null) => ({
    team_id: teamId,
    team_name: `Schule ${teamId}`,
    uebersprungen: uebersprungen,
    einladung_id: token === null ? null : teamId,
    token: token,
    ersetzt_link: false,
    hatte_link: false as boolean | null,
    empfaenger: [{ rolle: "ansprechperson", vorname: "Erika", email: `erika-${teamId}@beispiel.de` }],
  });

  const pressSeason = (zeilen: unknown[]) => {
    recorders.__flSendApi = () => ({ acknowledged: 1, saison_id: SAISON_ID, zeilen: zeilen });
    return postEinladungVersandAction({ id: SAISON_ID, erneut: false });
  };

  /* The provider allows ten requests a second per account, so a season fanned out at once asks for
     about forty-eight: each team's send settles before the next one starts. */
  it("mails one team after another rather than the whole season at once", async () => {
    await pressSeason([zeile("aa", "t-aa", null), zeile("bb", "t-bb", null)]);

    // The refresh is dropped rather than asserted on: this press writes through the API first, so
    // its place in the log is settled and the ordering under test is the two sends'.
    assert.deepEqual(
      log.filter((entry) => entry !== "refresh"),
      ["send:aa", "settled:aa", "send:bb", "settled:bb"],
    );
  });

  /* Keyed per minted row, so the provider collapses a transport retry of a broken send, and on a tag
     no day spells, so the single press mailing this row today under the club's own name is not refused. */
  it("keys each team's send on the row its link was minted on, apart from the single press's day", async () => {
    await pressSeason([zeile("aa", "t-aa", null), zeile("bb", "t-bb", null)]);

    const keyed = mails.map(({ auftrag }) => [auftrag.zielId, auftrag.idempotenzTag]);
    assert.equal(new Set(keyed.map(([zielId]) => zielId)).size, 2, "two teams' sends share one record");
    for (const [, tag] of keyed) {
      assert.ok(tag !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(tag), `a send was keyed ${String(tag)}`);
    }
  });

  /* Outside production every address is withheld, so a row that cannot tell the two apart reports
     each team as unreachable and names its address in danger red. */
  it("carries what the deployment withheld into the row it answers", async () => {
    recorders.__flSendOutcome = (args: MailArgs) => ({ delivered: [], unreachable: args.recipients, withheld: args.recipients });

    const res = await pressSeason([zeile("aa", "t-aa", null)]);

    assert.equal(res.success, true);
    assert.deepEqual(res.success ? res.zeilen[0]?.zurueckgehalten : [], ["erika-aa@beispiel.de"]);
  });

  it("leaves a skipped team's row empty on all three address lists", async () => {
    const res = await pressSeason([zeile("aa", null, "kein_kontaktblock")]);

    const row = res.success ? res.zeilen[0] : undefined;
    assert.deepEqual([row?.zugestellt, row?.unerreichbar, row?.zurueckgehalten], [[], [], []]);
    assert.deepEqual(mails, [], "a team the endpoint skipped was mailed anyway");
  });

  /* The two rows a team was mailed nothing on and still owes a sentence about its old link: a commit of
     unknown outcome may have revoked it, and a rolled-back one left it opening, where it existed. */
  it("carries the endpoint's link facts through a row that mailed nothing", async () => {
    const res = await pressSeason([
      { ...zeile("aa", null, "erzeugung_ungewiss"), ersetzt_link: true, hatte_link: true },
      { ...zeile("bb", null, "erzeugung_fehlgeschlagen"), hatte_link: true },
      { ...zeile("cc", null, "erzeugung_fehlgeschlagen"), hatte_link: null },
    ]);

    assert.deepEqual(res.success ? res.zeilen.map((row) => [row.team_id, row.ersetzt_link, row.hatte_link]) : [], [
      ["aa", true, true],
      ["bb", false, true],
      ["cc", false, null],
    ]);
  });
});
