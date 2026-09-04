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
// transport posts to the mail provider, on a key no test run holds, and the real logger writes past
// this file.
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

const { collectBewerbungEingangEmpfaenger, collectBewerbungEmpfaenger, describeBewerbungMail, rolleText, seatsByMailbox, sendBewerbungMail } =
  await import("./notifications.ts");
const { buildBewerbungBestaetigungEmail } = await import("../../core/bewerbungEmail.ts");
const { bestaetigungsLink } = await import("./bestaetigungLink.ts");

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
    einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "v1", datum: "2026-04-01", bestaetigt_am: "2026-04-02" },
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
  refused.clear();
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
    assert.deepEqual(outcome, { delivered: ["a@schule.de"], unreachable: [] });
  });

  /* `trainer_ist_zugleich` stores ONE person in two slots, so the same address stands twice in
     a perfectly ordinary application. */
  it("mails a person holding two seats once, naming both seats", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("trainer@schule.de", "trainer@schule.de", "vertretung@schule.de")), [
      { address: "trainer@schule.de", rollenText: "Ansprechperson und Trainerin oder Trainer" },
      { address: "vertretung@schule.de", rollenText: "Stellvertretung" },
    ]);
  });

  /* The seat is what the message tells its reader they were given, so a fan-out that lost it would
     send three people one text about somebody else's place in the season. */
  it("names each of the three the seat they hold", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("t@schule.de", "a@schule.de", "s@schule.de")), [
      { address: "a@schule.de", rollenText: "Ansprechperson" },
      { address: "s@schule.de", rollenText: "Stellvertretung" },
      { address: "t@schule.de", rollenText: "Trainerin oder Trainer" },
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
      { address: "trainer@schule.de", rollenText: "Ansprechperson und Trainerin oder Trainer" },
    ]);
  });

  /* And a local part is not: `Trainer` and `trainer` are the destination host's to tell apart, so
     dropping either would leave a person unnotified over an assumption nobody here may make. */
  it("keeps two local parts differing only in case apart", () => {
    assert.deepEqual(collectBewerbungEmpfaenger(seats("Trainer@schule.de", "trainer@schule.de", null)), [
      { address: "trainer@schule.de", rollenText: "Ansprechperson" },
      { address: "Trainer@schule.de", rollenText: "Trainerin oder Trainer" },
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
      { address: "kontakt@schule.de", rollenText: "Ansprechperson" },
    ]);
  });

  /* `trainer_ist_zugleich` puts one person in two seats. Deduplication is by ADDRESS, so that person
     gets the one message their mailbox is owed, naming both seats rather than one of them. */
  it("names both seats where the Ansprechperson is also the Trainer", () => {
    assert.deepEqual(collectBewerbungEingangEmpfaenger(seats("kontakt@schule.de", "kontakt@schule.de", "vertretung@schule.de")), [
      { address: "kontakt@schule.de", rollenText: "Ansprechperson und Trainerin oder Trainer" },
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
        seats: [
          { vorname: "Erika", rolleText: "Ansprechperson", link: "L-A" },
          { vorname: "Jonas", rolleText: "Trainerin oder Trainer", link: "L-T" },
        ],
      },
      { address: "mira@schule.de", seats: [{ vorname: "Mira", rolleText: "Stellvertretung", link: "L-S" }] },
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
      { address: "erika@schule.de", seats: [{ vorname: "Erika", rolleText: "Ansprechperson und Trainerin oder Trainer", link: "L-A" }] },
      { address: "mira@schule.de", seats: [{ vorname: "Mira", rolleText: "Stellvertretung", link: "L-S" }] },
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
    const eigener = bestaetigungsLink("erste");
    const gespiegelter = bestaetigungsLink("zweite");

    const verlinkt = seatsByMailbox(kontakte, { ansprechperson: "L-A", stellvertretung: eigener, trainer: gespiegelter });
    const gepaart = verlinkt.find((mailbox) => mailbox.address === "mira@schule.de");

    assert.deepEqual(gepaart?.seats, [{ vorname: "Mira", rolleText: "Stellvertretung und Trainerin oder Trainer", link: eigener }]);

    const mail = buildBewerbungBestaetigungEmail({
      saisonId: "2627",
      schule: "Lessing-Kolleg",
      seats: gepaart?.seats ?? [{ vorname: "Mira", rolleText: "Stellvertretung", link: eigener }],
      fristText: "30.09.2026",
    });

    // Both branches: a reader whose client draws no HTML meets the same one link in the text.
    for (const teil of [mail.html, mail.text]) {
      const adressen = new Set(
        [...teil.matchAll(/https?:\/\/[^"'<\s]+/g)].map((treffer) => treffer[0]).filter((url) => url.includes("bestaetigung")),
      );

      assert.deepEqual([...adressen], [eigener], "the message offers a second link for the seat the first one already answers");
      assert.match(teil, /Stellvertretung/, "the message no longer names the seat the person was entered under");
      assert.match(teil, /Trainerin oder Trainer/, "the message no longer names the seat the Trainer claim mirrors");
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
      { address: "erika@schule.de", seats: [{ vorname: "Mira", rolleText: "Stellvertretung", link: "L-S" }] },
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
