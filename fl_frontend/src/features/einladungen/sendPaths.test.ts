import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";
import { doubleSendMail } from "@/shared/testing/mailDouble.ts";

import type { MailOutcome, SentMail } from "@/shared/testing/mailDouble.ts";

/* The real client reaches a backend no test process runs and the real mailer a provider, so those two
   are replaced; the fan-out is the real one, and what the actions hand it is read off the messages it sends. */
const CONFIG = `export const frontend_config = { AUTH_URL: "https://liga.example.de" };`;
/** What the client answers in this case, whichever endpoint the action reads. */
let apiAnswer: () => unknown = () => undefined;
// The delivery report each accepted or refused message files, which the backend applies.
doubleApiClient(({ endpoint }) => (endpoint.startsWith("/zustellung/") ? { acknowledged: 1, angewendet: true } : apiAnswer()));
const TEAMS = `export const getTeamMemberships = async () => globalThis.__flSendTeams();`;

const recorders = globalThis as unknown as Record<string, unknown>;
const log: string[] = [];
recorders.__flSendLog = log;

/** Each address's outcome: delivered, refused by the provider, or held by the deployment. */
const outcome =
  (delivered: string[], unreachable: string[], withheld: string[]) =>
  ({ to }: SentMail): MailOutcome =>
    withheld.includes(to) ? "withheld" : unreachable.includes(to) ? "refused" : delivered.includes(to) ? "accepted" : "lost";

const mail = doubleSendMail();
/** Answers every message with `answer`, logging the send and, a tick later, its settling against the row it is filed under. */
const sendWith = (answer: (sent: SentMail) => MailOutcome): void =>
  mail.answerWith(async (sent) => {
    log.push(`send:${sent.tags?.ziel_id ?? ""}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    log.push(`settled:${sent.tags?.ziel_id ?? ""}`);
    return answer(sent);
  });

/** The tag a message's key is scoped by: `fl_frontend/src/features/zustellung/notifications.ts :: zielIdempotenzSchluessel`'s fourth part. */
const keyTag = ({ idempotencyKey }: SentMail): string | undefined => idempotencyKey?.split("_")[3];

// `refresh` writes to the same log the fan-out does, which is how the ordering case below reads which
// of the two ran first; `cacheCalls` is a list of its own, so it cannot order a refresh against a send.
const NEXT_CACHE = `export const refresh = () => { globalThis.__flSendLog.push("refresh"); }; export const updateTag = () => {}; export const revalidateTag = () => {};`;

doubleActionRequest();

// Registered after the request's doubles, so its `next/cache` answers before theirs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent(NEXT_CACHE)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG, shortCircuit: true };
    if (url.endsWith("/src/features/teams/queries.ts")) return { format: "module", source: TEAMS, shortCircuit: true };
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

const press = (teamId: string, einladungId = EINLADUNG_ID) =>
  mailEinladungAction({ team_id: teamId, saison_id: SAISON_ID, einladung_id: einladungId, token: TOKEN });

const sentence = (res: { success: boolean; message?: string; error?: string }): string => res.message ?? res.error ?? "";

beforeEach(() => {
  log.length = 0;
  apiAnswer = liveRow(EINLADUNG_ID);
  recorders.__flSendTeams = teamsHolding("a".repeat(24), BEIDE_BESTAETIGT);
  sendWith(outcome(["jonas@beispiel.de", "erika@beispiel.de"], [], []));
});

describe("what the single invite press answers", () => {
  it("counts a delivered fan-out as a send, and writes to the confirmed seats alone", async () => {
    const teamId = "a".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, { ...BEIDE_BESTAETIGT, stellvertretung: seat("mila@beispiel.de", null) });

    const res = await press(teamId);

    assert.equal(res.success, true);
    assert.equal(sentence(res), "Der Link ist an alle 2 Adressen unterwegs.");
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      ["jonas@beispiel.de", "erika@beispiel.de"],
    );
  });

  /* Outside production every address is withheld, so a press that cannot tell the two apart offers
     a retry that no repeat of it can reach. */
  it("counts a wholly withheld fan-out as a send, and says the deployment held it", async () => {
    const teamId = "c".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    sendWith(outcome([], ["jonas@beispiel.de", "erika@beispiel.de"], ["jonas@beispiel.de", "erika@beispiel.de"]));

    const res = await press(teamId);

    assert.equal(res.success, true);
    assert.equal(sentence(res), ZURUECKGEHALTEN);
  });

  /* A held message reached no provider, so the press wrote nothing and the delivery record the panel
     shows is the one it already had. */
  it("leaves the panel standing where the deployment held every message", async () => {
    const teamId = "6f".repeat(12);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    sendWith(() => "withheld");

    await press(teamId);

    assert.ok(!log.includes("refresh"), "a press that sent nothing refreshed the panel as though it had written");
  });

  it("refuses a fan-out that delivered to nobody and was withheld from nobody", async () => {
    const teamId = "d".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    sendWith(outcome([], ["jonas@beispiel.de", "erika@beispiel.de"], []));

    const res = await press(teamId);

    assert.equal(res.success, false);
    assert.match(sentence(res), /Die E-Mail konnte nicht gesendet werden/);
  });

  /* The spine leaves a refusal standing, and a refused address is still written to the delivery record
     the panel shows. */
  it("refreshes the panel after a fan-out that delivered to nobody", async () => {
    const teamId = "e".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    sendWith(outcome([], ["jonas@beispiel.de", "erika@beispiel.de"], []));

    await press(teamId);

    assert.equal(log.at(-1), "refresh", "the panel keeps a delivery record from before the refused send");
  });

  /* A panel left open while somebody replaced the link would otherwise mail a value a newer mint
     already revoked, and file the delivery record against the closed row. */
  it("refuses where the live row is not the one the caller named, and composes nothing", async () => {
    const teamId = "e".repeat(24);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    apiAnswer = liveRow("f".repeat(24));

    const res = await press(teamId);

    assert.equal(res.success, false);
    assert.match(sentence(res), /Dieser Link ist nicht mehr der offene Link dieses Teams/);
    assert.deepEqual(mail.sent, [], "a revoked token reached the fan-out");
  });

  it("refuses where no link stands at all, and composes nothing", async () => {
    const teamId = "1a".repeat(12);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);
    apiAnswer = () => ({ acknowledged: 1, saison_id: SAISON_ID, team_id: "x", einladung: null, laeuft: true });

    const res = await press(teamId);

    assert.equal(res.success, false);
    assert.match(sentence(res), /Für dieses Team steht kein Link mehr offen/);
    assert.deepEqual(mail.sent, []);
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
    assert.deepEqual(mail.sent, [], "a team nobody may be written to still reached the fan-out");
  });

  /* This press mints nothing, so two presses compose the identical body for the identical row and
     the day's key is what stops the provider sending it twice. */
  it("keys the send against the German day", async () => {
    const teamId = "4d".repeat(12);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);

    await press(teamId);

    assert.match(mail.sent[0] === undefined ? "" : (keyTag(mail.sent[0]) ?? ""), /^\d{4}-\d{2}-\d{2}$/);
  });

  /* The delivery record is the only thing this press writes, so a refresh above the send would show
     the panel the state before it. */
  it("refreshes after the send rather than before it", async () => {
    const teamId = "5e".repeat(12);
    recorders.__flSendTeams = teamsHolding(teamId, BEIDE_BESTAETIGT);

    await press(teamId);

    // The two confirmed seats are written to at once, so both sends settle before the refresh.
    const [send, settled] = [`send:${EINLADUNG_ID}`, `settled:${EINLADUNG_ID}`];
    assert.deepEqual(log, [send, send, settled, settled, "refresh"]);
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
    apiAnswer = () => ({ acknowledged: 1, saison_id: SAISON_ID, zeilen: zeilen });
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

    const keyed = mail.sent.map((sent) => [sent.tags?.ziel_id, keyTag(sent)]);
    assert.equal(new Set(keyed.map(([zielId]) => zielId)).size, 2, "two teams' sends share one record");
    for (const [, tag] of keyed) {
      assert.ok(tag !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(tag), `a send was keyed ${String(tag)}`);
    }
  });

  /* Outside production every address is withheld, so a row that cannot tell the two apart reports
     each team as unreachable and names its address in danger red. */
  it("carries what the deployment withheld into the row it answers", async () => {
    sendWith(() => "withheld");

    const res = await pressSeason([zeile("aa", "t-aa", null)]);

    assert.equal(res.success, true);
    assert.deepEqual(res.success ? res.zeilen[0]?.zurueckgehalten : [], ["erika-aa@beispiel.de"]);
  });

  it("leaves a skipped team's row empty on all three address lists", async () => {
    const res = await pressSeason([zeile("aa", null, "kein_kontaktblock")]);

    const row = res.success ? res.zeilen[0] : undefined;
    assert.deepEqual([row?.zugestellt, row?.unerreichbar, row?.zurueckgehalten], [[], [], []]);
    assert.deepEqual(mail.sent, [], "a team the endpoint skipped was mailed anyway");
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
