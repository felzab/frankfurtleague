import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { MailOutcome } from "@/core/mailDouble.ts";
import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One line the pass wrote, as the logger was handed it. */
type Line = { level: string; event: string; fields: unknown };

const lines: Line[] = [];
const recorders = globalThis as unknown as Record<string, unknown>;
recorders.__flAbgleichLines = lines;

const LOGGING_DOUBLE = `const record = (level) => (event, ...rest) => globalThis.__flAbgleichLines.push({ level, event, fields: rest.at(-1) });
export const logger = { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") };`;
const CONFIG_DOUBLE = `export const frontend_config = { AUTH_URL: "http://localhost:3000", LOG_FORMAT: "console" };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const OUTBOX_A = "6890a1b2c3d4e5f6071a0001";
const OUTBOX_B = "6890a1b2c3d4e5f6071a0002";
const GRANT_A = "6890a1b2c3d4e5f6071b0001";
const GRANT_B = "6890a1b2c3d4e5f6071b0002";

const HOLDERS = ["inhaber@schule.de", "vorstand@schule.de"];

/** One change as a claim answers it; each case names what it differs in. */
const aenderung = (fields: Record<string, unknown> = {}) => ({
  id: OUTBOX_A,
  berechtigung_id: GRANT_A,
  art: "erteilt",
  jetzt: { adresse: "neu@schule.de", verwaltung: "administration" },
  vorher: null,
  geaendert_von: "vorstand@schule.de",
  geaendert_am: "2026-09-27T01:00:00Z",
  gesperrt: false,
  ...fields,
});

const claimOf = (aenderungen: unknown[], extra: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  beanspruchung: aenderungen.length === 0 ? null : "claim-1",
  beansprucht_bis: aenderungen.length === 0 ? null : "2026-09-27T01:10:00Z",
  aenderungen: aenderungen,
  empfaenger: HOLDERS,
  uebersprungen: 0,
  ...extra,
});

/** What the next claim answers, or a throw where a case says the backend is down. */
let claim: unknown = claimOf([]);

/** Resolves the claim a case holds open, so a second pass can start beside the first. */
let holdClaim: Promise<void> | null = null;

const calls = doubleApiClient((call: ApiCall, schema) => {
  if (call.endpoint === "/berechtigungen/abgleich") {
    return (holdClaim ?? Promise.resolve()).then(() => {
      if (claim instanceof Error) throw claim;
      return schema.parse(claim);
    });
  }

  const ids = (JSON.parse(call.body ?? "{}") as { ids: string[] }).ids;
  return schema.parse({ acknowledged: 1, angekuendigt: ids.length, ignoriert: 0 });
});

const mail = doubleSendMail();

const { runBerechtigungenAbgleich } = await import("./abgleich.ts");

/** The ids each stamp named, in order. */
const stamps = (): { beanspruchung: string; ids: string[] }[] =>
  calls
    .filter((call) => call.endpoint === "/berechtigungen/abgleich/angekuendigt")
    .map((call) => JSON.parse(call.body ?? "{}") as { beanspruchung: string; ids: string[] });

const claims = (): number => calls.filter((call) => call.endpoint === "/berechtigungen/abgleich").length;

beforeEach(() => {
  calls.length = 0;
  lines.length = 0;
  claim = claimOf([]);
  holdClaim = null;
});

describe("one pass over the claimed changes", () => {
  /* Mail, then stamp: stamping first would mark as told a change nobody was told of. */
  it("mails every holder and the address granted once each, then stamps the row under the claim", async () => {
    claim = claimOf([aenderung({ jetzt: { adresse: "vorstand@schule.de", verwaltung: "administration" } })]);

    await runBerechtigungenAbgleich();

    assert.deepEqual(mail.sent.map((sent) => sent.to).sort(), [...HOLDERS].sort(), "a holder named twice was mailed twice");
    assert.deepEqual(stamps(), [{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* A removed address is in no grant, so it is on no holder list: it is mailed off its own change. */
  it("mails the address a revoke removed beside the holders", async () => {
    claim = claimOf([aenderung({ art: "entzogen", jetzt: null, vorher: { adresse: "alt@schule.de", verwaltung: "administration" } })]);

    await runBerechtigungenAbgleich();

    assert.deepEqual(mail.sent.map((sent) => sent.to).sort(), ["alt@schule.de", ...HOLDERS].sort());
    assert.ok(mail.sent.every((sent) => sent.text.includes("alt@schule.de hat keinen Zugang zur Verwaltung mehr.")));
  });

  /* A barred address leaves the ban list on no route: the answer withholds it, and the pass mails
     only the holders, telling them a barred address was granted. */
  it("mails a barred address nothing, and names it to nobody", async () => {
    claim = claimOf([
      aenderung({ jetzt: { adresse: null, verwaltung: "administration" }, gesperrt: true, geaendert_von: null, geaendert_am: null }),
    ]);

    await runBerechtigungenAbgleich();

    assert.deepEqual(mail.sent.map((sent) => sent.to).sort(), [...HOLDERS].sort());
    assert.ok(mail.sent.every((sent) => sent.text.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung.")));
    assert.ok(mail.sent.every((sent) => sent.text.includes("direkt in der Datenbank")));
    // Told in full: a send attempted to the withheld address fails, and leaves the row for every later pass.
    assert.deepEqual(lines, []);
    assert.deepEqual(stamps(), [{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* One key per row and recipient: a lapsed claim mailing a row again reaches nobody twice inside
     the provider's day, and two recipients never share one. */
  it("keys each send on its outbox row and its recipient", async () => {
    claim = claimOf([aenderung()]);

    await runBerechtigungenAbgleich();
    const first = mail.sent.map((sent) => sent.idempotencyKey);
    mail.sent.length = 0;
    await runBerechtigungenAbgleich();
    const second = mail.sent.map((sent) => sent.idempotencyKey);

    assert.equal(new Set(first).size, first.length, "two recipients share one key");
    assert.deepEqual(second, first, "the same row mailed again carries other keys");
    assert.ok(
      first.every((key) => key?.startsWith(`berechtigung_${OUTBOX_A}_`)),
      "a key is not the row's",
    );
  });
});

describe("what a pass leaves for the next", () => {
  /* A send that may yet land keeps its row: the next claim, once this one lapses, mails it again under
     the same keys, where stamping it would lose a notice for good. */
  it("stamps a change whose every send settled, and leaves one whose send may yet land", async () => {
    claim = claimOf([
      aenderung(),
      aenderung({ id: OUTBOX_B, berechtigung_id: GRANT_B, jetzt: { adresse: "zwei@schule.de", verwaltung: "administration" } }),
    ]);
    const lost: MailOutcome = "lost";
    mail.answerWith((sent) => (sent.text.includes("zwei@schule.de") && sent.to === "vorstand@schule.de" ? lost : "accepted"));

    await runBerechtigungenAbgleich();

    assert.deepEqual(stamps(), [{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
    assert.ok(
      lines.some(
        (line) =>
          line.event === "berechtigung.notice_failed" &&
          JSON.stringify(line.fields) === JSON.stringify({ error_code: "FE-MAIL-009", name: "APINetworkError" }),
      ),
      "the lost send left no line, or one carrying more than its name",
    );
  });

  /* A stack that mails nothing counts the change as told, or it would claim the same rows forever. */
  it("counts a withheld send and a refused mailbox as told", async () => {
    claim = claimOf([aenderung()]);
    mail.answerWith((sent) => (sent.to === "inhaber@schule.de" ? "withheld" : { refused: 422, providerErrorName: "validation_error" }));

    await runBerechtigungenAbgleich();

    assert.deepEqual(stamps(), [{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  it("stamps nothing and mails nothing where the claim holds no change", async () => {
    await runBerechtigungenAbgleich();

    assert.deepEqual(mail.sent, []);
    assert.deepEqual(stamps(), []);
  });

  /* Nothing awaits a pass, so a throw would surface as an unhandled rejection with no line to read. */
  it("settles where the claim fails, logging the name alone", async () => {
    claim = new Error("the backend answered nothing");

    await runBerechtigungenAbgleich();

    assert.deepEqual(
      lines.map((line) => [line.event, line.fields]),
      [["berechtigung.abgleich_failed", { error_code: "FE-SWEEP-002", name: "Error" }]],
    );
  });

  it("warns of rows no request can match, counting them", async () => {
    claim = claimOf([], { uebersprungen: 2 });

    await runBerechtigungenAbgleich();

    assert.deepEqual(
      lines.map((line) => [line.level, line.event, line.fields]),
      [["WARN", "berechtigung.abgleich_uebersprungen", { error_code: "FE-SWEEP-002", anzahl: 2 }]],
    );
  });
});

describe("two passes asked for at once", () => {
  /* A change written after a running pass claimed would wait for the next tick if the second ask were
     dropped, and would be claimed twice if it ran beside the first. */
  it("runs the second after the first rather than beside it or not at all", async () => {
    let release = (): void => undefined;
    holdClaim = new Promise((resolve) => {
      release = resolve;
    });

    const first = runBerechtigungenAbgleich();
    const second = runBerechtigungenAbgleich();
    const third = runBerechtigungenAbgleich();
    await second;
    await third;
    assert.equal(claims(), 1, "a second pass claimed beside the first");

    holdClaim = null;
    release();
    await first;

    assert.equal(claims(), 2, "the asks made while the first ran were dropped, or each ran a pass of its own");
  });
});
