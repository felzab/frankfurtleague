import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { doubleSendMail } from "@/test-support/mailDouble.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import { APIBadStatusError } from "@/core/errors.ts";

import type { ApiCall } from "@/test-support/apiClientDouble.ts";
import type { MailOutcome } from "@/test-support/mailDouble.ts";

/** One line the pass wrote, as the logger was handed it. */
type Line = { level: string; event: string; fields: unknown };

const lines: Line[] = [];

const record =
  (level: string) =>
  (event: string, ...rest: unknown[]): void =>
    void lines.push({ level, event, fields: rest.at(-1) });
const LOGGING_DOUBLE = { logger: { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") } };
const CONFIG_DOUBLE = { frontend_config: { AUTH_URL: "http://localhost:3000", LOG_FORMAT: "console" } };

vi.doMock("@/core/logging.ts", () => LOGGING_DOUBLE);
vi.doMock("@/core/config.ts", () => CONFIG_DOUBLE);

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
  urheber: "anwendung",
  jetzt: { adresse: "neu@schule.de", verwaltung: "administration" },
  vorher: null,
  geaendert_von: "vorstand@schule.de",
  geaendert_von_gesperrt: false,
  geaendert_am: "2026-09-27T01:00:00Z",
  gesperrt: false,
  geloescht: false,
  aufgegeben: false,
  an: null,
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

/** What the stamp throws, where a case says the backend refused it. */
let stampFails: Error | null = null;

const calls = doubleApiClient((call: ApiCall, schema) => {
  if (call.endpoint === "/berechtigungen/abgleich") {
    return (holdClaim ?? Promise.resolve()).then(() => {
      if (claim instanceof Error) throw claim;
      return schema.parse(claim);
    });
  }

  if (stampFails !== null) return Promise.reject(stampFails);
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
  stampFails = null;
});

describe("one pass over the claimed changes", () => {
  /* An address change waiting on an approval is told to whoever could give it alone, naming nobody, once per claim. */
  it("mails an address change's approval notice to its own recipients alone, naming no address, then stamps it", async () => {
    claim = claimOf([
      aenderung({ art: "adresswechsel", jetzt: null, vorher: null, geaendert_von: "lena@schule.de", an: ["inhaber@schule.de"] }),
    ]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map(({ to, subject }) => [to, subject])).toStrictEqual([
      ["inhaber@schule.de", "Eine Adressänderung wartet auf Deine Genehmigung"],
    ]);
    expect(`${mail.sent[0]?.text}${mail.sent[0]?.html}`, "the notice names who started the change").not.toMatch(/lena@schule\.de/);
    assert.ok(mail.sent[0]?.text.includes("http://localhost:3000/bereich/admin/administratoren"), "the notice leads elsewhere");
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  it("stamps an address change's notice that nobody could approve any more, mailing nobody", async () => {
    claim = claimOf([aenderung({ art: "adresswechsel", jetzt: null, vorher: null, an: [] })]);

    await runBerechtigungenAbgleich();

    expect(mail.sent).toStrictEqual([]);
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* Mail, then stamp: stamping first would mark as told a change nobody was told of. */
  it("mails every holder and the address granted once each, then stamps the row under the claim", async () => {
    claim = claimOf([aenderung({ jetzt: { adresse: "vorstand@schule.de", verwaltung: "administration" } })]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to).sort(), "a holder named twice was mailed twice").toStrictEqual([...HOLDERS].sort());
    // The tag the delivery report reads, or a holder the notice missed would be recorded nowhere.
    assert.ok(mail.sent.every((sent) => sent.tags?.["berechtigung"] === "hinweis"));
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* A removed address is in no grant, so it is on no holder list: it is mailed off its own change. */
  it("mails the address a revoke removed beside the holders", async () => {
    claim = claimOf([aenderung({ art: "entzogen", jetzt: null, vorher: { adresse: "alt@schule.de", verwaltung: "administration" } })]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to).sort()).toStrictEqual(["alt@schule.de", ...HOLDERS].sort());
    assert.ok(mail.sent.every((sent) => sent.text.includes("alt@schule.de hat keinen Zugang zur Verwaltung mehr.")));
  });

  /* A barred address leaves the ban list on no route: the answer withholds it, and the pass mails
     only the holders, telling them a barred address was granted. */
  it("mails a barred address nothing, and names it to nobody", async () => {
    claim = claimOf([
      aenderung({
        jetzt: { adresse: null, verwaltung: "administration" },
        gesperrt: true,
        urheber: "datenbank",
        geaendert_von: null,
        geaendert_am: null,
      }),
    ]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to).sort()).toStrictEqual([...HOLDERS].sort());
    assert.ok(mail.sent.every((sent) => sent.text.includes("Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung.")));
    assert.ok(mail.sent.every((sent) => sent.text.includes("direkt in der Datenbank")));
    // Told in full: a send attempted to the withheld address fails, and leaves the row for every later pass.
    expect(lines).toStrictEqual([]);
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  it("mails the holders alone for a revoke of a barred address, and names it to nobody", async () => {
    claim = claimOf([aenderung({ art: "entzogen", jetzt: null, vorher: { adresse: null, verwaltung: "administration" }, gesperrt: true })]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to).sort()).toStrictEqual([...HOLDERS].sort());
    assert.ok(mail.sent.every((sent) => sent.text.includes("Eine gesperrte Adresse hat keinen Zugang zur Verwaltung mehr.")));
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* The erasure's own notice, as a person erasing themselves leaves it: the address and its maker both
     withheld, neither barred. Read off the null alone, it tells every holder of a ban nobody entered. */
  it("mails the holders alone for an erased person's grant, naming nobody and no ban", async () => {
    claim = claimOf([
      aenderung({
        art: "entzogen",
        jetzt: null,
        vorher: { adresse: null, verwaltung: "owner" },
        geloescht: true,
        geaendert_von: ERASED_ACTOR_MARKER,
      }),
    ]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to).sort()).toStrictEqual([...HOLDERS].sort());
    for (const sent of mail.sent) {
      assert.ok(
        sent.text.includes("Eine nicht genannte Adresse ist nicht mehr Inhaberin oder Inhaber der Verwaltung und hat keinen Zugang mehr."),
      );
      assert.ok(sent.text.includes("Geändert von einer nicht genannten Adresse"));
      assert.ok(!sent.text.includes("gesperrt"), "an erased person is told as barred");
      assert.ok(!sent.text.includes(ERASED_ACTOR_MARKER), "the marker reached the notice");
    }
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* The takeover a holder of the database's credentials would make: one grant's address edited from A
     to B, answered as A's removal and B's grant. Every holder, B among them, is told both; A its own loss. */
  it("tells an address repointed in the database as the old address's loss and the new one's grant", async () => {
    const DATENBANK = { urheber: "datenbank", geaendert_von: null, geaendert_am: null };
    claim = claimOf(
      [
        aenderung({ art: "entzogen", jetzt: null, vorher: { adresse: "opfer@schule.de", verwaltung: "administration" }, ...DATENBANK }),
        aenderung({ id: OUTBOX_B, jetzt: { adresse: "angreifer@schule.de", verwaltung: "administration" }, ...DATENBANK }),
      ],
      { empfaenger: [...HOLDERS, "angreifer@schule.de"] },
    );

    await runBerechtigungenAbgleich();

    const texte = (an: string): string[] => mail.sent.filter((sent) => sent.to === an).map((sent) => sent.text);
    const VERLUST = "opfer@schule.de hat keinen Zugang zur Verwaltung mehr.";
    const ZUGANG = "angreifer@schule.de hat jetzt Zugang zur Verwaltung.";
    for (const an of ["angreifer@schule.de", ...HOLDERS]) {
      const [verlust, zugang] = texte(an);
      assert.ok(verlust?.includes(VERLUST), `${an} was not told who lost access`);
      assert.ok(zugang?.includes(ZUGANG), `${an} was not told who gained it`);
    }
    expect(texte("opfer@schule.de").map((text) => text.includes(VERLUST))).toStrictEqual([true]);
    assert.ok(
      mail.sent.every((sent) => !sent.text.includes("Inhaber")),
      "a repoint was told as a change of tier",
    );
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A, OUTBOX_B] }]);
  });

  it("tells an `owner` grant made in the database as the owner's", async () => {
    claim = claimOf([
      aenderung({ jetzt: { adresse: "neu@schule.de", verwaltung: "owner" }, urheber: "datenbank", geaendert_von: null, geaendert_am: null }),
    ]);

    await runBerechtigungenAbgleich();

    assert.ok(mail.sent.length > 0);
    assert.ok(mail.sent.every((sent) => sent.text.includes("neu@schule.de hat jetzt Zugang zur Verwaltung als Inhaberin oder Inhaber.")));
  });

  it("tells a change of tier as the tier the address now holds", async () => {
    claim = claimOf([
      aenderung({
        art: "geaendert",
        jetzt: { adresse: "vorstand@schule.de", verwaltung: "owner" },
        vorher: { adresse: "vorstand@schule.de", verwaltung: "administration" },
        urheber: "datenbank",
        geaendert_von: null,
        geaendert_am: null,
      }),
    ]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to).sort()).toStrictEqual([...HOLDERS].sort());
    assert.ok(mail.sent.every((sent) => sent.text.includes("vorstand@schule.de ist jetzt Inhaberin oder Inhaber der Verwaltung.")));
  });

  /* An owner's tier change made on the grants page: the address keeps its access, and the acting owner who made
     the change is named, never „direkt in der Datenbank“. */
  it("tells a demotion made in the application as the tier the address leaves, naming the owner who made it", async () => {
    claim = claimOf([
      aenderung({
        art: "geaendert",
        jetzt: { adresse: "vorstand@schule.de", verwaltung: "administration" },
        vorher: { adresse: "vorstand@schule.de", verwaltung: "owner" },
        geaendert_von: "inhaber@schule.de",
      }),
    ]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to).sort()).toStrictEqual([...HOLDERS].sort());
    for (const { text } of mail.sent) {
      assert.ok(text.includes("vorstand@schule.de ist nicht mehr Inhaberin oder Inhaber der Verwaltung und behält den Zugang."));
      assert.ok(text.includes("Geändert von inhaber@schule.de"));
      assert.ok(!text.includes("direkt in der Datenbank"));
    }
  });

  /* The case round 3 split out: a null actor on a change made in the application is a barred administrator. */
  it("tells a barred administrator's change as theirs, never as a database edit", async () => {
    claim = claimOf([aenderung({ geaendert_von: null, geaendert_von_gesperrt: true })]);

    await runBerechtigungenAbgleich();

    assert.ok(mail.sent.length > 0);
    assert.ok(mail.sent.every((sent) => sent.text.includes("Geändert von einer gesperrten Adresse")));
    assert.ok(mail.sent.every((sent) => !sent.text.includes("direkt in der Datenbank")));
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

    expect(new Set(first).size, "two recipients share one key").toBe(first.length);
    expect(second, "the same row mailed again carries other keys").toStrictEqual(first);
    assert.ok(
      first.every((key) => key?.startsWith(`berechtigung_${OUTBOX_A}_`)),
      "a key is not the row's",
    );
  });

  /* A request goes to whoever could approve it: neither every holder, its requester among them, nor the address it is
     for, which holds no grant. */
  it("mails a request to its own recipients alone, and stamps it", async () => {
    claim = claimOf([aenderung({ art: "beantragt", an: ["inhaber@schule.de"] })]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to)).toStrictEqual(["inhaber@schule.de"]);
    assert.ok(mail.sent[0]?.text.includes("Für neu@schule.de ist ein Zugang zur Verwaltung beantragt."));
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* A request's end goes to its requester alone, whom the claim names in `an`, under the request's own subject, and
     names nobody who acted. */
  it("mails a request's end to its requester alone, naming the address asked about, and stamps it", async () => {
    claim = claimOf([aenderung({ art: "antrag_abgelehnt", geaendert_von: "anna@schule.de", an: ["anna@schule.de"] })]);

    await runBerechtigungenAbgleich();

    expect(mail.sent.map(({ to, subject }) => [to, subject])).toStrictEqual([["anna@schule.de", "Antrag auf Zugang zur Verwaltung"]]);
    assert.ok(mail.sent[0]?.text.includes("Dein Antrag auf Zugang zur Verwaltung für neu@schule.de wurde abgelehnt."));
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  it("words an address change's end of a promotion, a withheld address by its state", async () => {
    claim = claimOf([
      aenderung({ art: "antrag_beendet", jetzt: { adresse: null, verwaltung: "owner" }, gesperrt: true, an: ["anna@schule.de"] }),
    ]);

    await runBerechtigungenAbgleich();

    assert.ok(
      mail.sent[0]?.text.includes(
        "Dein Antrag, eine gesperrte Adresse zur Inhaberin oder zum Inhaber der Verwaltung zu ernennen, endete, weil sich die Adresse geändert hat.",
      ),
      String(mail.sent[0]?.text),
    );
  });

  /* Decided, lapsed or approved by nobody since: the claim answers it to nobody, and it is stamped unmailed. */
  it("stamps a request nobody can approve any more, mailing nobody", async () => {
    claim = claimOf([aenderung({ art: "beantragt", an: [] })]);

    await runBerechtigungenAbgleich();

    expect(mail.sent).toStrictEqual([]);
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
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

    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
    assert.ok(
      lines.some(
        (line) =>
          line.event === "berechtigung.notice_failed" &&
          JSON.stringify(line.fields) === JSON.stringify({ error_code: "FE-MAIL-009", name: "APINetworkError" }),
      ),
      "the lost send left no line, or one carrying more than its name",
    );
  });

  /* The next claim mails the row again, and only to whom the last pass missed: past the provider's day
     its keys collapse nothing, and a holder told twice learns nothing but noise. */
  it("mails a later pass's row only to the recipients an earlier pass missed", async () => {
    claim = claimOf([aenderung()]);
    const lost: MailOutcome = "lost";
    mail.answerWith((sent) => (sent.to === "vorstand@schule.de" ? lost : "accepted"));
    await runBerechtigungenAbgleich();
    expect(stamps(), "a row with a send that may yet land was stamped").toStrictEqual([]);

    mail.sent.length = 0;
    mail.answerWith(() => "accepted");
    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to)).toStrictEqual(["vorstand@schule.de"]);
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
  });

  /* An erasure committing between two passes withholds the row's address: keyed on the row alone, the later pass's
     send is refused, and the recipient the first pass lost stays untold. */
  it("mails a body an erasure rewrote between two passes under a key of its own, which the provider takes", async () => {
    const ROW = "6890a1b2c3d4e5f6071a0003";
    const angenommen = new Map<string, string>();
    // The provider's rule for a reused key, the request that broke off having reached it: one body collapses, another is
    // refused (https://resend.com/docs/api-reference/errors, read 2026-10-16, the source moving without us).
    const wieDerAnbieter =
      (sonst: (sent: { to: string }) => MailOutcome) =>
      (sent: { to: string; subject: string; html: string; text: string; idempotencyKey?: string }): MailOutcome => {
        const body = JSON.stringify([sent.to, sent.subject, sent.html, sent.text]);
        const frueher = angenommen.get(sent.idempotencyKey ?? "");
        if (frueher !== undefined) return frueher === body ? "accepted" : { refused: 409, providerErrorName: "invalid_idempotent_request" };
        angenommen.set(sent.idempotencyKey ?? "", body);
        return sonst(sent);
      };
    claim = claimOf([aenderung({ id: ROW })]);
    mail.answerWith(wieDerAnbieter((sent) => (sent.to === "vorstand@schule.de" ? "lost" : "accepted")));
    await runBerechtigungenAbgleich();

    claim = claimOf([aenderung({ id: ROW, jetzt: { adresse: null, verwaltung: "administration" }, geloescht: true })]);
    mail.sent.length = 0;
    lines.length = 0;
    mail.answerWith(wieDerAnbieter(() => "accepted"));
    await runBerechtigungenAbgleich();

    expect(mail.sent.map((sent) => sent.to)).toStrictEqual(["vorstand@schule.de"]);
    assert.ok(mail.sent[0]?.text.includes("Eine nicht genannte Adresse"), "the later pass mailed the body as the first pass read it");
    expect(
      lines.filter((line) => line.event === "berechtigung.notice_failed"),
      "the provider refused the later pass's send",
    ).toStrictEqual([]);
    expect(stamps().at(-1), "the row the recipient was told of stays unstamped").toStrictEqual({ beanspruchung: "claim-1", ids: [ROW] });
  });

  /* The backend counts a row's claims, so no count of this process's own gives a row up: one that did
     would restart at every deploy, and a second instance would give up on its own schedule. */
  it("keeps a row the claim has not given up, however many passes this process spent on it", async () => {
    claim = claimOf([aenderung()]);
    const lost: MailOutcome = "lost";
    mail.answerWith((sent) => (sent.to === "vorstand@schule.de" ? lost : "accepted"));

    for (let pass = 1; pass <= 30; pass += 1) await runBerechtigungenAbgleich();

    expect(stamps(), "the pass gave a row up the backend still hands out").toStrictEqual([]);
    expect(mail.sent.filter((sent) => sent.to === "inhaber@schule.de").length, "a recipient told once was mailed again").toBe(1);
  });

  /* A row no pass can finish is claimed every lease for ever: once the claim gives it up it is stamped out
     of the outbox unmailed, and the line says, by count alone, how many were never told. */
  it("stamps a row the claim gives up unmailed, under a louder line counting who was never told", async () => {
    const AUFGEGEBEN = "6890a1b2c3d4e5f6071a00ff";
    claim = claimOf([aenderung({ id: AUFGEGEBEN })]);
    const lost: MailOutcome = "lost";
    mail.answerWith((sent) => (sent.to === "vorstand@schule.de" ? lost : "accepted"));
    await runBerechtigungenAbgleich();
    expect(stamps(), "a row with a send that may yet land was stamped").toStrictEqual([]);

    mail.sent.length = 0;
    claim = claimOf([aenderung({ id: AUFGEGEBEN, aufgegeben: true })]);
    await runBerechtigungenAbgleich();

    expect(mail.sent, "a given-up row was mailed").toStrictEqual([]);
    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [AUFGEGEBEN] }]);
    expect(lines.filter((line) => line.event === "berechtigung.notice_abandoned").map((line) => [line.level, line.fields])).toStrictEqual([
      ["ERROR", { error_code: "FE-MAIL-011", art: "erteilt", nicht_erreicht: 1 }],
    ]);
  });

  /* A stack that mails nothing counts the change as told, or it would claim the same rows forever; the
     mailer has logged it, so the pass adds no line. A domain with no ASCII form fails that address alone. */
  it("counts a withheld send and an address no send can reach as told", async () => {
    claim = claimOf([aenderung()]);
    mail.answerWith((sent) => (sent.to === "inhaber@schule.de" ? "withheld" : sent.to === "neu@schule.de" ? "recipient" : "accepted"));

    await runBerechtigungenAbgleich();

    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
    expect(lines.map((line) => [line.level, line.event, line.fields])).toStrictEqual([
      ["ERROR", "berechtigung.notice_failed", { error_code: "FE-MAIL-009", name: "MailRecipientError" }],
    ]);
  });

  /* A barred address is as told as the league may make it: held for it, the change would be claimed
     for as long as the ban stands. The gate's own line records it, so the pass adds none. */
  it("counts a send the ban list kept as told, and adds no line", async () => {
    claim = claimOf([aenderung()]);
    mail.answerWith((sent) => (sent.to === "inhaber@schule.de" ? "barred" : "accepted"));

    await runBerechtigungenAbgleich();

    expect(stamps()).toStrictEqual([{ beanspruchung: "claim-1", ids: [OUTBOX_A] }]);
    expect(lines).toStrictEqual([]);
  });

  /* A refusal of the key, the domain, the sender or the request refuses every send alike, and the
     provider names none that concerns one address: stamped, the change would be told to nobody. */
  it("leaves a change the provider refused for good, and logs each refusal", async () => {
    claim = claimOf([aenderung()]);
    mail.answerWith(() => ({ refused: 403, providerErrorName: "validation_error" }));

    await runBerechtigungenAbgleich();

    expect(stamps()).toStrictEqual([]);
    assert.ok(lines.length > 0 && lines.every((line) => line.level === "ERROR" && line.event === "berechtigung.notice_failed"));
  });

  it("stamps nothing and mails nothing where the claim holds no change", async () => {
    await runBerechtigungenAbgleich();

    expect(mail.sent).toStrictEqual([]);
    expect(stamps()).toStrictEqual([]);
  });

  /* Nothing awaits a pass, so a throw would surface as an unhandled rejection with no line to read. */
  it("settles where the claim fails, logging the name alone", async () => {
    claim = new Error("the backend answered nothing");

    await runBerechtigungenAbgleich();

    expect(lines.map((line) => [line.event, line.fields])).toStrictEqual([
      ["berechtigung.abgleich_failed", { error_code: "FE-SWEEP-002", name: "Error" }],
    ]);
  });

  /* A refusal of the whole claim and a crash read alike by their name alone: the status and code tell them apart,
     and the trace finds the backend's own line. */
  it("carries a refused claim's status, code and trace", async () => {
    claim = new APIBadStatusError({
      message: "API returned a bad status.",
      url: "http://backend:8000",
      statusCode: 503,
      serverErrorCode: "DB-FAIL-001",
      endpoint: "/berechtigungen/abgleich",
      method: "POST",
      readOnly: false,
      traceId: "t".repeat(32),
    });

    await runBerechtigungenAbgleich();

    expect(lines.map((line) => [line.event, line.fields])).toStrictEqual([
      [
        "berechtigung.abgleich_failed",
        { error_code: "FE-SWEEP-002", name: "APIBadStatusError", status: 503, server_error_code: "DB-FAIL-001", trace_id: "t".repeat(32) },
      ],
    ]);
  });

  /* The rows stay held until the lease lapses and are mailed again under the same keys: the pass says so
     and settles, since nothing awaits it to catch a throw. */
  it("settles where the stamp fails, logging the name alone", async () => {
    claim = claimOf([aenderung()]);
    stampFails = new TypeError("fetch failed");

    await runBerechtigungenAbgleich();

    assert.ok(mail.sent.length > 0, "nothing was mailed, so no stamp was asked for");
    expect(lines.map((line) => [line.event, line.fields])).toStrictEqual([
      ["berechtigung.stempel_failed", { error_code: "FE-SWEEP-002", name: "TypeError" }],
    ]);
  });

  /* Once for a count that stands, not every five minutes while nobody repairs the row; again once it rises. */
  it("warns of rows no request can match once per count, counting them", async () => {
    for (const uebersprungen of [0, 2, 2, 3, 3]) {
      claim = claimOf([], { uebersprungen });
      await runBerechtigungenAbgleich();
    }

    expect(lines.map((line) => [line.level, line.event, line.fields])).toStrictEqual([
      ["WARN", "berechtigung.abgleich_uebersprungen", { error_code: "FE-SWEEP-002", anzahl: 2 }],
      ["WARN", "berechtigung.abgleich_uebersprungen", { error_code: "FE-SWEEP-002", anzahl: 3 }],
    ]);
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
    expect(claims(), "a second pass claimed beside the first").toBe(1);

    holdClaim = null;
    release();
    await first;

    expect(claims(), "the asks made while the first ran were dropped, or each ran a pass of its own").toBe(2);
  });
});
