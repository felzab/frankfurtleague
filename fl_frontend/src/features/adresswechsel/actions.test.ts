import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, it } from "node:test";

import { ADRESSWECHSEL_STOPPEN, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { readable } from "@/core/mailText.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered } from "@/shared/testing/publishedRefusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/** Work the real `after` would run behind the response, collected rather than run: no case here has a response. */
const deferred: (() => unknown)[] = [];
const NEXT_SERVER_DOUBLE = { after: (task: () => unknown) => void deferred.push(AsyncLocalStorage.bind(task)) };

/* The real actions, their mutations and the mailers, called: the request they run in, the backend
   client and the mailer are the doubles. */
const { setFresh, setSession } = doubleActionRequest();
const mail = doubleSendMail();
const AUTH_URL = "http://localhost:3000";
registerDoubles({
  modules: { "core/config.ts": { frontend_config: { AUTH_URL: AUTH_URL } } },
  specifiers: { "next/server": NEXT_SERVER_DOUBLE },
});

const ADRESSWECHSEL_ID = "68c1f0a2b3c4d5e6f7a8b9e0";
const BISHER = "lena@schule.example";
/** As the mint answers `GETIPPT`: the payload rule lower-cases the domain alone, and this spelling is the one mailed. */
const NEU = "Lena@neu.example";
const GETIPPT = "Lena@Neu.Example";
const GRUND = "Postfach von der Schule gelöscht, bestätigt am 21.10.2026";
const GENEHMIGER = "inhaberin@liga.example";

const START = "POST /adresswechsel";
const RESEND = "POST /adresswechsel/{adresswechsel_id}/einladen";
const DISCARD = "DELETE /adresswechsel/{adresswechsel_id}";
const APPROVAL = "POST /adresswechsel/{adresswechsel_id}/genehmigung";
const READ = "POST /adresswechsel/ansicht";

/** A start with a reason: the new mailbox is asked, and the address on file told with a stop link. */
const wartezeit = {
  acknowledged: 1,
  id: ADRESSWECHSEL_ID,
  weg: "wartezeit",
  token: "neu-token",
  stopp_token: "stopp-token",
  gueltig_bis: "2026-10-21T11:30:00Z",
  email: NEU,
  bisherige_email: BISHER,
  vorname: "Lena",
  adresse_belegt: false,
  genehmiger: [] as string[],
};
/** A start without one: nothing goes to the new mailbox before the address on file approves. */
const freigabe = { ...wartezeit, weg: "freigabe", token: null };
/** A re-send: the link alone, the stop link already in the mailbox of the address on file. */
const erneut = { ...wartezeit, stopp_token: null };

type Answer = () => unknown;
let antwort: Record<string, Answer>;

const client = doubleApiAnswers(async ({ endpoint, method }: ApiCall) => {
  if (endpoint.startsWith("/zustellung/")) return { acknowledged: 1, angewendet: true };
  const key =
    method === "DELETE"
      ? DISCARD
      : endpoint.endsWith("/einladen")
        ? RESEND
        : endpoint.endsWith("/genehmigung")
          ? APPROVAL
          : endpoint.endsWith("/ansicht")
            ? READ
            : START;
  const answer = await antwort[key]?.();
  if (answer instanceof Error) throw answer;
  return answer;
});

const {
  beantrageAdresswechselAction,
  einladeAdresswechselAction,
  genehmigeAdresswechselAction,
  readAdresswechselAnsichtAction,
  verwirfAdresswechselAction,
} = await import("./actions.ts");
const { mapGenehmigungRefusal, mapVerwaltungAnsichtRefusal, mapVerwaltungLinkRefusal, mapVerwaltungStartRefusal } =
  await import("./refusals.ts");
const { adresswechselLink } = await import("@/core/adresswechselEmail.ts");

const mailedTo = () => mail.sent.map(({ to }) => to);
const linkMail = () => mail.sent.find(({ to }) => to === NEU);
const hinweis = () => mail.sent.find(({ to }) => to === BISHER);
const backendCalls = () =>
  requestsOf(client.calls)
    .filter(({ endpoint }) => !endpoint.startsWith("/zustellung/"))
    .map(({ endpoint, method, body }) => [method, endpoint, body]);
const filedUnder = () =>
  requestsOf(client.calls)
    .filter(({ endpoint }) => endpoint.startsWith("/zustellung/"))
    .map(({ body }) => body as { ziel: string; ziel_id: string });
const message = (res: { success: boolean; message?: string }) => (res.success ? (res.message ?? "") : "");

beforeEach(() => {
  mail.sent.length = 0;
  client.calls.length = 0;
  deferred.length = 0;
  setFresh(true);
  mail.answerWith(() => "accepted");
  antwort = {
    [START]: () => wartezeit,
    [RESEND]: () => erneut,
    [DISCARD]: () => ({ acknowledged: 1, id: ADRESSWECHSEL_ID }),
    [APPROVAL]: () => ({ acknowledged: 1, id: ADRESSWECHSEL_ID, wirksam: false, mitteilung: null }),
  };
});

describe("an administrator's start of a change", () => {
  it("sends the address on file, the typed address and the reason, and mails the link to the one the mint names", async () => {
    const res = await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    assert.equal(res.success, true);
    assert.deepEqual(backendCalls(), [["POST", "/adresswechsel", { adresse: BISHER, email: GETIPPT, grund: GRUND }]]);
    // Never the typed spelling: the mint's own transaction is what says which mailbox the credential was made for.
    assert.deepEqual(mailedTo().sort(), [BISHER, NEU].sort());
    assert.match(message(res), /ging an Lena@neu\.example\..*gilt erst eine Woche nach ihrer Bestätigung\./);
  });

  /* The address on file asked first: a request in somebody else's name reaches the real holder before any link goes. */
  it("mails no link without a reason, only the request to the address on file, and files no delivery", async () => {
    antwort[START] = () => freigabe;

    const res = await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: null });

    assert.deepEqual(mailedTo(), [BISHER]);
    assert.deepEqual(res.success ? [res.versand, res.hinweis] : [res], [null, "gesendet"]);
    assert.match(message(res), /Die bisherige Adresse ist gebeten, die Änderung in ihrem Konto freizugeben/);
    assert.deepEqual(filedUnder(), [], "a request that sent no link filed a delivery for one");
  });

  /* The serving origin, never the production site (`docs/frontend/spec.md :: I186`), on the one link page. */
  it("puts the link and the stop link on the serving origin's link page, in both parts", async () => {
    await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    const url = adresswechselLink(AUTH_URL, "neu-token");
    const stopp = adresswechselLink(AUTH_URL, "stopp-token");
    const link = linkMail();
    const notice = hinweis();
    assert.ok(link?.text.includes(url) && link.html.includes(url), "a part of the link mail carries no link on the serving origin");
    assert.ok(notice?.text.includes(stopp) && notice.html.includes(stopp), "a part of the notice carries no stop link on the serving origin");
    assert.ok(notice?.html.includes(`>${ADRESSWECHSEL_STOPPEN}</a>`), "the notice's stop control is named otherwise");
  });

  it("tells the holder of a mistyped address the decline and what doing nothing costs", async () => {
    await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    const link = linkMail();
    for (const teil of [link?.text ?? "", link?.html ?? ""]) {
      assert.ok(teil.includes(`„${NICHT_MEINE_ADRESSE}“`), "a part names a decline the link page does not offer");
      assert.ok(teil.includes("Tust Du nichts, löschen wir sie, sobald der Link abgelaufen ist."), "a part says nothing of the removal");
    }
  });

  /* The change may be somebody's mistake or a pretext: the mailbox on file is owed the word, never the other mailbox's name;
     and the new mailbox has proved nothing, so a minor's first name goes to the mailbox on file alone. */
  it("names the new address to nobody but its own mailbox, which is greeted by no name", async () => {
    antwort[START] = () => ({ ...wartezeit, vorname: "Mirabel" });

    await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    const notice = hinweis();
    const link = linkMail();
    assert.ok(notice !== undefined && link !== undefined, "a mailbox was told nothing, so the case judges nothing");
    assert.ok(!`${notice.text}${notice.html}`.toLowerCase().includes(NEU.toLowerCase()), "the notice names the new address");
    for (const teil of [readable(notice.html), notice.text]) assert.match(teil, /Hallo Mirabel,/);
    for (const teil of [link.text, link.html]) assert.ok(!teil.includes("Mirabel"), "a part of the link mail names the person");
  });

  it("files the link's delivery under the change's own id", async () => {
    await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    assert.deepEqual(
      filedUnder().map(({ ziel, ziel_id }) => [ziel, ziel_id]),
      [["adresswechsel", ADRESSWECHSEL_ID]],
    );
  });

  /* The administrator's one sign of a pretext's target: the person's own start answers alike whatever the address holds. */
  it("warns the administrator where the new address already holds records of its own", async () => {
    antwort[START] = () => ({ ...wartezeit, adresse_belegt: true });

    const res = await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    assert.equal(res.success && res.adresseBelegt, true);
    assert.match(message(res), /Unter der neuen Adresse stehen schon Einträge bei der Liga\./);
  });

  /* A grant holder's change waits on another administrator, who is told one waits and never whose or to where. */
  it("tells each approver an approval waits, naming no address, with the way to the administrators page", async () => {
    antwort[START] = () => ({ ...wartezeit, genehmiger: [GENEHMIGER] });

    await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    const told = mail.sent.find(({ to }) => to === GENEHMIGER);
    assert.ok(told !== undefined, "the approver was told nothing");
    assert.ok(!/schule\.example|neu\.example/i.test(`${told.text}${told.html}`), "the approver's mail names an address of the change");
    assert.ok(told.text.includes(`${AUTH_URL}/bereich/admin/administratoren`), "the approver's mail leads elsewhere");
  });

  /* A withheld or barred link was filed rather than lost (`docs/frontend/spec.md :: I228`, `:: I542`). */
  it("reads a barred link as filed, naming no address, and a refused one as failed", async () => {
    mail.answerWith(({ to }) => (to === NEU ? "barred" : "accepted"));
    const barred = await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });
    mail.answerWith(({ to }) => (to === NEU ? "refused" : "accepted"));
    const refused = await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

    assert.equal(barred.success && barred.versand, "gesperrt");
    assert.doesNotMatch(message(barred), /@/);
    assert.equal(refused.success && refused.versand, "fehlgeschlagen");
    assert.match(message(refused), /Melde Dich selbst bei der Person/);
  });

  /* The tool grades its toast on it (`docs/frontend/spec.md :: I679`); a notice beside a saved write words its own
     doubt (`:: I372`), so the press is never answered as of unknown outcome for the notice alone. */
  for (const [outcome, hinweisVersand, satz] of [
    ["refused", "fehlgeschlagen", /Der Hinweis an die bisherige Adresse ging nicht raus\. Sag der Person selbst Bescheid\./],
    ["lost", "ungewiss", /Ob der Hinweis an die bisherige Adresse angekommen ist, ist unklar\. Sag der Person selbst Bescheid\./],
  ] as const) {
    it(`reports a notice to the address on file that ended ${hinweisVersand}, beside a link that went`, async () => {
      mail.answerWith(({ to }) => (to === BISHER ? outcome : "accepted"));

      const res = await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND });

      assert.deepEqual(res.success ? [res.versand, res.hinweis] : [res], ["gesendet", hinweisVersand]);
      assert.match(message(res), satz);
    });
  }

  it("answers every refusal the start publishes through its mapper, and mails nobody", async () => {
    await assertEachAnswered({
      operation: START,
      refuseWith: (next) => void (antwort[START] = next),
      act: () => beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: GRUND }),
      mapped: mapVerwaltungStartRefusal,
    });
    assert.deepEqual(mailedTo(), []);
  });

  /* The reason is kept with the log a year, where no redaction reaches it. */
  it("refuses an address in the reason before it sends anything", async () => {
    const res = await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: "Anfrage von mira@schule.de" });

    assert.equal(res.success ? undefined : res.fieldErrors?.grund, "Der Grund darf keine E-Mail-Adresse enthalten.");
    assert.deepEqual(client.calls, []);
  });
});

describe("the waiting change's two controls", () => {
  /* The stop link in the mailbox on file keeps working, so a fresh notice would only kill the one its holder may be pressing. */
  it("re-sends by the change's id to the new address alone, notices nobody, and says the earlier link is dead", async () => {
    const res = await einladeAdresswechselAction({ id: ADRESSWECHSEL_ID });

    assert.deepEqual(backendCalls(), [["POST", `/adresswechsel/${ADRESSWECHSEL_ID}/einladen`, undefined]]);
    assert.deepEqual(mailedTo(), [NEU]);
    assert.deepEqual(res.success ? [res.versand, res.hinweis] : [res], ["gesendet", null]);
    assert.match(message(res), /Der vorherige Link gilt nicht mehr\./);
  });

  it("discards by the change's id and mails nobody", async () => {
    const res = await verwirfAdresswechselAction({ id: ADRESSWECHSEL_ID });

    assert.deepEqual(res, { success: true, message: "Die Änderung ist verworfen. Die bisherige Adresse bleibt." });
    assert.deepEqual(backendCalls(), [["DELETE", `/adresswechsel/${ADRESSWECHSEL_ID}`, undefined]]);
    assert.deepEqual(mailedTo(), []);
  });

  for (const [operation, act] of [
    [RESEND, () => einladeAdresswechselAction({ id: ADRESSWECHSEL_ID })],
    [DISCARD, () => verwirfAdresswechselAction({ id: ADRESSWECHSEL_ID })],
  ] as const) {
    it(`answers every refusal ${operation} publishes through its mapper, and mails nobody`, async () => {
      await assertEachAnswered({
        operation,
        refuseWith: (next) => void (antwort[operation] = next),
        act,
        mapped: mapVerwaltungLinkRefusal,
      });
      assert.deepEqual(mailedTo(), []);
    });
  }
});

describe("another administrator's approval", () => {
  it("approves by the change's id, and says the access moves once the change takes effect", async () => {
    const res = await genehmigeAdresswechselAction({ id: ADRESSWECHSEL_ID });

    assert.deepEqual(backendCalls(), [["POST", `/adresswechsel/${ADRESSWECHSEL_ID}/genehmigung`, undefined]]);
    assert.match(message(res), /Der Zugang wechselt zur neuen Adresse, sobald sie bestätigt ist/);
    assert.deepEqual(mailedTo(), []);
    assert.deepEqual(deferred, [], "an approval that moved no grant announced one");
  });

  /* The approval was the last step: what the confirmation would owe is owed here, the grant's announcement behind the answer. */
  it("finishes a change it made take effect: the notice to the replaced address, and the grant's announcement behind the answer", async () => {
    antwort[APPROVAL] = () => ({
      acknowledged: 1,
      id: ADRESSWECHSEL_ID,
      wirksam: true,
      mitteilung: { bisherige_email: BISHER, email: NEU, vorname: "Lena", weg: "wartezeit" },
    });

    const res = await genehmigeAdresswechselAction({ id: ADRESSWECHSEL_ID });

    assert.match(message(res), /Die neue Adresse gilt jetzt, und der Zugang zur Verwaltung ist mit ihr gewechselt\./);
    assert.deepEqual(mailedTo(), [BISHER]);
    assert.equal(deferred.length, 1, "the moved grant scheduled no announcement, or more than one");
  });

  it("answers every refusal the approval publishes through its mapper, and announces nothing", async () => {
    await assertEachAnswered({
      operation: APPROVAL,
      refuseWith: (next) => void (antwort[APPROVAL] = next),
      act: () => genehmigeAdresswechselAction({ id: ADRESSWECHSEL_ID }),
      mapped: mapGenehmigungRefusal,
    });
    assert.deepEqual(deferred, []);
  });
});

describe("the tool's read", () => {
  it("answers every refusal the read publishes through its mapper", async () => {
    await assertEachAnswered({
      operation: READ,
      refuseWith: (next) => void (antwort[READ] = next),
      act: () => readAdresswechselAnsichtAction({ adresse: BISHER }),
      mapped: mapVerwaltungAnsichtRefusal,
      readOnly: true,
    });
  });
});

describe("the windows the writes are held to", () => {
  it("refuses the start, the re-send and the discard from a session past the step-up window, before writing or mailing", async () => {
    setFresh(false);

    for (const res of [
      await beantrageAdresswechselAction({ adresse: BISHER, email: GETIPPT, grund: null }),
      await einladeAdresswechselAction({ id: ADRESSWECHSEL_ID }),
      await verwirfAdresswechselAction({ id: ADRESSWECHSEL_ID }),
    ]) {
      assert.equal(Reflect.get(res, "stepUp"), true, "the refusal is not the step-up's");
    }
    assert.deepEqual(client.calls, []);
    assert.deepEqual(mailedTo(), []);
  });

  /* The approval hands a grant to another address, so it is held to the grant write's five minutes (`docs/frontend/spec.md :: I458`). */
  it("refuses the approval from a session confirmed six minutes ago, and sends it from one confirmed four minutes ago", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    setSession({ user: { email: "vorstand@example.org" } });
    // The doubled store stamps the session as it first serves it, which is now.
    assert.equal((await genehmigeAdresswechselAction({ id: ADRESSWECHSEL_ID })).success, true);

    t.mock.timers.tick(4 * 60 * 1000);
    assert.equal((await genehmigeAdresswechselAction({ id: ADRESSWECHSEL_ID })).success, true);

    client.calls.length = 0;
    t.mock.timers.tick(2 * 60 * 1000);
    const refused = await genehmigeAdresswechselAction({ id: ADRESSWECHSEL_ID });
    assert.equal(Reflect.get(refused, "stepUp"), true, "the refusal does not ask the page to confirm");
    assert.deepEqual(client.calls, [], "a stale session reached the backend");
  });
});
