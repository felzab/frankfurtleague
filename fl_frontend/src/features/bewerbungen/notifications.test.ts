import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleSendMail } from "@/shared/testing/mailDouble.ts";

import type { MailOutcome } from "@/shared/testing/mailDouble.ts";
import type { FLKontaktperson } from "../teams/schemas.ts";
import type { BewerbungSeats } from "./notifications.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** The WHOLE call, the error argument included: that argument is the channel an address travels on. */
type LoggedCall = { message: string; error: unknown; meta: Record<string, unknown> };

/** The id the doubled provider accepts a message under, unless a case names another for its address. */
const ACCEPTED_ID = "56761188-7520-42d8-8898-ff6fc54ce618";

const mail = doubleSendMail();
const sent = mail.sent;
const logged: LoggedCall[] = [];
/** How the provider answers each address a case aims a failure at; every other address is accepted. */
const outcomes = new Map<string, MailOutcome>();

const recorders = globalThis as unknown as Record<string, unknown>;
/** What the recording half of the fan-out was handed. */
const gemeldet: Record<string, unknown>[] = [];

recorders.__flMailLogs = logged;
recorders.__flZustellungCalls = gemeldet;
recorders.__flZustellungFails = false;

// The recording half of the fan-out reaches the backend, which no test process runs.
const MUTATIONS_DOUBLE = `export const meldeZustellungAngenommen = async (payload) => {
  globalThis.__flZustellungCalls.push(payload);
  if (globalThis.__flZustellungFails) throw new Error("the backend refused the record");
  return { acknowledged: 1, angewendet: payload.rollen };
};`;

// The error argument is CAPTURED, never discarded: `fl_frontend/src/core/logFormat.ts :: serializeError`
// writes an error's message and stack, so a double that drops it cannot see an address reaching the
// stream through one.
const LOGGING_DOUBLE = `export const logger = {
  info: () => {},
  warn: () => {},
  error: (message, error, meta) => {
    globalThis.__flMailLogs.push({
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
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/features/bewerbungen/mutations.ts")) return { format: "module", source: MUTATIONS_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const {
  collectBewerbungEingangEmpfaenger,
  collectBewerbungEmpfaenger,
  describeBewerbungMail,
  rolleText,
  seatsByMailbox,
  sendBewerbungMail,
  zustellungIdempotenzSchluessel,
} = await import("./notifications.ts");
const { buildBewerbungBestaetigungEmail } = await import("../../core/bewerbungEmail.ts");
const { bestaetigungsLink } = await import("./bestaetigungLink.ts");
const { requestOutcomeUnknown, runWithRequestScope } = await import("@/core/requestScope");

/** One message composed per recipient, its per-reader half interpolated: two readers handed one text is what this proves against. */
const buildMail = (rollenText: string) => ({
  subject: "Zusage: Frankfurt League, Saison 2627",
  html: `<p>${rollenText}</p>`,
  text: `Zusage für ${rollenText}`,
});

/** An address as a fan-out takes it. The seat wording is immaterial to every test but the ones reading it. */
const empfaenger = (address: string, rollenText = "Ansprechperson") => ({
  address: address,
  rollen: ["ansprechperson"] as const,
  rollenText: rollenText,
});

/** One contact person, of which only the address matters here. */
function person(email: string): FLKontaktperson {
  return {
    vorname: "Erika",
    nachname: "Mustermann",
    email: email,
    telefon: "0151 12345678",
    geburtsdatum: "1990-04-01",
    einwilligung: { umfang: "kontaktdaten", erfasst_von: "person", text_version: "v1", datum: "2026-04-01", bestaetigt_am: "2026-04-02" },
  };
}

/** One contact person under a chosen forename: a link message names it beside the seat's role. */
function benannt(email: string, vorname: string): FLKontaktperson {
  return { ...person(email), vorname: vorname };
}

const seats = (trainer: string | null, ansprechperson: string | null, stellvertretung: string | null): BewerbungSeats => ({
  trainer: trainer === null ? null : person(trainer),
  ansprechperson: ansprechperson === null ? null : person(ansprechperson),
  stellvertretung: stellvertretung === null ? null : person(stellvertretung),
});

function reset(): void {
  sent.length = 0;
  logged.length = 0;
  outcomes.clear();
  mail.answerWith(({ to }) => outcomes.get(to) ?? { accepted: ACCEPTED_ID });
  gemeldet.length = 0;
  recorders.__flZustellungFails = false;
}

describe("how one seat is named to somebody who is not sitting in it", () => {
  /* The submission's receipt, the retention notice and the objection notice each name a seat this
     way, so a wording answered here differently from `rollenText` would put one seat under two
     names in messages a single reader gets. */
  it("gives every seat the long form the joined phrase gives it", () => {
    assert.deepEqual((["ansprechperson", "stellvertretung", "trainer"] as const).map(rolleText), [
      "Ansprechperson",
      "Stellvertretung",
      "Trainerin oder Trainer",
    ]);
    assert.deepEqual(
      collectBewerbungEmpfaenger(seats("t@schule.de", null, null)).map(({ rollenText }) => rollenText),
      [rolleText("trainer")],
      "a fan-out names a lone seat differently from the helper every message reads",
    );
  });
});

describe("who a decision is sent to", () => {
  /* First, so a double that never ran fails here rather than under every assertion below. */
  it("reaches the provider through the doubled transport at all", async () => {
    reset();
    const outcome = await sendBewerbungMail({ operation: "test", recipients: [empfaenger("a@schule.de")], buildMail: buildMail });

    assert.deepEqual(
      sent.map((mail) => mail.to),
      ["a@schule.de"],
    );
    assert.deepEqual(outcome, { delivered: ["a@schule.de"], unreachable: [], ungewiss: [] });
  });

  /* `trainer_ist_zugleich` stores ONE person in two slots, so the same address stands twice in
     a perfectly ordinary application. */
  it("mails a person holding two seats once, naming both seats", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("trainer@schule.de", "trainer@schule.de", "vertretung@schule.de")), [
      { address: "trainer@schule.de", rollen: ["ansprechperson", "trainer"], rollenText: "Ansprechperson und Trainerin oder Trainer" },
      { address: "vertretung@schule.de", rollen: ["stellvertretung"], rollenText: "Stellvertretung" },
    ]);
  });

  /* The seat is what the message tells its reader they were given, so a fan-out that lost it would
     send three people one text about somebody else's place in the season. */
  it("names each of the three the seat they hold", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("t@schule.de", "a@schule.de", "s@schule.de")), [
      { address: "a@schule.de", rollen: ["ansprechperson"], rollenText: "Ansprechperson" },
      { address: "s@schule.de", rollen: ["stellvertretung"], rollenText: "Stellvertretung" },
      { address: "t@schule.de", rollen: ["trainer"], rollenText: "Trainerin oder Trainer" },
    ]);
  });

  /* A seat can be empty: an erasure clears the slot naming one person and leaves the two beside them. */
  it("passes over an empty seat and an unrecorded address", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats(null, "  ", "vertretung@schule.de")), [
      { address: "vertretung@schule.de", rollen: ["stellvertretung"], rollenText: "Stellvertretung" },
    ]);
    assert.deepEqual(collectBewerbungEmpfaenger(seats(null, null, null)), []);
  });

  /* Stored unfolded, its local part as typed: the local part of an address belongs to the mailbox owner. */
  it("keeps an address as it was stored", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats(" Trainer@Schule.de ", null, null)), [
      { address: "Trainer@Schule.de", rollen: ["trainer"], rollenText: "Trainerin oder Trainer" },
    ]);
  });

  /* A domain is case-insensitive by definition, so two seats spelling one differently name one
     mailbox, which would otherwise receive the decision twice. */
  it("mails one mailbox spelled with two domain cases once", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("trainer@Schule.de", "trainer@schule.de", null)), [
      { address: "trainer@schule.de", rollen: ["ansprechperson", "trainer"], rollenText: "Ansprechperson und Trainerin oder Trainer" },
    ]);
  });

  /* And a local part is not: `Trainer` and `trainer` are the destination host's to tell apart, so
     dropping either would leave a person unnotified over an assumption nobody here may make. */
  it("keeps two local parts differing only in case apart", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("Trainer@schule.de", "trainer@schule.de", null)), [
      { address: "trainer@schule.de", rollen: ["ansprechperson"], rollenText: "Ansprechperson" },
      { address: "Trainer@schule.de", rollen: ["trainer"], rollenText: "Trainerin oder Trainer" },
    ]);
  });

  /* One message per address and not one message for all of them: the acceptance names the seat its
     reader holds, and a single composed text would tell two of the three the wrong one. */
  it("composes the message once per recipient", async () => {
    reset();
    await sendBewerbungMail({
      operation: "annehmenBewerbungAction",
      recipients: collectBewerbungEmpfaenger(seats("t@schule.de", "a@schule.de", "s@schule.de")),
      buildMail: buildMail,
    });

    assert.deepEqual(
      sent.map((mail) => mail.text),
      ["Zusage für Ansprechperson", "Zusage für Stellvertretung", "Zusage für Trainerin oder Trainer"],
    );
  });
});

describe("who the workflow's messages to the submitter are sent to", () => {
  /* No seat records who submitted, and the Ansprechperson is the submitter by convention, so every
     message the workflow addresses to them takes this fan-out rather than the decisions' own. */
  it("reaches the Ansprechperson and nobody else", () => {
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("trainer@schule.de", "kontakt@schule.de", "vertretung@schule.de")), [
      { address: "kontakt@schule.de", rollen: ["ansprechperson"], rollenText: "Ansprechperson" },
    ]);
  });

  /* `trainer_ist_zugleich` puts one person in two seats. Deduplication is by ADDRESS, so that person
     gets the one message their mailbox is owed, naming both seats rather than one of them. */
  it("names both seats where the Ansprechperson is also the Trainer", () => {
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("kontakt@schule.de", "kontakt@schule.de", "vertretung@schule.de")), [
      { address: "kontakt@schule.de", rollen: ["ansprechperson", "trainer"], rollenText: "Ansprechperson und Trainerin oder Trainer" },
    ]);
  });

  it("goes nowhere where that seat carries no address", () => {
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("trainer@schule.de", null, "vertretung@schule.de")), []);
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("trainer@schule.de", " ", "vertretung@schule.de")), []);
  });
});

describe("which mailbox is sent which link", () => {
  /* Two different people on a school inbox are the case a fan-out keyed on the person rather than
     the address splits into two messages, each showing the reader somebody else's link as well. */
  it("gives a shared inbox one message carrying a link for each seat on it", () => {
    const kontakte = {
      trainer: benannt("info@schule.de", "Jonas"),
      ansprechperson: benannt("info@schule.de", "Erika"),
      stellvertretung: benannt("mira@schule.de", "Mira"),
    };

    assert.deepEqual(seatsByMailbox(kontakte, { ansprechperson: "L-A", stellvertretung: "L-S", trainer: "L-T" }), [
      {
        address: "info@schule.de",
        rollen: ["ansprechperson", "trainer"],
        seats: [
          { vorname: "Erika", rolleText: "Ansprechperson", link: "L-A" },
          { vorname: "Jonas", rolleText: "Trainerin oder Trainer", link: "L-T" },
        ],
      },
      { address: "mira@schule.de", rollen: ["stellvertretung"], seats: [{ vorname: "Mira", rolleText: "Stellvertretung", link: "L-S" }] },
    ]);
  });

  /* `trainer_ist_zugleich` is ONE person holding two seats. Where the caller answers both with one
     token the message offers one control naming both roles: two buttons to a single URL would read
     as two things to do. */
  it("merges two seats a single link answers for into one entry naming both", () => {
    const kontakte = {
      trainer: benannt("erika@schule.de", "Erika"),
      ansprechperson: benannt("erika@schule.de", "Erika"),
      stellvertretung: benannt("mira@schule.de", "Mira"),
    };

    assert.deepEqual(seatsByMailbox(kontakte, { ansprechperson: "L-A", trainer: "L-A", stellvertretung: "L-S" }), [
      {
        address: "erika@schule.de",
        rollen: ["ansprechperson", "trainer"],
        seats: [{ vorname: "Erika", rolleText: "Ansprechperson und Trainerin oder Trainer", link: "L-A" }],
      },
      { address: "mira@schule.de", rollen: ["stellvertretung"], seats: [{ vorname: "Mira", rolleText: "Stellvertretung", link: "L-S" }] },
    ]);
  });

  /* The pair the workflow mints two tokens for: the backend answers both seats from either press
     (`fl_backend/app/api/bewerbungen/services.py :: paired_seat`), so the second link would put two
     buttons in front of one reader over one decision. */
  it("offers a mirrored Trainer one link, under both the seats it answers for", () => {
    const kontakte = {
      trainer: benannt("mira@schule.de", "Mira"),
      ansprechperson: benannt("erika@schule.de", "Erika"),
      stellvertretung: benannt("mira@schule.de", "Mira"),
      trainer_ist_zugleich: "stellvertretung" as const,
    };
    // The local stack's own origin, as every minter now hands the helper (`docs/frontend/spec.md :: I186`).
    const origin = "http://localhost:3000";
    const ownLink2 = bestaetigungsLink(origin, "erste");
    const gespiegelter = bestaetigungsLink(origin, "zweite");

    const verlinkt = seatsByMailbox(kontakte, { ansprechperson: "L-A", stellvertretung: ownLink2, trainer: gespiegelter });
    const gepaart = verlinkt.find((mailbox) => mailbox.address === "mira@schule.de");

    assert.deepEqual(gepaart?.seats, [{ vorname: "Mira", rolleText: "Stellvertretung und Trainerin oder Trainer", link: ownLink2 }]);

    const mail = buildBewerbungBestaetigungEmail({
      saisonId: "2627",
      origin: origin,
      schule: "Lessing-Kolleg",
      seats: gepaart?.seats ?? [{ vorname: "Mira", rolleText: "Stellvertretung", link: ownLink2 }],
      fristText: "30.09.2026",
    });

    // Both branches: a reader whose client draws no HTML meets the same one link in the text.
    for (const half of [mail.html, mail.text]) {
      const adressen = new Set(
        [...half.matchAll(/https?:\/\/[^"'<\s]+/g)].map((treffer) => treffer[0]).filter((url) => url.includes("bestaetigung")),
      );

      assert.deepEqual([...adressen], [ownLink2], "the message offers a second link for the seat the first one already answers");
      assert.match(half, /Stellvertretung/, "the message no longer names the seat the person was entered under");
      assert.match(half, /Trainerin oder Trainer/, "the message no longer names the seat the Trainer claim mirrors");
    }
  });

  /* One person on two seats is what `trainer_ist_zugleich` declares, and nothing else: two seats on
     one inbox that it does not pair are two readers, each owed the link addressed to them. */
  it("keeps two seats apart where each carries its own link", () => {
    const kontakte = {
      trainer: benannt("erika@schule.de", "Erika"),
      ansprechperson: benannt("erika@schule.de", "Erika"),
      stellvertretung: null,
    };

    assert.deepEqual(seatsByMailbox(kontakte, { ansprechperson: "L-A", trainer: "L-T" }), [
      {
        address: "erika@schule.de",
        rollen: ["ansprechperson", "trainer"],
        seats: [
          { vorname: "Erika", rolleText: "Ansprechperson", link: "L-A" },
          { vorname: "Erika", rolleText: "Trainerin oder Trainer", link: "L-T" },
        ],
      },
    ]);
  });

  /* The reminder's own shape: a seat that has answered carries no link, and the mailbox left with
     nothing to press drops out rather than being sent a message with no control on it. */
  it("leaves out a seat with no link, and a mailbox left holding none", () => {
    const kontakte = {
      trainer: benannt("jonas@schule.de", "Jonas"),
      ansprechperson: benannt("erika@schule.de", "Erika"),
      stellvertretung: benannt("erika@schule.de", "Mira"),
    };

    assert.deepEqual(seatsByMailbox(kontakte, { stellvertretung: "L-S" }), [
      // Both seats of that mailbox, although one got no link: the message's fate is the address's,
      // and the seat whose link was withheld shares it.
      {
        address: "erika@schule.de",
        rollen: ["ansprechperson", "stellvertretung"],
        seats: [{ vorname: "Mira", rolleText: "Stellvertretung", link: "L-S" }],
      },
    ]);
    assert.deepEqual(seatsByMailbox(kontakte, {}), []);
  });

  /* The dedupe is `collectSeats`'s, unchanged: the local part byte for byte under a domain compared
     without case. A grouping of its own would answer differently for exactly these two. */
  it("groups by the mailbox rule the decision fan-out already uses", () => {
    const geteilt = {
      trainer: benannt("Info@SCHULE.de", "Jonas"),
      ansprechperson: benannt("Info@schule.de", "Erika"),
      stellvertretung: null,
    };
    const getrennt = {
      trainer: benannt("INFO@schule.de", "Jonas"),
      ansprechperson: benannt("info@schule.de", "Erika"),
      stellvertretung: null,
    };

    // One domain in two cases is one mailbox; the local part's case is two people.
    assert.equal(seatsByMailbox(geteilt, { ansprechperson: "L-A", trainer: "L-T" }).length, 1);
    assert.equal(seatsByMailbox(getrennt, { ansprechperson: "L-A", trainer: "L-T" }).length, 2);
  });

  /* The seats come back in `KONTAKT_ROLLEN`'s order, which is the order `joinUnd` builds a German
     phrase in and the order the message lays its controls out in. */
  it("orders a mailbox's seats as the seat table declares them", () => {
    const kontakte = {
      trainer: benannt("info@schule.de", "Jonas"),
      ansprechperson: benannt("info@schule.de", "Erika"),
      stellvertretung: benannt("info@schule.de", "Mira"),
    };

    assert.deepEqual(
      seatsByMailbox(kontakte, { ansprechperson: "L-A", stellvertretung: "L-S", trainer: "L-T" })[0]?.seats.map((seat) => seat.rolleText),
      ["Ansprechperson", "Stellvertretung", "Trainerin oder Trainer"],
    );
  });
});

describe("a fan-out that cannot reach everyone", () => {
  /* The decision is committed by the time any of this runs, and no endpoint takes it back, so one
     refused mailbox must not cost the other two their notification. */
  it("settles every recipient although one is refused", async () => {
    reset();
    outcomes.set("zweite@schule.de", "refused");

    const outcome = await sendBewerbungMail({
      operation: "annehmenBewerbungAction",
      recipients: ["erste@schule.de", "zweite@schule.de", "dritte@schule.de"].map((address) => empfaenger(address)),
      buildMail: buildMail,
    });

    assert.deepEqual(
      sent.map((mail) => mail.to),
      ["erste@schule.de", "zweite@schule.de", "dritte@schule.de"],
    );
    assert.deepEqual(outcome.delivered, ["erste@schule.de", "dritte@schule.de"]);
    assert.deepEqual(outcome.unreachable, ["zweite@schule.de"]);
  });

  /* The provider may have accepted a send whose connection broke: reported unreachable, the decision's
     sentence says the notice did not reach a person who may be reading it. */
  it("counts a send that broke off unanswered as of unknown outcome, never unreachable, and marks the request", async () => {
    reset();
    outcomes.set("zweite@schule.de", "lost");

    const [outcome, markedUnknown] = await runWithRequestScope({ traceId: "a".repeat(32), spanId: "b".repeat(16) }, async () => {
      const settled = await sendBewerbungMail({
        operation: "annehmenBewerbungAction",
        recipients: ["erste@schule.de", "zweite@schule.de"].map((address) => empfaenger(address)),
        buildMail: buildMail,
      });

      return [settled, requestOutcomeUnknown()] as const;
    });

    assert.deepEqual([outcome.delivered, outcome.unreachable, outcome.ungewiss], [["erste@schule.de"], [], ["zweite@schule.de"]]);
    assert.equal(markedUnknown, true, "the request was not told a send may have landed");
  });

  /* Refused before it left, the request's deadline spent: nothing can be in the inbox, so it is not
     the unclear send above. */
  it("counts a send refused before it left as unreachable, never unclear", async () => {
    reset();
    outcomes.set("zweite@schule.de", "unsent");

    const [outcome, markedUnknown] = await runWithRequestScope({ traceId: "a".repeat(32), spanId: "b".repeat(16) }, async () => {
      const settled = await sendBewerbungMail({
        operation: "annehmenBewerbungAction",
        recipients: ["erste@schule.de", "zweite@schule.de"].map((address) => empfaenger(address)),
        buildMail: buildMail,
      });

      return [settled, requestOutcomeUnknown()] as const;
    });

    assert.deepEqual([outcome.delivered, outcome.unreachable, outcome.ungewiss], [["erste@schule.de"], ["zweite@schule.de"], []]);
    assert.equal(markedUnknown, false, "a send that never left marked the request unclear");
  });

  it("reports every address when the provider refuses them all", async () => {
    reset();
    const addresses = ["erste@schule.de", "zweite@schule.de"];
    for (const address of addresses) outcomes.set(address, "refused");

    const outcome = await sendBewerbungMail({
      operation: "ablehnenBewerbungAction",
      recipients: addresses.map((address) => empfaenger(address)),
      buildMail: buildMail,
    });

    assert.deepEqual(outcome.delivered, []);
    assert.deepEqual(outcome.unreachable, ["erste@schule.de", "zweite@schule.de"]);
  });

  /* The address reaches the administrator, in the action's message, and never the log
     (`docs/logging/spec.md :: L9`) — the one place it would outlive the request. */
  it("logs the failure without the address on the line", async () => {
    reset();
    outcomes.set("zweite@schule.de", "refused");

    await sendBewerbungMail({
      operation: "annehmenBewerbungAction",
      recipients: ["erste@schule.de", "zweite@schule.de"].map((address) => empfaenger(address)),
      buildMail: buildMail,
    });

    assert.equal(logged.length, 1, "one refusal produced something other than one log line");
    assert.equal(logged[0]?.message, "bewerbung.mail_failed");
    assert.equal(logged[0]?.meta.operation, "annehmenBewerbungAction");
    // Serialised whole, so an address reaching any field — the error argument included — fails here.
    assert.ok(!JSON.stringify(logged[0]).includes("zweite@schule.de"), "the recipient travels on the log line");
  });

  /* Every frontend failure line carries one (`docs/logging/spec.md`), and this one is not
     `FE-MAIL-001`: that is `sendMail`'s own line for the same refusal, under the same trace id. */
  it("carries its own error code and the error's name, and no error object", async () => {
    reset();
    outcomes.set("erste@schule.de", "refused");

    await sendBewerbungMail({ operation: "ablehnenBewerbungAction", recipients: [empfaenger("erste@schule.de")], buildMail: buildMail });

    assert.equal(logged[0]?.meta.error_code, "FE-MAIL-002");
    assert.equal(logged[0]?.meta.name, "MailSendError", "the line no longer names the error class");
    assert.equal(logged[0]?.error, undefined, "the error object reaches the stream, and its message and stack with it");
  });
});

describe("what the administrator is told", () => {
  it("names nobody where every message arrived", () => {
    assert.equal(
      describeBewerbungMail("Zusage", { delivered: ["a@schule.de", "b@schule.de"], unreachable: [] }),
      "Die Zusage ging an 2 Kontaktpersonen.",
    );
    // Its own arm: German counts nothing and one with words rather than with a figure.
    assert.equal(describeBewerbungMail("Absage", { delivered: ["a@schule.de"], unreachable: [] }), "Die Absage ging an eine Kontaktperson.");
  });

  it("names every address it could not reach", () => {
    const report = describeBewerbungMail("Zusage", { delivered: ["a@schule.de"], unreachable: ["b@schule.de", "c@schule.de"] });

    assert.match(report, /b@schule\.de/);
    assert.match(report, /c@schule\.de/);
    assert.match(report, /Melde Dich selbst bei ihnen/, "the report names nobody's remedy");
  });

  /* Pinned whole, not by a fragment: the noun is a German one and the sentence supplies its own
     article, so lower-casing it renders „ging die absage“ where a fragment match sees nothing. */
  it("says so where the application named no address at all", () => {
    assert.equal(
      describeBewerbungMail("Absage", { delivered: [], unreachable: [] }),
      "Die Bewerbung nennt keine E-Mail-Adresse, deshalb ging die Absage an niemanden raus.",
    );
  });

  /* Two different failures, and the words part company: nothing arrived, against some of it did. */
  it("tells a total failure apart from a partial one", () => {
    const nothing = describeBewerbungMail("Zusage", { delivered: [], unreachable: ["a@schule.de"] });
    const partial = describeBewerbungMail("Zusage", { delivered: ["b@schule.de"], unreachable: ["a@schule.de"] });

    assert.match(nothing, /niemandem zugestellt/);
    assert.notEqual(nothing, partial);
  });
});

/**
 * Composing is inside the settling too (`docs/frontend/spec.md :: I70`): the public receipt
 * `fl_frontend/src/app/api/bewerbung/route.ts` awaits this with no `catch`, so a rejected fan-out
 * would show an applicant a failure for a stored application.
 */
describe("a message that cannot be composed costs no other recipient theirs", () => {
  /** Throws for one reader and composes for the others, which is what a per-recipient compose can do. */
  const buildMailThatThrowsFor = (kaputt: string) => (rollenText: string) => {
    if (rollenText === kaputt) throw new Error("composing failed");

    return buildMail(rollenText);
  };

  it("settles rather than rejecting when composing throws", async () => {
    reset();
    const outcome = await sendBewerbungMail({
      operation: "annehmenBewerbungAction",
      recipients: [empfaenger("erste@schule.de", "Trainer"), empfaenger("zweite@schule.de", "Ansprechperson")],
      buildMail: buildMailThatThrowsFor("Trainer"),
    });

    /* The reader whose message could not be composed is unreachable, and the other one is still
       delivered: one broken compose must not cost the others their notification. */
    assert.deepEqual(outcome, { delivered: ["zweite@schule.de"], unreachable: ["erste@schule.de"], ungewiss: [] });
  });

  it("reports the failure on the same line a refused send uses", async () => {
    reset();
    await sendBewerbungMail({
      operation: "annehmenBewerbungAction",
      recipients: [empfaenger("erste@schule.de", "Trainer")],
      buildMail: buildMailThatThrowsFor("Trainer"),
    });

    const failedLines = logged.filter((eintrag) => eintrag.message === "bewerbung.mail_failed");
    assert.equal(failedLines.length, 1);
    assert.equal(failedLines[0]?.meta.error_code, "FE-MAIL-002");
    /* The address stays off the stream, as it does for a refused send (`docs/logging/spec.md :: L9`). */
    assert.ok(!JSON.stringify(failedLines[0]).includes("erste@schule.de"));
  });
});

describe("what an accepted send records about itself", () => {
  const AUFTRAG = { bewerbungId: `${"a".repeat(23)}1`, anlass: "erinnerung" as const };

  const gepaart = {
    address: "erika@schule.de",
    rollen: ["ansprechperson", "trainer"] as const,
    rollenText: "Ansprechperson und Trainerin oder Trainer",
  };

  /* First, so a double that never ran fails here rather than under every assertion below. */
  it("records the message against every seat it covered", async () => {
    reset();
    await sendBewerbungMail({ operation: "bewerbungSweep", auftrag: AUFTRAG, recipients: [gepaart], buildMail: buildMail });

    assert.deepEqual(gemeldet, [
      {
        bewerbung_id: AUFTRAG.bewerbungId,
        rollen: ["ansprechperson", "trainer"],
        nachricht_id: ACCEPTED_ID,
        am: gemeldet[0]?.["am"],
      },
    ]);
    assert.match(String(gemeldet[0]?.["am"]), /^\d{4}-\d{2}-\d{2}T/);
  });

  it("carries the tags the provider echoes back on every event about that message", async () => {
    reset();
    await sendBewerbungMail({ operation: "bewerbungSweep", auftrag: AUFTRAG, recipients: [gepaart], buildMail: buildMail });

    assert.deepEqual(sent[0]?.tags, { bewerbung_id: AUFTRAG.bewerbungId, rollen: "ansprechperson-trainer", anlass: "erinnerung" });
  });

  /* A key over a body that can change is refused rather than collapsed, so the day is passed only
     where the caller has judged the body fixed for it. */
  it("passes an idempotency key only where the caller named a day for it", async () => {
    reset();
    await sendBewerbungMail({ operation: "bewerbungSweep", auftrag: AUFTRAG, recipients: [gepaart], buildMail: buildMail });
    assert.equal(sent[0]?.idempotencyKey, undefined);

    reset();
    await sendBewerbungMail({
      operation: "bewerbungSweep",
      auftrag: { ...AUFTRAG, anlass: "loeschung", idempotenzTag: "2026-09-08" },
      recipients: [gepaart],
      buildMail: buildMail,
    });
    assert.match(
      sent[0]?.idempotencyKey ?? "",
      new RegExp(`^loeschung_${AUFTRAG.bewerbungId}_ansprechperson-trainer_2026-09-08_[0-9a-f]{64}$`),
    );
  });

  /* The two triage decisions pass none: their application is closed by the time a delivery state
     could be read, and a tag with no record behind it is an event nothing can be written for. */
  it("records nothing and tags nothing for a fan-out that named no application", async () => {
    reset();
    await sendBewerbungMail({ operation: "annehmenBewerbungAction", recipients: [empfaenger("erika@schule.de")], buildMail: buildMail });

    assert.deepEqual(gemeldet, []);
    assert.equal(sent[0]?.tags, undefined);
  });

  it("records nothing for a message the provider refused", async () => {
    reset();
    outcomes.set("erika@schule.de", "refused");

    await sendBewerbungMail({ operation: "bewerbungSweep", auftrag: AUFTRAG, recipients: [gepaart], buildMail: buildMail });

    assert.deepEqual(gemeldet, []);
  });

  /* An accepted answer carrying no id joins nothing, and a state written against no message would
     mark the seat delivered on the strength of the request alone. */
  it("records nothing where the provider accepted the message without naming it", async () => {
    reset();
    outcomes.set("erika@schule.de", { accepted: null });

    await sendBewerbungMail({ operation: "bewerbungSweep", auftrag: AUFTRAG, recipients: [gepaart], buildMail: buildMail });

    assert.deepEqual(gemeldet, []);
    assert.equal(sent.length, 1, "the message itself was withheld");
  });

  /* The message HAS gone. A caller told otherwise would report a send that happened as one that did
     not, which on the sweep's path withholds an erasure for ever. */
  it("does not fail the send when the record cannot be written", async () => {
    reset();
    recorders.__flZustellungFails = true;

    const outcome = await sendBewerbungMail({ operation: "bewerbungSweep", auftrag: AUFTRAG, recipients: [gepaart], buildMail: buildMail });

    assert.deepEqual(outcome, { delivered: ["erika@schule.de"], unreachable: [], ungewiss: [] });
    const unreportedLine = logged.find((eintrag) => eintrag.message === "bewerbung.zustellung_ungemeldet");
    assert.equal(unreportedLine?.meta.error_code, "FE-MAIL-003");
    assert.ok(!JSON.stringify(unreportedLine).includes("erika@schule.de"), "the recipient travels on the log line");
  });
});

describe("the key one application message is sent under", () => {
  const delivery = { bewerbungId: "a".repeat(24), rollen: ["ansprechperson", "trainer"] as const, anlass: "erinnerung" as const };

  /* The key collapses a repeat inside the provider's 24-hour window, so it has to be the same string
     for two sends of one day and a different one the next. */
  it("mints one idempotency key per message per day", () => {
    const today = zustellungIdempotenzSchluessel(delivery, "2026-09-08", "erste@schule.de");

    assert.equal(zustellungIdempotenzSchluessel(delivery, "2026-09-08", "erste@schule.de"), today);
    assert.notEqual(zustellungIdempotenzSchluessel(delivery, "2026-09-09", "erste@schule.de"), today);
    assert.ok(today.length <= 256, "the provider refuses a key over 256 characters");
  });

  /* The provider refuses a key reused over another payload, and the recipient is in the payload: an
     address corrected inside the window would otherwise go out under the old address's key. */
  it("mints a different key for the same seats at another mailbox", () => {
    assert.notEqual(
      zustellungIdempotenzSchluessel(delivery, "2026-09-08", "erste@schule.de"),
      zustellungIdempotenzSchluessel(delivery, "2026-09-08", "neue@schule.de"),
    );
  });
});
