import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";
import { inspect } from "node:util";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const recorders = globalThis as unknown as Record<string, unknown>;

/**
 * Its own throwaway, minted per run and never a real one: this file signs the fixtures it verifies,
 * so nothing outside the process has to agree with it.
 */
recorders.__flWebhookSecret = `whsec_${randomBytes(24).toString("base64")}`;

// A getter, so the double reads the value above rather than a copy taken at module evaluation.
const CONFIG_DOUBLE = `export const frontend_config = {
  get RESEND_WEBHOOK_SECRET() { return globalThis.__flWebhookSecret; },
};`;

const LOG_RECORDER = "__flZustellungLogs";

const LOGGER_DOUBLE = `export const logger = {
  info: (message, meta) => globalThis.${LOG_RECORDER}.push({ level: "info", message, meta }),
  warn: (message, meta) => globalThis.${LOG_RECORDER}.push({ level: "warn", message, meta }),
  error: (message, error, meta) => globalThis.${LOG_RECORDER}.push({ level: "error", message, error, meta }),
};`;

// Replaced at the module boundary rather than the route being reshaped to admit a seam: the real
// client reaches a backend no test process runs.
const MUTATIONS_DOUBLE = `export const meldeZustellEreignis = async (payload) => {
  globalThis.__flZustellungCalls.push(payload);
  return globalThis.__flZustellungAnswer(payload);
};`;

// Its own recorder rather than the one above: a shared array would let a case asserting the
// application was reached pass on a call the route made to the other endpoint.
const ZIEL_MUTATIONS_DOUBLE = `export const meldeZielZustellEreignis = async (payload) => {
  globalThis.__flZielZustellungCalls.push(payload);
  return globalThis.__flZielZustellungAnswer(payload);
};`;

// `next/headers` is request-only and throws outside one, so the real scope cannot run here.
const TRACE_DOUBLE = `export const runWithIncomingTrace = async (fn) => fn();`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    // Node resolves the package's subpath only with its extension; Next's own bundler needs none.
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGER_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/features/bewerbungen/mutations.ts")) return { format: "module", source: MUTATIONS_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/features/zustellung/mutations.ts")) return { format: "module", source: ZIEL_MUTATIONS_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/shared/utils/traceScope.ts")) return { format: "module", source: TRACE_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

type LoggedLine = { level: string; message: string; error?: unknown; meta?: Record<string, unknown> };

const logs: LoggedLine[] = [];
recorders[LOG_RECORDER] = logs;

const calls: Record<string, unknown>[] = [];
recorders.__flZustellungCalls = calls;
recorders.__flZustellungAnswer = () => ({ acknowledged: 1, angewendet: ["ansprechperson"] });

const zielCalls: Record<string, unknown>[] = [];
recorders.__flZielZustellungCalls = zielCalls;
recorders.__flZielZustellungAnswer = () => ({ acknowledged: 1, angewendet: true });

const {
  hatUnerreichbarenSitz,
  istDauerhaftUnzustellbar,
  leseZustellEreignis,
  ZUSTELLUNG_CHIP,
  ZUSTELLUNG_QUEUE_LABEL,
  ZUSTELLUNG_QUEUE_TINT,
  zustellungIdempotenzSchluessel,
  zustellungTags,
} = await import("./zustellung.ts");
const { APIBadStatusError, APINetworkError } = await import("@/core/errors.ts");
const { POST } = await import("@/app/api/mail/zustellung/route.ts");
const { NextRequest } = await import("next/server");
const { Webhook } = await import("svix");

/**
 * The application arm of one read, or `undefined` where the event is about another kind of record.
 * Every case below this line tags a `bewerbung_id` and no `ziel`, so `undefined` is a failure.
 */
function bewerbungsMeldung(raw: unknown) {
  const gelesen = leseZustellEreignis(raw);

  return gelesen === null || gelesen.ziel !== "bewerbung" ? undefined : gelesen.meldung;
}

/** An application id as `CustomObjectIdStringSchema` demands it: 24 hex characters and nothing else. */
const BEWERBUNG_ID = `${"a".repeat(23)}1`;

/** A row of one of the kinds `@/features/zustellung/schemas :: FLZustellungZielSchema` admits. */
const ZIEL_ID = `${"c".repeat(23)}3`;
const MESSAGE_ID = "56761188-7520-42d8-8898-ff6fc54ce618";
const ADDRESS = "erika@schule.de";

/** The envelope's own instant, which orders events; `data.created_at` is the message's and repeats. */
const EVENT_AT = "2026-09-08T10:15:00.000Z";
const MESSAGE_AT = "2026-09-08T10:14:59.000Z";

function eventFor(type: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: type,
    created_at: EVENT_AT,
    data: {
      email_id: MESSAGE_ID,
      created_at: MESSAGE_AT,
      to: [ADDRESS],
      subject: "Bitte bestätige Deine Angaben",
      tags: { bewerbung_id: BEWERBUNG_ID, rollen: "ansprechperson", anlass: "eingang" },
      ...data,
    },
  };
}

/** One signed request, exactly as the provider sends it: the signature is over the bytes in the body. */
function signed(payload: string, { alter = 0, headers = {} }: { alter?: number; headers?: Record<string, string> } = {}) {
  const stamp = new Date(Date.now() - alter);
  const id = "msg_2xyzABC";
  const signature = new Webhook(String(recorders.__flWebhookSecret)).sign(id, stamp, payload);

  return new NextRequest("http://localhost/api/mail/zustellung", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(stamp.getTime() / 1000)),
      "svix-signature": signature,
      ...headers,
    },
    body: payload,
  });
}

async function answerTo(request: InstanceType<typeof NextRequest>): Promise<{ status: number; body: unknown }> {
  const res = await POST(request);

  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  logs.length = 0;
  calls.length = 0;
  zielCalls.length = 0;
  recorders.__flZustellungAnswer = () => ({ acknowledged: 1, angewendet: ["ansprechperson"] });
  recorders.__flZielZustellungAnswer = () => ({ acknowledged: 1, angewendet: true });
});

describe("what one delivery event says about a seat", () => {
  /* First, so a fixture that stopped matching the mapping fails here rather than under every route
     case below. Each pair is the provider's own event name against this side's stored word. */
  it("reads every subscribed event as the state it leaves", () => {
    const readBack = [
      ["email.delivered", {}],
      ["email.bounced", { bounce: { type: "Permanent", subType: "Suppressed" } }],
      ["email.suppressed", { suppressed: { type: "OnAccountSuppressionList" } }],
      ["email.complained", {}],
      ["email.delivery_delayed", {}],
      ["email.failed", { failed: { reason: "reached_daily_quota" } }],
    ].map(([type, data]) => bewerbungsMeldung(eventFor(String(type), data as Record<string, unknown>))?.stand);

    assert.deepEqual(readBack, ["zugestellt", "unzustellbar", "unterdrueckt", "beschwerde", "verzoegert", "verzoegert"]);
  });

  /* A full mailbox and a greylisting server both bounce Temporary. Reading one as permanent stops
     the reminder clock and holds the application over a mailbox that empties by itself. */
  it("reads a temporary bounce as trouble rather than as a refusal for good", () => {
    const provisional = bewerbungsMeldung(eventFor("email.bounced", { bounce: { type: "Temporary", subType: "MailboxFull" } }));

    assert.equal(provisional?.stand, "verzoegert");
    assert.equal(istDauerhaftUnzustellbar(provisional === undefined ? null : { stand: provisional.stand }), false);
  });

  /* The reason the provider documents for this event is the league's own daily quota, which says
     nothing about the address: a permanent state here would spend the seat's one chase on us. */
  it("does not read a failed send as an address that refuses", () => {
    const failedSend = bewerbungsMeldung(eventFor("email.failed", { failed: { reason: "reached_daily_quota" } }));

    assert.equal(istDauerhaftUnzustellbar(failedSend === undefined ? null : { stand: failedSend.stand }), false);
    assert.equal(failedSend?.grund, "reached_daily_quota");
  });

  it("takes the provider's own token as the reason, never its prose", () => {
    const turnedAway = bewerbungsMeldung(
      eventFor("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed", message: `No mailbox for ${ADDRESS}` } }),
    );

    assert.equal(turnedAway?.grund, "Suppressed");
    assert.ok(!inspect(turnedAway, { depth: null }).includes(ADDRESS), "the recipient reached the write");
  });

  /* The endpoint bounds the reason and holds it to one line, and
     `fl_frontend/src/app/api/mail/zustellung/route.ts` answers its 422 with a 200 — so a reason
     passed on unbounded is a bounce recorded nowhere. */
  it("keeps the state and drops a reason the endpoint would refuse", () => {
    const prose = bewerbungsMeldung(eventFor("email.failed", { failed: { reason: "Q".repeat(129) } }));
    const multiLine = bewerbungsMeldung(eventFor("email.failed", { failed: { reason: "quota\nexceeded" } }));

    assert.equal(prose?.stand, "verzoegert");
    assert.equal(prose?.grund, null);
    assert.equal(multiLine?.grund, null);
    assert.equal(bewerbungsMeldung(eventFor("email.failed", { failed: { reason: "Q".repeat(128) } }))?.grund, "Q".repeat(128));
  });

  /* Neither is repairable the way a reason is: the message id is what tells a superseded link apart,
     and the instant is the whole of the ordering between two events about one message. */
  it("says nothing where the message id or the instant is one the endpoint refuses", () => {
    const longFraction = `2026-09-08T10:15:00.${"0".repeat(50)}Z`;

    assert.equal(leseZustellEreignis(eventFor("email.delivered", { email_id: "x".repeat(129) })), null);
    assert.equal(leseZustellEreignis(eventFor("email.delivered", { email_id: "" })), null);
    assert.equal(leseZustellEreignis({ ...eventFor("email.delivered"), created_at: "2026-09-08T10:15:00" }), null);
    assert.equal(leseZustellEreignis({ ...eventFor("email.delivered"), created_at: "2026-09-08" }), null);
    assert.equal(leseZustellEreignis({ ...eventFor("email.delivered"), created_at: longFraction }), null);
  });

  /* `datetime.fromisoformat` reads more offset spellings than one UTC `Z`, and refusing the others
     here would drop an event the endpoint takes. */
  it("takes an offset the provider spells as hours and minutes", () => {
    const shifted = bewerbungsMeldung({ ...eventFor("email.delivered"), created_at: "2026-09-08T12:15:00+02:00" });

    assert.equal(shifted?.am, "2026-09-08T12:15:00+02:00");
  });

  it("says nothing about a seat for an event no state is stored for", () => {
    assert.equal(leseZustellEreignis(eventFor("email.sent")), null);
    assert.equal(leseZustellEreignis(eventFor("email.opened")), null);
    assert.equal(leseZustellEreignis(eventFor("contact.created")), null);
  });

  /* The sign-in link is the untagged case, and it has no record to hang a state on. */
  it("says nothing for a message this application did not tag", () => {
    assert.equal(leseZustellEreignis(eventFor("email.delivered", { tags: undefined })), null);
    assert.equal(leseZustellEreignis(eventFor("email.delivered", { tags: { anlass: "eingang" } })), null);
  });

  it("refuses a tag block naming something other than an application and its seats", () => {
    assert.equal(leseZustellEreignis(eventFor("email.delivered", { tags: { bewerbung_id: "nicht-hex", rollen: "trainer" } })), null);
    assert.equal(leseZustellEreignis(eventFor("email.delivered", { tags: { bewerbung_id: BEWERBUNG_ID, rollen: "hausmeister" } })), null);
  });

  /* The guard against a superseded message: a re-send mints a new one, and the backend applies an
     event only where this id is still the seat's. Dropping it here would grade the fresh link. */
  it("carries the event's own message id, which is what tells a superseded message apart", () => {
    assert.equal(bewerbungsMeldung(eventFor("email.delivered"))?.nachricht_id, MESSAGE_ID);
  });

  /* `data.created_at` is when the MESSAGE was made and repeats on every event about it, so ordering
     on it would make a bounce and the delivery after it indistinguishable. */
  it("orders on the envelope's instant rather than the message's", () => {
    assert.equal(bewerbungsMeldung(eventFor("email.delivered"))?.am, EVENT_AT);
  });

  it("names every seat one message covered, so a mirrored pair moves together", () => {
    const pairedSeat = bewerbungsMeldung(eventFor("email.bounced", { tags: { bewerbung_id: BEWERBUNG_ID, rollen: "ansprechperson-trainer" } }));

    assert.deepEqual(pairedSeat?.rollen, ["ansprechperson", "trainer"]);
  });
});

describe("which record one event names", () => {
  const zielEvent = (tags: Record<string, string>) =>
    eventFor("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed" }, tags: tags });

  /* The application flow tags no `ziel` at all, and every message it has ever sent is untagged that
     way: reading the absence as anything but its own flow would strand every one of them. */
  it("reads a message carrying no target as the application's own", () => {
    const gelesen = leseZustellEreignis(eventFor("email.delivered"));

    assert.equal(gelesen?.ziel, "bewerbung");
  });

  it("reads a tagged target as the record that target names", () => {
    const gelesen = leseZustellEreignis(zielEvent({ ziel: "schiedsrichter", ziel_id: ZIEL_ID, anlass: "eingang" }));

    assert.equal(gelesen?.ziel, "schiedsrichter");
    assert.deepEqual(gelesen?.meldung, {
      ziel: "schiedsrichter",
      ziel_id: ZIEL_ID,
      nachricht_id: MESSAGE_ID,
      stand: "unzustellbar",
      grund: "Suppressed",
      am: EVENT_AT,
    });
  });

  /* Read as `null` this is dropped exactly as the untagged sign-in mail is, and a slice's bounces
     go unrecorded in silence. */
  it("marks a target naming no row as unplaceable rather than as nothing", () => {
    const ohneId = leseZustellEreignis(zielEvent({ ziel: "schiedsrichter", anlass: "eingang" }));
    const unlesbar = leseZustellEreignis(zielEvent({ ziel: "schiedsrichter", ziel_id: "nicht-hex", anlass: "eingang" }));

    assert.deepEqual(ohneId, { ziel: "unplatzierbar", grund: "ziel_id_unlesbar", art: "schiedsrichter" });
    assert.deepEqual(unlesbar, { ziel: "unplatzierbar", grund: "ziel_id_unlesbar", art: "schiedsrichter" });
  });

  /* The tag is a value the provider echoes back from whatever it was handed, so a kind that failed
     the set is attacker-shaped text and never leaves here. */
  it("marks a kind this side has no home for as unplaceable, and names no kind", () => {
    // „bewerbung“ among them because an application's event is placed by its own id rather than by
    // this tag, so the kind reading like the one this file is about is exactly the one refused here.
    for (const ziel of ["bewerbung", "spieler", "<script>"]) {
      assert.deepEqual(
        leseZustellEreignis(zielEvent({ ziel: ziel, ziel_id: ZIEL_ID, anlass: "eingang" })),
        { ziel: "unplatzierbar", grund: "ziel_unbekannt", art: null },
        `${ziel} was placed`,
      );
    }
  });

  /* `ziel` wins: reading the pair as an application's event would write another record's bounce
     onto an application that happens to share the id. */
  it("lets the target tag win where a message carries both", () => {
    const gelesen = leseZustellEreignis(
      zielEvent({ ziel: "schiedsrichter", ziel_id: ZIEL_ID, bewerbung_id: BEWERBUNG_ID, rollen: "ansprechperson", anlass: "eingang" }),
    );

    assert.equal(gelesen?.ziel, "schiedsrichter");
  });
});

describe("the tags one message rides out with", () => {
  const delivery = { bewerbungId: BEWERBUNG_ID, rollen: ["ansprechperson", "trainer"] as const, anlass: "erinnerung" as const };

  /* The provider refuses a tag outside this alphabet with a 422, which reaches the fan-out as a
     message nobody got and no state anywhere. */
  it("keeps every name and value inside the alphabet the provider admits", () => {
    for (const [name, value] of Object.entries(zustellungTags(delivery))) {
      assert.match(name, /^[A-Za-z0-9_-]+$/, `the tag name ${name} is outside the provider's alphabet`);
      assert.match(value, /^[A-Za-z0-9_-]+$/, `the value of ${name} is outside the provider's alphabet`);
    }
  });

  it("routes an event back by application and seat rather than by the message alone", () => {
    assert.deepEqual(zustellungTags(delivery), { bewerbung_id: BEWERBUNG_ID, rollen: "ansprechperson-trainer", anlass: "erinnerung" });
  });

  /* The key collapses a repeat inside the provider's 24-hour window, so it has to be the same string
     for two sends of one day and a different one the next. */
  it("mints one idempotency key per message per day", () => {
    const today2 = zustellungIdempotenzSchluessel(delivery, "2026-09-08");

    assert.equal(zustellungIdempotenzSchluessel(delivery, "2026-09-08"), today2);
    assert.notEqual(zustellungIdempotenzSchluessel(delivery, "2026-09-09"), today2);
    assert.ok(today2.length <= 256, "the provider refuses a key over 256 characters");
  });
});

describe("an application holding a seat no message reaches", () => {
  const trail = (stand: string | null) => ({
    verschickt_am: "2026-09-01",
    erinnert_am: null,
    abgelehnt_am: null,
    zustellung: stand === null ? null : { nachricht_id: MESSAGE_ID, stand: stand, grund: null, am: EVENT_AT },
  });

  it("is marked for any of the three states no further message beats", () => {
    for (const stand of ["unzustellbar", "unterdrueckt", "beschwerde"]) {
      assert.equal(
        hatUnerreichbarenSitz({ bestaetigungen: { ansprechperson: trail(stand), stellvertretung: null, trainer: null } } as never),
        true,
        `${stand} left the row unmarked`,
      );
    }
  });

  it("is not marked while the trouble can still clear, or before anything is known", () => {
    for (const stand of ["angenommen", "zugestellt", "verzoegert", null]) {
      assert.equal(
        hatUnerreichbarenSitz({ bestaetigungen: { ansprechperson: trail(stand), stellvertretung: null, trainer: null } } as never),
        false,
        `${String(stand)} marked the row`,
      );
    }
  });

  /* An application stored before this block shipped carries no `bestaetigungen` at all, and reading
     that as an unreachable seat would mark every one of them. */
  it("is not marked on an application from before the confirmation workflow", () => {
    assert.equal(hatUnerreichbarenSitz({ bestaetigungen: null }), false);
  });

  /* `danger` where the duplicate mark is `warning`: a colliding pair is waited out and an address
     refused for good is not. Never grey (`fl_frontend/src/shared/components/ui/badges.ts :: PillTone`). */
  it("is marked in the queue's own words, at a tone a reader can act on", () => {
    assert.equal(ZUSTELLUNG_QUEUE_TINT, "danger");
    assert.equal(ZUSTELLUNG_QUEUE_LABEL, "Kontakt unerreichbar");
  });
});

describe("what a seat's row says about the last message to it", () => {
  /* An accepted send and a delivery are the ordinary course, and a chip for them would grade every
     row on the page. Every other state has one, or a refusal renders as nothing at all. */
  it("shows a chip for every state but the two that are the ordinary course", () => {
    const withoutChip = Object.entries(ZUSTELLUNG_CHIP)
      .filter(([, chip]) => chip === null)
      .map(([stand]) => stand);

    assert.deepEqual(withoutChip, ["angenommen", "zugestellt"]);
    assert.equal(Object.values(ZUSTELLUNG_CHIP).filter((chip) => chip !== null).length, 4);
  });

  /* The ban list's verb names an act on an address; this chip names a message the provider refused,
     so an administrator meeting „gesperrt“ here would look the address up in a Sperrliste that
     never held it. */
  it("names the provider's suppression as the message's fate rather than in the ban list's verb", () => {
    assert.equal(ZUSTELLUNG_CHIP.unterdrueckt?.label, "Zustellung blockiert");

    for (const chip of Object.values(ZUSTELLUNG_CHIP)) {
      assert.doesNotMatch(chip?.label ?? "", /gesperrt/i, `a chip wears the ban list's verb: ${chip?.label ?? ""}`);
    }
  });

  /* One label for the temporary bounce and the failed send both, because neither is the address
     refusing for good and the administrator can act on neither differently. */
  it("grades the trouble that can still clear apart from the three that cannot", () => {
    assert.equal(ZUSTELLUNG_CHIP.verzoegert?.tone, "warning");

    for (const stand of ["unzustellbar", "unterdrueckt", "beschwerde"] as const) {
      assert.equal(ZUSTELLUNG_CHIP[stand]?.tone, "danger", `${stand} is graded as trouble that clears`);
    }
  });
});

describe("POST /api/mail/zustellung", () => {
  it("applies a correctly signed event and answers 200", async () => {
    const { status, body } = await answerTo(signed(JSON.stringify(eventFor("email.bounced", { bounce: { type: "Permanent" } }))));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: ["ansprechperson"] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.["stand"], "unzustellbar");
    assert.equal(calls[0]?.["bewerbung_id"], BEWERBUNG_ID);
    assert.deepEqual(zielCalls, [], "an untagged event reached the generic endpoint");
  });

  /* The two endpoints judge one provider's message against two different records, so a misrouted
     event writes nothing and is answered 200 — the silence section 4 of the plan calls the risk. */
  it("sends a tagged event to the generic endpoint and leaves the application's alone", async () => {
    const tagged = eventFor("email.bounced", {
      bounce: { type: "Permanent", subType: "Suppressed" },
      tags: { ziel: "schiedsrichter", ziel_id: ZIEL_ID, anlass: "eingang" },
    });

    const { status, body } = await answerTo(signed(JSON.stringify(tagged)));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: true });
    assert.deepEqual(calls, [], "a tagged event reached the application's endpoint");
    assert.equal(zielCalls[0]?.["ziel_id"], ZIEL_ID);
    assert.equal(zielCalls[0]?.["stand"], "unzustellbar");
  });

  /* 200 because no retry repairs it, and a LINE because the alternative is a drop indistinguishable
     from an untagged message's and from the endpoint being disabled altogether. */
  it("answers 200 and writes one line for a tagged event it cannot place", async () => {
    const unplatzierbar = eventFor("email.delivered", { tags: { ziel: "schiedsrichter", anlass: "eingang" } });

    const { status, body } = await answerTo(signed(JSON.stringify(unplatzierbar)));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: [] });
    assert.deepEqual(calls, []);
    assert.deepEqual(zielCalls, []);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.meta?.["error_code"], "FE-MAIL-006");
    assert.equal(logs[0]?.meta?.["grund"], "ziel_id_unlesbar");
    assert.equal(logs[0]?.meta?.["ziel"], "schiedsrichter");
  });

  /* The tag is a value the provider echoes back from whatever it was handed, so a kind outside the
     set is attacker-shaped text: the line says a kind failed and quotes none of it. */
  it("names no kind on the line where the kind itself was outside the set", async () => {
    const fremd = eventFor("email.delivered", { tags: { ziel: "<script>", ziel_id: ZIEL_ID, anlass: "eingang" } });

    const { status } = await answerTo(signed(JSON.stringify(fremd)));

    assert.equal(status, 200);
    assert.equal(logs[0]?.meta?.["grund"], "ziel_unbekannt");
    assert.equal(logs[0]?.meta?.["ziel"], undefined);
    assert.ok(!inspect(logs, { depth: null }).includes("<script>"), "the reported kind reached the stream");
  });

  /* The sign-in link is the one credential an administrator has no second route to: a mailbox that
     refuses it locks them out, and before the tag rode the send there was nothing to see at all. */
  it("writes one line for a sign-in link that did not arrive, naming neither the address nor a record", async () => {
    const anmeldung = eventFor("email.bounced", {
      bounce: { type: "Permanent", subType: "Suppressed" },
      subject: "Anmeldelink für die Frankfurt League",
      tags: { anmeldung: "link" },
    });

    const { status, body } = await answerTo(signed(JSON.stringify(anmeldung)));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: [] });
    assert.deepEqual(calls, [], "the sign-in lane reached the application's endpoint");
    assert.deepEqual(zielCalls, [], "the sign-in lane reached the generic endpoint");

    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.level, "warn");
    assert.equal(logs[0]?.meta?.["error_code"], "FE-MAIL-007");
    assert.equal(logs[0]?.meta?.["stand"], "unzustellbar");
    assert.equal(logs[0]?.meta?.["nachricht_id"], MESSAGE_ID);
    assert.ok(!inspect(logs, { depth: null }).includes(ADDRESS), "the recipient reached the stream");
  });

  /* The ordinary course, and the arm that decides whether the line above is a signal: a lane
     logging every event would bury the one an operator has to act on. */
  it("writes nothing for a sign-in link that was delivered", async () => {
    const anmeldung = eventFor("email.delivered", { tags: { anmeldung: "link" } });

    const { status, body } = await answerTo(signed(JSON.stringify(anmeldung)));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: [] });
    assert.deepEqual(logs, []);
  });

  it("answers 200 where the backend applied the tagged event to no record", async () => {
    recorders.__flZielZustellungAnswer = () => ({ acknowledged: 1, angewendet: false });

    const tagged = eventFor("email.delivered", { tags: { ziel: "schiedsrichter", ziel_id: ZIEL_ID, anlass: "eingang" } });

    const { status, body } = await answerTo(signed(JSON.stringify(tagged)));

    assert.equal(status, 200, "a settled event was sent back for thirty-two hours of retries");
    assert.deepEqual(body, { angewendet: false });
  });

  /* 400 and not 503: a forgery is not worth the provider's thirty-two hours of retries, and the
     schedule ends with the endpoint disabled for every real event too. */
  it("answers 400 for a body changed after it was signed", async () => {
    const genuine = JSON.stringify(eventFor("email.delivered"));
    const forged = genuine.replace(BEWERBUNG_ID, `${"b".repeat(23)}2`);
    const request = signed(genuine);

    const { status } = await answerTo(
      new NextRequest("http://localhost/api/mail/zustellung", { method: "POST", headers: request.headers, body: forged }),
    );

    assert.equal(status, 400);
    assert.deepEqual(calls, []);
  });

  it("answers 400 for a signature that is not this secret's", async () => {
    const foreignId = new Webhook(`whsec_${randomBytes(24).toString("base64")}`).sign(
      "msg_2xyzABC",
      new Date(),
      JSON.stringify(eventFor("email.delivered")),
    );

    const { status } = await answerTo(signed(JSON.stringify(eventFor("email.delivered")), { headers: { "svix-signature": foreignId } }));

    assert.equal(status, 400);
    assert.deepEqual(calls, []);
  });

  it("answers 400 with any one of the three signing headers missing", async () => {
    for (const missingField of ["svix-id", "svix-timestamp", "svix-signature"]) {
      const { status } = await answerTo(signed(JSON.stringify(eventFor("email.delivered")), { headers: { [missingField]: "" } }));

      assert.equal(status, 400, `a request without ${missingField} was accepted`);
    }

    assert.deepEqual(calls, []);
  });

  /* The verifier's own tolerance is five minutes either way, read from the installed
     `standardwebhooks` module's `WEBHOOK_TOLERANCE_IN_SECONDS` and stated by no vendor page. A
     replay of a captured request stops working after it. */
  it("answers 400 for a signature older than the verifier's tolerance", async () => {
    const justUnder = await answerTo(signed(JSON.stringify(eventFor("email.delivered")), { alter: 4 * 60 * 1000 }));
    const tooOld = await answerTo(signed(JSON.stringify(eventFor("email.delivered")), { alter: 6 * 60 * 1000 }));

    assert.equal(justUnder.status, 200, "a signature inside the tolerance was refused");
    assert.equal(tooOld.status, 400);
  });

  it("answers 200 and writes nothing for a message this application never tagged", async () => {
    const { status, body } = await answerTo(signed(JSON.stringify(eventFor("email.delivered", { tags: undefined }))));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: [] });
    assert.deepEqual(calls, []);
  });

  it("answers 200 where the backend applied the event to no seat", async () => {
    recorders.__flZustellungAnswer = () => ({ acknowledged: 1, angewendet: [] });

    const { status, body } = await answerTo(signed(JSON.stringify(eventFor("email.delivered"))));

    assert.equal(status, 200, "a settled event was sent back for thirty-two hours of retries");
    assert.deepEqual(body, { angewendet: [] });
  });

  /* The retention sweep erases an application while its last message's events are still in flight.
     Retrying those spends the endpoint's standing with the provider on a record that is gone. */
  it("answers 200 where the application no longer exists", async () => {
    recorders.__flZustellungAnswer = () => {
      throw new APIBadStatusError({
        message: "API returned a bad status.",
        url: "http://backend:8000",
        statusCode: 404,
        endpoint: "/bewerbungen/zustellung",
        method: "POST",
        readOnly: false,
        traceId: "t".repeat(32),
      });
    };

    const { status } = await answerTo(signed(JSON.stringify(eventFor("email.delivered"))));

    assert.equal(status, 200);
  });

  /* The one case a retry repairs. A 200 here tells the provider the event is settled and the state
     is lost for good, which reads on the page exactly like a message that arrived. */
  it("answers 503 where the backend could not be reached", async () => {
    recorders.__flZustellungAnswer = () => {
      throw new APINetworkError({
        message: "Request failed.",
        url: "http://backend:8000",
        method: "POST",
        readOnly: false,
        traceId: "t".repeat(32),
        isTimeout: false,
      });
    };

    const { status, body } = await answerTo(signed(JSON.stringify(eventFor("email.delivered"))));

    assert.equal(status, 503);
    assert.deepEqual(body, { error: "backend" });
  });

  it("answers 503 where the backend answered a server error", async () => {
    recorders.__flZustellungAnswer = () => {
      throw new APIBadStatusError({
        message: "API returned a bad status.",
        url: "http://backend:8000",
        statusCode: 500,
        endpoint: "/bewerbungen/zustellung",
        method: "POST",
        readOnly: false,
        traceId: "t".repeat(32),
      });
    };

    assert.equal((await answerTo(signed(JSON.stringify(eventFor("email.delivered"))))).status, 503);
  });

  /* `docs/logging/spec.md :: L9`, and the tag block carries the application id besides. Asserted over
     the whole line, so a field added later cannot reopen it. */
  it("names no recipient and no application on any line it writes", async () => {
    recorders.__flZustellungAnswer = () => {
      throw new APINetworkError({
        message: "Request failed.",
        url: "http://backend:8000",
        method: "POST",
        readOnly: false,
        traceId: "t".repeat(32),
        isTimeout: false,
      });
    };

    await answerTo(signed(JSON.stringify(eventFor("email.bounced", { bounce: { type: "Permanent" } }))));
    await answerTo(signed(JSON.stringify(eventFor("email.delivered")), { headers: { "svix-signature": "v1,nope" } }));

    assert.ok(logs.length >= 2, `expected a line for each of the two failures, saw ${String(logs.length)}`);
    const written = inspect(logs, { depth: null });
    assert.ok(!written.includes(ADDRESS), "an address reached the stream");
    assert.ok(!written.includes(BEWERBUNG_ID), "an application id reached the stream");
    for (const line of logs) assert.equal(line.meta?.["error_code"], "FE-MAIL-003");
  });
});
