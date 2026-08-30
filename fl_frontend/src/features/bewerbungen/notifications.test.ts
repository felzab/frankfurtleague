import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import type { FLKontaktperson } from "../teams/schemas.ts";
import type { BewerbungSeats } from "./notifications.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

type SentMail = { to: string; subject: string; text: string };

/** The WHOLE call, the error argument included: that argument is the channel an address travels on. */
type LoggedCall = { message: string; error: unknown; meta: Record<string, unknown> };

const sent: SentMail[] = [];
const logged: LoggedCall[] = [];
/** Addresses the doubled provider refuses, so a failure can be aimed at one recipient. */
const refused = new Set<string>();

const recorders = globalThis as unknown as Record<string, unknown>;
recorders.__flSentMail = sent;
recorders.__flMailLogs = logged;
recorders.__flRefusedMail = refused;

// Replaced at the module boundary rather than the fan-out being reshaped to admit a seam: the real
// transport reads an API key out of the validated environment at import, as the real logger does.
const MAIL_DOUBLE = `export const sendMail = async (mail) => {
  globalThis.__flSentMail.push({ to: mail.to, subject: mail.subject, text: mail.text });
  if (globalThis.__flRefusedMail.has(mail.to)) throw new Error("the provider refused the message");
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
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { collectBewerbungEingangEmpfaenger, collectBewerbungEmpfaenger, describeBewerbungMail, sendBewerbungMail } =
  await import("./notifications.ts");

/** One message composed per recipient, its per-reader half interpolated: two readers handed one text is what this proves against. */
const buildMail = (rollenText: string) => ({
  subject: "Zusage: Frankfurt-League, Saison 2627",
  html: `<p>${rollenText}</p>`,
  text: `Zusage für ${rollenText}`,
});

/** An address as a fan-out takes it. The seat wording is immaterial to every test but the ones reading it. */
const empfaenger = (address: string, rollenText = "Ansprechperson") => ({ address: address, rollenText: rollenText });

/** One contact person, of which only the address matters here. */
function person(email: string): FLKontaktperson {
  return {
    vorname: "Erika",
    nachname: "Mustermann",
    email: email,
    telefon: "0151 12345678",
    geburtsdatum: "1990-04-01",
    einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "v1", datum: "2026-04-01" },
  };
}

const seats = (trainer: string | null, ansprechperson: string | null, stellvertretung: string | null): BewerbungSeats => ({
  trainer: trainer === null ? null : person(trainer),
  ansprechperson: ansprechperson === null ? null : person(ansprechperson),
  stellvertretung: stellvertretung === null ? null : person(stellvertretung),
});

function reset(): void {
  sent.length = 0;
  logged.length = 0;
  refused.clear();
}

describe("who a decision is sent to", () => {
  /* First, because a harness whose double never ran would leave `sent` empty and every assertion
     after this would fail for the harness rather than for the source. */
  it("reaches the provider through the doubled transport at all", async () => {
    reset();
    const outcome = await sendBewerbungMail({ operation: "test", recipients: [empfaenger("a@schule.de")], buildMail: buildMail });

    assert.deepEqual(
      sent.map((mail) => mail.to),
      ["a@schule.de"],
    );
    assert.deepEqual(outcome, { delivered: ["a@schule.de"], unreachable: [] });
  });

  /* `trainer_ist_zugleich` stores ONE person in two slots, so the same address stands twice in
     a perfectly ordinary application. */
  it("mails a person holding two seats once, naming both seats", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("trainer@schule.de", "trainer@schule.de", "vertretung@schule.de")), [
      { address: "trainer@schule.de", rollenText: "Trainerin oder Trainer und Ansprechperson" },
      { address: "vertretung@schule.de", rollenText: "Stellvertretung" },
    ]);
  });

  /* The seat is what the message tells its reader they were given, so a fan-out that lost it would
     send three people one text about somebody else's place in the season. */
  it("names each of the three the seat they hold", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("t@schule.de", "a@schule.de", "s@schule.de")), [
      { address: "t@schule.de", rollenText: "Trainerin oder Trainer" },
      { address: "a@schule.de", rollenText: "Ansprechperson" },
      { address: "s@schule.de", rollenText: "Stellvertretung" },
    ]);
  });

  /* A seat can be empty: an erasure clears the slot naming one person and leaves the two beside them. */
  it("passes over an empty seat and an unrecorded address", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats(null, "  ", "vertretung@schule.de")), [
      { address: "vertretung@schule.de", rollenText: "Stellvertretung" },
    ]);
    assert.deepEqual(collectBewerbungEmpfaenger(seats(null, null, null)), []);
  });

  /* Stored as typed, and never folded: the local part of an address belongs to the mailbox owner. */
  it("keeps an address as it was stored", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats(" Trainer@Schule.de ", null, null)), [
      { address: "Trainer@Schule.de", rollenText: "Trainerin oder Trainer" },
    ]);
  });

  /* A domain is case-insensitive by definition, so two seats spelling one differently name one
     mailbox, which would otherwise receive the decision twice. */
  it("mails one mailbox spelled with two domain cases once", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("trainer@Schule.de", "trainer@schule.de", null)), [
      { address: "trainer@Schule.de", rollenText: "Trainerin oder Trainer und Ansprechperson" },
    ]);
  });

  /* And a local part is not: `Trainer` and `trainer` are the destination host's to tell apart, so
     dropping either would leave a person unnotified over an assumption nobody here may make. */
  it("keeps two local parts differing only in case apart", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("Trainer@schule.de", "trainer@schule.de", null)), [
      { address: "Trainer@schule.de", rollenText: "Trainerin oder Trainer" },
      { address: "trainer@schule.de", rollenText: "Ansprechperson" },
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
      ["Zusage für Trainerin oder Trainer", "Zusage für Ansprechperson", "Zusage für Stellvertretung"],
    );
  });
});

describe("who the receipt is sent to", () => {
  /* Sent before anybody has confirmed an address, so it goes to the one seat that asked to be
     written to rather than to all three — the smallest fan-out that still answers the applicant. */
  it("reaches the Ansprechperson and nobody else", () => {
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("trainer@schule.de", "kontakt@schule.de", "vertretung@schule.de")), [
      { address: "kontakt@schule.de", rollenText: "Ansprechperson" },
    ]);
  });

  /* `trainer_ist_zugleich` puts one person in two seats. Deduplication is by ADDRESS, so that person
     gets the one message their mailbox is owed, naming both seats rather than one of them. */
  it("names both seats where the Ansprechperson is also the Trainer", () => {
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("kontakt@schule.de", "kontakt@schule.de", "vertretung@schule.de")), [
      { address: "kontakt@schule.de", rollenText: "Trainerin oder Trainer und Ansprechperson" },
    ]);
  });

  it("goes nowhere where that seat carries no address", () => {
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("trainer@schule.de", null, "vertretung@schule.de")), []);
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("trainer@schule.de", " ", "vertretung@schule.de")), []);
  });
});

describe("a fan-out that cannot reach everyone", () => {
  /* The decision is committed by the time any of this runs, and no endpoint takes it back, so one
     refused mailbox must not cost the other two their notification. */
  it("settles every recipient although one is refused", async () => {
    reset();
    refused.add("zweite@schule.de");

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

  it("reports every address when the provider refuses them all", async () => {
    reset();
    for (const address of ["erste@schule.de", "zweite@schule.de"]) refused.add(address);

    const outcome = await sendBewerbungMail({
      operation: "ablehnenBewerbungAction",
      recipients: [...refused].map((address) => empfaenger(address)),
      buildMail: buildMail,
    });

    assert.deepEqual(outcome.delivered, []);
    assert.deepEqual(outcome.unreachable, ["erste@schule.de", "zweite@schule.de"]);
  });

  /* The address reaches the administrator, in the action's message, and never the log
     (`docs/logging/spec.md :: L9`) — the one place it would outlive the request. */
  it("logs the failure without the address on the line", async () => {
    reset();
    refused.add("zweite@schule.de");

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
     `FE-MAIL-001`: that is `sendMail`'s own line for the same refusal, under the same correlation id. */
  it("carries its own error code and the error's name, and no error object", async () => {
    reset();
    refused.add("erste@schule.de");

    await sendBewerbungMail({ operation: "ablehnenBewerbungAction", recipients: [empfaenger("erste@schule.de")], buildMail: buildMail });

    assert.equal(logged[0]?.meta.error_code, "FE-MAIL-002");
    assert.equal(logged[0]?.meta.name, "Error", "the line no longer names the error class");
    assert.equal(logged[0]?.error, undefined, "the error object reaches the stream, and its message and stack with it");
  });

  /* The runtime case above proves TODAY'S error carries no address. This one holds whatever
     `sendMail` throws tomorrow: handed `undefined`, no error can reach the stream at all. */
  it("hands the log stream no error object at all, in the source", () => {
    const file = path.join(import.meta.dirname, "notifications.ts");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const calls: ts.NodeArray<ts.Expression>[] = [];

    source.forEachChild(function walk(node: ts.Node): void {
      const isLoggerError =
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "logger" &&
        node.expression.name.text === "error";

      if (isLoggerError) calls.push(node.arguments);
      node.forEachChild(walk);
    });

    assert.equal(calls.length, 1, "no logger.error call was found, so this test proves nothing");
    const errorArgument = calls[0]![1];
    assert.ok(
      errorArgument && ts.isIdentifier(errorArgument) && errorArgument.text === "undefined",
      "logger.error was handed an error object where it must be handed `undefined`",
    );
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
 * Composing is inside the settling too (`docs/frontend/spec.md :: I39`): the public receipt
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
    assert.deepEqual(outcome, { delivered: ["zweite@schule.de"], unreachable: ["erste@schule.de"] });
  });

  it("reports the failure on the same line a refused send uses", async () => {
    reset();
    await sendBewerbungMail({
      operation: "annehmenBewerbungAction",
      recipients: [empfaenger("erste@schule.de", "Trainer")],
      buildMail: buildMailThatThrowsFor("Trainer"),
    });

    const zeilen = logged.filter((eintrag) => eintrag.message === "bewerbung.mail_failed");
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0]?.meta.error_code, "FE-MAIL-002");
    /* The address stays off the stream, as it does for a refused send (`docs/logging/spec.md :: L9`). */
    assert.ok(!JSON.stringify(zeilen[0]).includes("erste@schule.de"));
  });
});
