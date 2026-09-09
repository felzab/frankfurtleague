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

/** An application id as `CustomObjectIdStringSchema` demands it: 24 hex characters and nothing else. */
const BEWERBUNG_ID = `${"a".repeat(23)}1`;
const NACHRICHT_ID = "56761188-7520-42d8-8898-ff6fc54ce618";
const ADRESSE = "erika@schule.de";

/** The envelope's own instant, which orders events; `data.created_at` is the message's and repeats. */
const EREIGNIS_AM = "2026-09-08T10:15:00.000Z";
const NACHRICHT_AM = "2026-09-08T10:14:59.000Z";

function ereignis(type: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: type,
    created_at: EREIGNIS_AM,
    data: {
      email_id: NACHRICHT_ID,
      created_at: NACHRICHT_AM,
      to: [ADRESSE],
      subject: "Bitte bestätige Deine Angaben",
      tags: { bewerbung_id: BEWERBUNG_ID, rollen: "ansprechperson", anlass: "eingang" },
      ...data,
    },
  };
}

/** One signed request, exactly as the provider sends it: the signature is over the bytes in the body. */
function signiert(payload: string, { alter = 0, headers = {} }: { alter?: number; headers?: Record<string, string> } = {}) {
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

async function antwort(request: InstanceType<typeof NextRequest>): Promise<{ status: number; body: unknown }> {
  const res = await POST(request);

  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  logs.length = 0;
  calls.length = 0;
  recorders.__flZustellungAnswer = () => ({ acknowledged: 1, angewendet: ["ansprechperson"] });
});

describe("what one delivery event says about a seat", () => {
  /* First, so a fixture that stopped matching the mapping fails here rather than under every route
     case below. Each pair is the provider's own event name against this side's stored word. */
  it("reads every subscribed event as the state it leaves", () => {
    const gelesen = [
      ["email.delivered", {}],
      ["email.bounced", { bounce: { type: "Permanent", subType: "Suppressed" } }],
      ["email.suppressed", { suppressed: { type: "OnAccountSuppressionList" } }],
      ["email.complained", {}],
      ["email.delivery_delayed", {}],
      ["email.failed", { failed: { reason: "reached_daily_quota" } }],
    ].map(([type, data]) => leseZustellEreignis(ereignis(String(type), data as Record<string, unknown>))?.stand);

    assert.deepEqual(gelesen, ["zugestellt", "unzustellbar", "unterdrueckt", "beschwerde", "verzoegert", "verzoegert"]);
  });

  /* A full mailbox and a greylisting server both bounce Temporary. Reading one as permanent stops
     the reminder clock and holds the application over a mailbox that empties by itself. */
  it("reads a temporary bounce as trouble rather than as a refusal for good", () => {
    const vorlaeufig = leseZustellEreignis(ereignis("email.bounced", { bounce: { type: "Temporary", subType: "MailboxFull" } }));

    assert.equal(vorlaeufig?.stand, "verzoegert");
    assert.equal(istDauerhaftUnzustellbar(vorlaeufig === null ? null : { stand: vorlaeufig.stand }), false);
  });

  /* The reason the provider documents for this event is the league's own daily quota, which says
     nothing about the address: a permanent state here would spend the seat's one chase on us. */
  it("does not read a failed send as an address that refuses", () => {
    const gescheitert = leseZustellEreignis(ereignis("email.failed", { failed: { reason: "reached_daily_quota" } }));

    assert.equal(istDauerhaftUnzustellbar(gescheitert === null ? null : { stand: gescheitert.stand }), false);
    assert.equal(gescheitert?.grund, "reached_daily_quota");
  });

  it("takes the provider's own token as the reason, never its prose", () => {
    const abgewiesen = leseZustellEreignis(
      ereignis("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed", message: `No mailbox for ${ADRESSE}` } }),
    );

    assert.equal(abgewiesen?.grund, "Suppressed");
    assert.ok(!inspect(abgewiesen, { depth: null }).includes(ADRESSE), "the recipient reached the write");
  });

  /* The endpoint bounds the reason and holds it to one line, and
     `fl_frontend/src/app/api/mail/zustellung/route.ts` answers its 422 with a 200 — so a reason
     passed on unbounded is a bounce recorded nowhere. */
  it("keeps the state and drops a reason the endpoint would refuse", () => {
    const prosa = leseZustellEreignis(ereignis("email.failed", { failed: { reason: "Q".repeat(129) } }));
    const mehrzeilig = leseZustellEreignis(ereignis("email.failed", { failed: { reason: "quota\nexceeded" } }));

    assert.equal(prosa?.stand, "verzoegert");
    assert.equal(prosa?.grund, null);
    assert.equal(mehrzeilig?.grund, null);
    assert.equal(leseZustellEreignis(ereignis("email.failed", { failed: { reason: "Q".repeat(128) } }))?.grund, "Q".repeat(128));
  });

  /* Neither is repairable the way a reason is: the message id is what tells a superseded link apart,
     and the instant is the whole of the ordering between two events about one message. */
  it("says nothing where the message id or the instant is one the endpoint refuses", () => {
    const langeFraktion = `2026-09-08T10:15:00.${"0".repeat(50)}Z`;

    assert.equal(leseZustellEreignis(ereignis("email.delivered", { email_id: "x".repeat(129) })), null);
    assert.equal(leseZustellEreignis(ereignis("email.delivered", { email_id: "" })), null);
    assert.equal(leseZustellEreignis({ ...ereignis("email.delivered"), created_at: "2026-09-08T10:15:00" }), null);
    assert.equal(leseZustellEreignis({ ...ereignis("email.delivered"), created_at: "2026-09-08" }), null);
    assert.equal(leseZustellEreignis({ ...ereignis("email.delivered"), created_at: langeFraktion }), null);
  });

  /* `datetime.fromisoformat` reads more offset spellings than one UTC `Z`, and refusing the others
     here would drop an event the endpoint takes. */
  it("takes an offset the provider spells as hours and minutes", () => {
    const versetzt = leseZustellEreignis({ ...ereignis("email.delivered"), created_at: "2026-09-08T12:15:00+02:00" });

    assert.equal(versetzt?.am, "2026-09-08T12:15:00+02:00");
  });

  it("says nothing about a seat for an event no state is stored for", () => {
    assert.equal(leseZustellEreignis(ereignis("email.sent")), null);
    assert.equal(leseZustellEreignis(ereignis("email.opened")), null);
    assert.equal(leseZustellEreignis(ereignis("contact.created")), null);
  });

  /* The sign-in link is the untagged case, and it has no record to hang a state on. */
  it("says nothing for a message this application did not tag", () => {
    assert.equal(leseZustellEreignis(ereignis("email.delivered", { tags: undefined })), null);
    assert.equal(leseZustellEreignis(ereignis("email.delivered", { tags: { anlass: "eingang" } })), null);
  });

  it("refuses a tag block naming something other than an application and its seats", () => {
    assert.equal(leseZustellEreignis(ereignis("email.delivered", { tags: { bewerbung_id: "nicht-hex", rollen: "trainer" } })), null);
    assert.equal(leseZustellEreignis(ereignis("email.delivered", { tags: { bewerbung_id: BEWERBUNG_ID, rollen: "hausmeister" } })), null);
  });

  /* The guard against a superseded message: a re-send mints a new one, and the backend applies an
     event only where this id is still the seat's. Dropping it here would grade the fresh link. */
  it("carries the event's own message id, which is what tells a superseded message apart", () => {
    assert.equal(leseZustellEreignis(ereignis("email.delivered"))?.nachricht_id, NACHRICHT_ID);
  });

  /* `data.created_at` is when the MESSAGE was made and repeats on every event about it, so ordering
     on it would make a bounce and the delivery after it indistinguishable. */
  it("orders on the envelope's instant rather than the message's", () => {
    assert.equal(leseZustellEreignis(ereignis("email.delivered"))?.am, EREIGNIS_AM);
  });

  it("names every seat one message covered, so a mirrored pair moves together", () => {
    const gepaart = leseZustellEreignis(ereignis("email.bounced", { tags: { bewerbung_id: BEWERBUNG_ID, rollen: "ansprechperson-trainer" } }));

    assert.deepEqual(gepaart?.rollen, ["ansprechperson", "trainer"]);
  });
});

describe("the tags one message rides out with", () => {
  const sendung = { bewerbungId: BEWERBUNG_ID, rollen: ["ansprechperson", "trainer"] as const, anlass: "erinnerung" as const };

  /* The provider refuses a tag outside this alphabet with a 422, which reaches the fan-out as a
     message nobody got and no state anywhere. */
  it("keeps every name and value inside the alphabet the provider admits", () => {
    for (const [name, value] of Object.entries(zustellungTags(sendung))) {
      assert.match(name, /^[A-Za-z0-9_-]+$/, `the tag name ${name} is outside the provider's alphabet`);
      assert.match(value, /^[A-Za-z0-9_-]+$/, `the value of ${name} is outside the provider's alphabet`);
    }
  });

  it("routes an event back by application and seat rather than by the message alone", () => {
    assert.deepEqual(zustellungTags(sendung), { bewerbung_id: BEWERBUNG_ID, rollen: "ansprechperson-trainer", anlass: "erinnerung" });
  });

  /* The key collapses a repeat inside the provider's 24-hour window, so it has to be the same string
     for two sends of one day and a different one the next. */
  it("mints one idempotency key per message per day", () => {
    const heute = zustellungIdempotenzSchluessel(sendung, "2026-09-08");

    assert.equal(zustellungIdempotenzSchluessel(sendung, "2026-09-08"), heute);
    assert.notEqual(zustellungIdempotenzSchluessel(sendung, "2026-09-09"), heute);
    assert.ok(heute.length <= 256, "the provider refuses a key over 256 characters");
  });
});

describe("an application holding a seat no message reaches", () => {
  const verlauf = (stand: string | null) => ({
    verschickt_am: "2026-09-01",
    erinnert_am: null,
    abgelehnt_am: null,
    zustellung: stand === null ? null : { nachricht_id: NACHRICHT_ID, stand: stand, grund: null, am: EREIGNIS_AM },
  });

  it("is marked for any of the three states no further message beats", () => {
    for (const stand of ["unzustellbar", "unterdrueckt", "beschwerde"]) {
      assert.equal(
        hatUnerreichbarenSitz({ bestaetigungen: { ansprechperson: verlauf(stand), stellvertretung: null, trainer: null } } as never),
        true,
        `${stand} left the row unmarked`,
      );
    }
  });

  it("is not marked while the trouble can still clear, or before anything is known", () => {
    for (const stand of ["angenommen", "zugestellt", "verzoegert", null]) {
      assert.equal(
        hatUnerreichbarenSitz({ bestaetigungen: { ansprechperson: verlauf(stand), stellvertretung: null, trainer: null } } as never),
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
    const ohne = Object.entries(ZUSTELLUNG_CHIP)
      .filter(([, chip]) => chip === null)
      .map(([stand]) => stand);

    assert.deepEqual(ohne, ["angenommen", "zugestellt"]);
    assert.equal(Object.values(ZUSTELLUNG_CHIP).filter((chip) => chip !== null).length, 4);
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
    const { status, body } = await antwort(signiert(JSON.stringify(ereignis("email.bounced", { bounce: { type: "Permanent" } }))));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: ["ansprechperson"] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.["stand"], "unzustellbar");
    assert.equal(calls[0]?.["bewerbung_id"], BEWERBUNG_ID);
  });

  /* 400 and not 503: a forgery is not worth the provider's thirty-two hours of retries, and the
     schedule ends with the endpoint disabled for every real event too. */
  it("answers 400 for a body changed after it was signed", async () => {
    const echt = JSON.stringify(ereignis("email.delivered"));
    const gefaelscht = echt.replace(BEWERBUNG_ID, `${"b".repeat(23)}2`);
    const request = signiert(echt);

    const { status } = await antwort(
      new NextRequest("http://localhost/api/mail/zustellung", { method: "POST", headers: request.headers, body: gefaelscht }),
    );

    assert.equal(status, 400);
    assert.deepEqual(calls, []);
  });

  it("answers 400 for a signature that is not this secret's", async () => {
    const fremd = new Webhook(`whsec_${randomBytes(24).toString("base64")}`).sign(
      "msg_2xyzABC",
      new Date(),
      JSON.stringify(ereignis("email.delivered")),
    );

    const { status } = await antwort(signiert(JSON.stringify(ereignis("email.delivered")), { headers: { "svix-signature": fremd } }));

    assert.equal(status, 400);
    assert.deepEqual(calls, []);
  });

  it("answers 400 with any one of the three signing headers missing", async () => {
    for (const fehlend of ["svix-id", "svix-timestamp", "svix-signature"]) {
      const { status } = await antwort(signiert(JSON.stringify(ereignis("email.delivered")), { headers: { [fehlend]: "" } }));

      assert.equal(status, 400, `a request without ${fehlend} was accepted`);
    }

    assert.deepEqual(calls, []);
  });

  /* The verifier's own tolerance is five minutes either way, read from the installed
     `standardwebhooks` module's `WEBHOOK_TOLERANCE_IN_SECONDS` and stated by no vendor page. A
     replay of a captured request stops working after it. */
  it("answers 400 for a signature older than the verifier's tolerance", async () => {
    const knapp = await antwort(signiert(JSON.stringify(ereignis("email.delivered")), { alter: 4 * 60 * 1000 }));
    const zu_alt = await antwort(signiert(JSON.stringify(ereignis("email.delivered")), { alter: 6 * 60 * 1000 }));

    assert.equal(knapp.status, 200, "a signature inside the tolerance was refused");
    assert.equal(zu_alt.status, 400);
  });

  it("answers 200 and writes nothing for a message this application never tagged", async () => {
    const { status, body } = await antwort(signiert(JSON.stringify(ereignis("email.delivered", { tags: undefined }))));

    assert.equal(status, 200);
    assert.deepEqual(body, { angewendet: [] });
    assert.deepEqual(calls, []);
  });

  it("answers 200 where the backend applied the event to no seat", async () => {
    recorders.__flZustellungAnswer = () => ({ acknowledged: 1, angewendet: [] });

    const { status, body } = await antwort(signiert(JSON.stringify(ereignis("email.delivered"))));

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
        traceId: "t".repeat(32),
      });
    };

    const { status } = await antwort(signiert(JSON.stringify(ereignis("email.delivered"))));

    assert.equal(status, 200);
  });

  /* The one case a retry repairs. A 200 here tells the provider the event is settled and the state
     is lost for good, which reads on the page exactly like a message that arrived. */
  it("answers 503 where the backend could not be reached", async () => {
    recorders.__flZustellungAnswer = () => {
      throw new APINetworkError({ message: "Request failed.", url: "http://backend:8000", traceId: "t".repeat(32), isTimeout: false });
    };

    const { status, body } = await antwort(signiert(JSON.stringify(ereignis("email.delivered"))));

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
        traceId: "t".repeat(32),
      });
    };

    assert.equal((await antwort(signiert(JSON.stringify(ereignis("email.delivered"))))).status, 503);
  });

  /* `docs/logging/spec.md :: L9`, and the tag block carries the application id besides. Asserted over
     the whole line, so a field added later cannot reopen it. */
  it("names no recipient and no application on any line it writes", async () => {
    recorders.__flZustellungAnswer = () => {
      throw new APINetworkError({ message: "Request failed.", url: "http://backend:8000", traceId: "t".repeat(32), isTimeout: false });
    };

    await antwort(signiert(JSON.stringify(ereignis("email.bounced", { bounce: { type: "Permanent" } }))));
    await antwort(signiert(JSON.stringify(ereignis("email.delivered")), { headers: { "svix-signature": "v1,nope" } }));

    assert.ok(logs.length >= 2, `expected a line for each of the two failures, saw ${String(logs.length)}`);
    const geschrieben = inspect(logs, { depth: null });
    assert.ok(!geschrieben.includes(ADRESSE), "an address reached the stream");
    assert.ok(!geschrieben.includes(BEWERBUNG_ID), "an application id reached the stream");
    for (const line of logs) assert.equal(line.meta?.["error_code"], "FE-MAIL-003");
  });
});
