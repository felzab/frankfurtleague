import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";
import { inspect } from "node:util";

import type { ZielAuftrag } from "./notifications.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

type SentMail = { to: string; subject: string; tags?: Record<string, string>; idempotencyKey?: string };

/** The WHOLE call, the error argument included: that argument is the channel an address travels on. */
type LoggedCall = { message: string; error: unknown; meta: Record<string, unknown> };

const recorders = globalThis as unknown as Record<string, unknown>;

const sent: SentMail[] = [];
const logged: LoggedCall[] = [];
/** Addresses the doubled provider refuses, so a failure can be aimed at one recipient. */
const refused = new Set<string>();
/** Addresses this deployment never tries, which is the shape every stack but production has. */
const withheld = new Set<string>();
/** Addresses whose domain has no ASCII form: that recipient fails and the rest of the fan-out does not. */
const unconvertible = new Set<string>();
/** Per address the provider itself turned away: its own token, and the status that says whether a retry could land. */
const tokenRefused = new Map<string, { token?: string; status: number }>();
const gemeldet: Record<string, unknown>[] = [];
const abgewiesen: Record<string, unknown>[] = [];

recorders.__flZielSentMail = sent;
recorders.__flZielMailLogs = logged;
recorders.__flZielRefusedMail = refused;
recorders.__flZielWithheldMail = withheld;
recorders.__flZielUnconvertibleMail = unconvertible;
recorders.__flZielTokenRefusedMail = tokenRefused;
recorders.__flZielGemeldet = gemeldet;
recorders.__flZielAbgewiesen = abgewiesen;
recorders.__flZielAbweisungFails = false;
recorders.__flZielMeldungFails = false;
recorders.__flZielAngewendet = true;
recorders.__flZielAcceptedId = "56761188-7520-42d8-8898-ff6fc54ce618";

// Replaced at the module boundary rather than the fan-out being reshaped to admit a seam: the real
// transport posts to the mail provider, on a key no test run holds.

// The two error classes come from the real module rather than being restated: the fan-out tells a
// withheld send from a refused one with `instanceof`, which a look-alike passes only by accident.
const MAIL_DOUBLE = `export { MailRecipientError, MailWithheldError } from "./mail.ts?real";
import { MailRecipientError, MailWithheldError } from "./mail.ts?real";
// The real class here too: the refusal arm reads the provider's token off it, which a look-alike
// carrying the same field would not prove.
import { MailSendError } from "./errors.ts";

export const sendMail = async (mail) => {
  globalThis.__flZielSentMail.push({ to: mail.to, subject: mail.subject, tags: mail.tags, idempotencyKey: mail.idempotencyKey });
  if (globalThis.__flZielWithheldMail.has(mail.to)) throw new MailWithheldError();
  if (globalThis.__flZielUnconvertibleMail.has(mail.to)) throw new MailRecipientError();
  const abweisung = globalThis.__flZielTokenRefusedMail.get(mail.to);
  if (abweisung !== undefined) {
    throw new MailSendError({
      message: "The mail provider refused the message.",
      url: "https://api.example.invalid/emails",
      statusCode: abweisung.status,
      providerErrorName: abweisung.token,
      traceId: "0123456789abcdef0123456789abcdef",
    });
  }
  if (globalThis.__flZielRefusedMail.has(mail.to)) throw new Error("the provider refused the message");
  return { id: globalThis.__flZielAcceptedId };
};`;

// The recording half of the fan-out reaches the backend, which no test process runs.
const MUTATIONS_DOUBLE = `export const meldeZielZustellungAngenommen = async (payload) => {
  globalThis.__flZielGemeldet.push(payload);
  if (globalThis.__flZielMeldungFails) throw new Error("the backend refused the record");
  return { acknowledged: 1, angewendet: globalThis.__flZielAngewendet };
};

export const meldeZielZustellungAbgewiesen = async (payload) => {
  globalThis.__flZielAbgewiesen.push(payload);
  if (globalThis.__flZielAbweisungFails) throw new Error("the backend refused the record");
  return { acknowledged: 1, angewendet: globalThis.__flZielAngewendet };
};`;

// The error argument is CAPTURED, never discarded: `fl_frontend/src/core/logFormat.ts :: serializeError`
// writes an error's message and stack, so a double that drops it cannot see an address reaching the
// stream through one.
const LOGGING_DOUBLE = `export const logger = {
  info: () => {},
  warn: (message, meta) => {
    globalThis.__flZielMailLogs.push({ message, error: undefined, meta: meta ?? {} });
  },
  error: (message, error, meta) => {
    globalThis.__flZielMailLogs.push({
      message,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      meta: meta ?? {},
    });
  },
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/features/zustellung/mutations.ts")) return { format: "module", source: MUTATIONS_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { sendZielMail, zielIdempotenzSchluessel, zielZustellungTags } = await import("./notifications.ts");
const { FLZustellungZielSchema } = await import("./schemas.ts");

const ZIEL_ID = `${"c".repeat(23)}3`;
const ADDRESS = "bramblewick@example.com";
const SECOND_ADDRESS = "quillon@example.com";

const auftrag: ZielAuftrag = { ziel: "schiedsrichter", zielId: ZIEL_ID, anlass: "eingang" };

const buildMail = (address: string) => ({
  subject: "Bitte bestätige Deine Angaben",
  html: `<p>${address}</p>`,
  text: `Hallo ${address}`,
});

beforeEach(() => {
  sent.length = 0;
  logged.length = 0;
  gemeldet.length = 0;
  abgewiesen.length = 0;
  refused.clear();
  withheld.clear();
  unconvertible.clear();
  tokenRefused.clear();
  recorders.__flZielAbweisungFails = false;
  recorders.__flZielMeldungFails = false;
  recorders.__flZielAngewendet = true;
  recorders.__flZielAcceptedId = "56761188-7520-42d8-8898-ff6fc54ce618";
});

describe("the tags one message rides out with", () => {
  /* The provider refuses a tag outside this alphabet with a 422, which reaches the fan-out as a
     message nobody got and no state anywhere. */
  it("keeps every name and value inside the alphabet the provider admits", () => {
    for (const [name, value] of Object.entries(zielZustellungTags(auftrag))) {
      assert.match(name, /^[A-Za-z0-9_-]+$/, `the tag name ${name} is outside the provider's alphabet`);
      assert.match(value, /^[A-Za-z0-9_-]+$/, `the value of ${name} is outside the provider's alphabet`);
    }
  });

  /* Every member has to survive the round trip, and a kind whose spelling carried a character the
     provider refuses would be the one target whose bounces never came back. */
  it("keeps every member of the closed set inside that alphabet too", () => {
    for (const ziel of FLZustellungZielSchema.options) {
      assert.match(ziel, /^[A-Za-z0-9_-]+$/, `the target ${ziel} is outside the provider's alphabet`);
    }
  });

  it("routes an event back by kind AND row rather than by the kind alone", () => {
    assert.deepEqual(zielZustellungTags(auftrag), { ziel: "schiedsrichter", ziel_id: ZIEL_ID, anlass: "eingang" });
  });

  /* The key collapses a repeat inside the provider's 24-hour window, so it has to be the same string
     for two sends of one day and a different one the next. */
  it("mints one idempotency key per message per day", () => {
    const today = zielIdempotenzSchluessel(auftrag, "2026-09-08");

    assert.equal(zielIdempotenzSchluessel(auftrag, "2026-09-08"), today);
    assert.notEqual(zielIdempotenzSchluessel(auftrag, "2026-09-09"), today);
    assert.ok(today.length <= 256, "the provider refuses a key over 256 characters");
  });

  it("mints a different key for two rows of one kind", () => {
    const other = { ...auftrag, zielId: `${"d".repeat(23)}4` };

    assert.notEqual(zielIdempotenzSchluessel(auftrag, "2026-09-08"), zielIdempotenzSchluessel(other, "2026-09-08"));
  });
});

describe("one fan-out about a record", () => {
  it("tags every message with the record it is about", async () => {
    await sendZielMail({ operation: "schiedsrichter.einladung", auftrag: auftrag, recipients: [ADDRESS], buildMail: buildMail });

    assert.deepEqual(sent[0]?.tags, { ziel: "schiedsrichter", ziel_id: ZIEL_ID, anlass: "eingang" });
  });

  /* A key reused over a CHANGED body is refused rather than ignored, so a message carrying a freshly
     minted token must go without one — and a caller that names no day is asking for that. */
  it("carries no idempotency key where the caller named no day", async () => {
    await sendZielMail({ operation: "schiedsrichter.einladung", auftrag: auftrag, recipients: [ADDRESS], buildMail: buildMail });

    assert.equal(sent[0]?.idempotencyKey, undefined);

    await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: { ...auftrag, idempotenzTag: "2026-09-08" },
      recipients: [ADDRESS],
      buildMail: buildMail,
    });

    assert.equal(sent[1]?.idempotencyKey, zielIdempotenzSchluessel(auftrag, "2026-09-08"));
  });

  it("records the accepted send under the id the provider answered with", async () => {
    const { delivered, unreachable } = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual([delivered, unreachable], [[ADDRESS], []]);
    assert.equal(gemeldet.length, 1);
    assert.equal(gemeldet[0]?.["ziel"], "schiedsrichter");
    assert.equal(gemeldet[0]?.["ziel_id"], ZIEL_ID);
    assert.equal(gemeldet[0]?.["nachricht_id"], recorders.__flZielAcceptedId);
  });

  /* Discarded, a `false` reads exactly like a recorded send, and it is what an operator needs to
     see when a whole slice's accepted sends are landing nowhere. */
  it("writes one line where the backend applied the accepted send to no record", async () => {
    recorders.__flZielAngewendet = false;

    const { delivered } = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual(delivered, [ADDRESS], "the message went, whatever the record did");
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.meta["error_code"], "FE-MAIL-006");
    assert.equal(logged[0]?.meta["ziel"], "schiedsrichter");
    assert.equal(logged[0]?.meta["operation"], "schiedsrichter.einladung");
    assert.ok(!inspect(logged, { depth: null }).includes(ADDRESS), "an address reached the stream");
  });

  it("writes no such line where the record was written", async () => {
    await sendZielMail({ operation: "schiedsrichter.einladung", auftrag: auftrag, recipients: [ADDRESS], buildMail: buildMail });

    assert.deepEqual(logged, []);
  });

  /* An answer carrying no id joins nothing, so recording a state against it would mark the record
     delivered on the strength of the request alone. */
  it("records nothing where the provider accepted without an id", async () => {
    recorders.__flZielAcceptedId = null;

    const { delivered } = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual(delivered, [ADDRESS]);
    assert.deepEqual(gemeldet, []);
  });

  /* The deployment that does not mail throws `MailWithheldError` at every send, and a fan-out that
     let the throw escape would report a decision it wrote as one it did not. */
  it("settles every address, so one refusal does not cost the others their message", async () => {
    refused.add(ADDRESS);

    const { delivered, unreachable } = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS, SECOND_ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual([delivered, unreachable], [[SECOND_ADDRESS], [ADDRESS]]);
    assert.equal(gemeldet.length, 1, "a refused message was recorded as accepted");
  });

  /* Outside production every address is withheld, and a caller reading that as a refusal reports one
     on every local submission — while an address the provider itself rejected is one it may report. */
  it("marks a withheld send withheld, and leaves a rejected address out of that list", async () => {
    withheld.add(ADDRESS);
    unconvertible.add(SECOND_ADDRESS);

    const settled = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS, SECOND_ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual(settled.delivered, []);
    assert.deepEqual(
      [...settled.unreachable].sort(),
      [ADDRESS, SECOND_ADDRESS].sort(),
      "an address that failed is missing from the whole list",
    );
    assert.deepEqual(settled.withheld, [ADDRESS]);
  });

  /* The message HAS gone, so a caller told otherwise would report a send that happened as one that
     did not — and the record is the half that can be repaired by the next send. */
  it("keeps a delivered address delivered when the record could not be written", async () => {
    recorders.__flZielMeldungFails = true;

    const { delivered, unreachable } = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual([delivered, unreachable], [[ADDRESS], []]);
    assert.equal(logged.at(-1)?.meta["error_code"], "FE-MAIL-003");
  });

  /* A send refused at submit time mints no message, so nothing else ever tells the clocks about that
     address: unrecorded, the reminder chases it and the deadline erases the row as though the link
     had been read. */
  it("records the provider's refusal against the record the message was about", async () => {
    tokenRefused.set(ADDRESS, { token: "invalid_parameter", status: 422 });

    const { unreachable } = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual(unreachable, [ADDRESS]);
    assert.equal(abgewiesen.length, 1);
    assert.equal(abgewiesen[0]?.["ziel"], "schiedsrichter");
    assert.equal(abgewiesen[0]?.["ziel_id"], ZIEL_ID);
    assert.equal(abgewiesen[0]?.["grund"], "invalid_parameter", "the provider's own token is what the record is worth reading for");
    assert.ok(!Number.isNaN(Date.parse(String(abgewiesen[0]?.["am"]))), "the stamp orders this refusal against the record's own state");
    assert.deepEqual(gemeldet, [], "a refused message was recorded as accepted");
  });

  /* Outside production every send is withheld, and a stack that marked those addresses unreachable
     would stamp a whole season's registrations undeliverable on a developer's machine. */
  it("records nothing for a send this deployment withheld", async () => {
    withheld.add(ADDRESS);

    await sendZielMail({ operation: "schiedsrichter.einladung", auftrag: auftrag, recipients: [ADDRESS], buildMail: buildMail });

    assert.deepEqual(abgewiesen, []);
  });

  /* A refusal a retry could land is no fact about the mailbox, and the person's one reminder is what
     carries a link whose first send fell over. */
  it("records nothing where a retry could still land the message", async () => {
    tokenRefused.set(ADDRESS, { status: 429 });

    await sendZielMail({ operation: "schiedsrichter.einladung", auftrag: auftrag, recipients: [ADDRESS], buildMail: buildMail });

    assert.deepEqual(abgewiesen, []);
  });

  /* An address whose domain has no ASCII form is refused before any request goes out, and no later
     send can reach it either. */
  it("records a refusal the provider was never asked about", async () => {
    unconvertible.add(ADDRESS);

    await sendZielMail({ operation: "schiedsrichter.einladung", auftrag: auftrag, recipients: [ADDRESS], buildMail: buildMail });

    assert.equal(abgewiesen.length, 1);
    assert.equal(abgewiesen[0]?.["grund"], "MailRecipientError");
  });

  /* The token is the provider's own JSON, and one past the endpoint's screen would be answered 422 —
     losing the whole record over the word that explains it. */
  it("drops a token the endpoint would refuse rather than the refusal itself", async () => {
    tokenRefused.set(ADDRESS, { token: "MailboxFull\nBcc: someone@example.com", status: 422 });

    await sendZielMail({ operation: "schiedsrichter.einladung", auftrag: auftrag, recipients: [ADDRESS], buildMail: buildMail });

    assert.equal(abgewiesen.length, 1);
    assert.equal(abgewiesen[0]?.["grund"], null);
  });

  /* The fan-out's answer is what the person's page is written from, and it stands whatever became of
     the record — which the next send repairs. */
  it("keeps the fan-out's answer when the refusal could not be recorded", async () => {
    tokenRefused.set(ADDRESS, { token: "invalid_parameter", status: 422 });
    recorders.__flZielAbweisungFails = true;

    const { delivered, unreachable } = await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS],
      buildMail: buildMail,
    });

    assert.deepEqual([delivered, unreachable], [[], [ADDRESS]]);
    assert.equal(logged.at(-1)?.meta["error_code"], "FE-MAIL-003");
  });

  /* `docs/logging/spec.md :: L9`. Asserted over the whole call, the error argument included, so a
     recipient cannot reach the stream through a serialised stack. */
  it("names no recipient on any line it writes", async () => {
    refused.add(ADDRESS);
    recorders.__flZielMeldungFails = true;

    await sendZielMail({
      operation: "schiedsrichter.einladung",
      auftrag: auftrag,
      recipients: [ADDRESS, SECOND_ADDRESS],
      buildMail: buildMail,
    });

    assert.ok(logged.length >= 2, `expected a line for the refusal and for the unwritten record, saw ${String(logged.length)}`);
    const written = inspect(logged, { depth: null });
    assert.ok(!written.includes(ADDRESS), "an address reached the stream");
    assert.ok(!written.includes(SECOND_ADDRESS), "an address reached the stream");
    for (const line of logged) assert.ok(String(line.meta["error_code"]).startsWith("FE-MAIL-"), "a line carried no mail error code");
  });
});
