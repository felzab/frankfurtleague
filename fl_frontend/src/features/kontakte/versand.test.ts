import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { einwilligungAnswer, publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions, mailer and message builder, called: the request, the backend client and the mail
   transport are the doubles. A file of its own: `actions.test.ts` replaces this slice's actions module
   for the components it renders. */
const { setFresh } = doubleActionRequest();
const mail = doubleSendMail();
// The origin the link is minted on, which the real config reads from an environment this run has not got.
const ORIGIN = "http://localhost:3000";
registerDoubles({ modules: { "core/config.ts": { frontend_config: { AUTH_URL: ORIGIN } } } });

/** The label the backend runs on the application form, off the registry it generated. */
const FORM_LABEL = publishedLaufendeFassung("bewerbung").text_version;

const TEAM_ID = "6890a1b2c3d4e5f607182932";
const SAISON_TEAM_ID = "6890a1b2c3d4e5f6071f0001";

/** What each endpoint answers in this case, returned or, where it is an `Error`, thrown. */
type Answer = () => unknown;
let save: Answer;
let resend: Answer;
let memberships: Answer;
const zustellung: Record<string, unknown>[] = [];

function answerFor({ endpoint, body }: ApiCall): unknown {
  if (endpoint === "/einwilligung/seiten") return einwilligungAnswer(endpoint);
  if (endpoint.startsWith("/zustellung/")) {
    zustellung.push(JSON.parse(body ?? "{}") as Record<string, unknown>);
    return { acknowledged: 1, angewendet: true };
  }
  if (endpoint === "/teams/memberships") return memberships();
  return endpoint.endsWith("/bestaetigung/einladen") ? resend() : save();
}

const client = doubleApiAnswers(async (call) => {
  const answer = answerFor(call);
  if (answer instanceof Error) throw answer;
  return answer;
});

const { einladeKontaktAction, patchSaisonTeamKontakteAction } = await import("./actions.ts");
const { describeLinkMail } = await import("@/features/schiedsrichter/notifications.ts");
const { kontaktBestaetigungsLink } = await import("@/core/kontaktLink.ts");
const { ZURUECKGEHALTEN } = await import("@/features/einladungen/meldungen.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { outcomeUnknown } = await import("@/shared/utils/actionError.ts");

const aRefusal = (serverErrorCode: string, statusCode = 409) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/teams",
    statusCode,
    serverErrorCode,
    endpoint: "/teams",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** A number per person: two seats sharing one are refused as one person entered twice. */
const TELEFON: Record<string, string> = { Anna: "069 501", Bernd: "069 502", Clara: "069 503" };

/** One seat as an administrator types it into the editor, under the running label. */
const sitz = (vorname: string, email: string) => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: TELEFON[vorname] ?? "069 1234567",
  einwilligung: { umfang: "kontaktdaten" as const, text_version: FORM_LABEL, datum: "2026-10-03" },
});

/** The same seat as the read model stores it, unconfirmed. */
const gespeichert = (vorname: string, email: string) => ({
  ...sitz(vorname, email),
  geburtsdatum: null,
  einwilligung: {
    ...sitz(vorname, email).einwilligung,
    erfasst_von: "administrativ" as const,
    bestaetigt_am: null,
    medien: false,
    eingetragen_von: null,
    nachweis: { umfang: null, medien: null },
  },
});

const BLOCK = {
  trainer: sitz("Clara", "clara@schule.example"),
  ansprechperson: sitz("Anna", "anna@schule.example"),
  stellvertretung: sitz("Bernd", "bernd@schule.example"),
  trainer_ist_zugleich: null,
};
const GESPEICHERT = {
  trainer: gespeichert("Clara", "clara@schule.example"),
  ansprechperson: gespeichert("Anna", "anna@schule.example"),
  stellvertretung: gespeichert("Bernd", "bernd@schule.example"),
  trainer_ist_zugleich: null,
};
const PAYLOAD = { team_id: TEAM_ID, saison_id: "2627", kontakte: BLOCK, kontakte_stand: "9f2c" };

/** A link minted for one person, as each minting write answers it, on an open row unless `zeile` names a closed one. */
const minted = (vorname: string, email: string, rollen: string[], token = `token-${vorname}`, zeile = "offen") => ({
  token,
  rollen,
  email,
  vorname,
  schule: "Lessing-Kolleg",
  frist: "2026-10-17",
  zeile,
});

/** The save's answer: the block as stored and the links it minted. */
const saved = (bestaetigungen: unknown[]) => ({
  acknowledged: 1,
  saison_id: "2627",
  team_id: TEAM_ID,
  saison_team_id: SAISON_TEAM_ID,
  kontakte: GESPEICHERT,
  kontakte_stand: "a1b2",
  bestaetigungen,
});

/** The club's membership read, holding `kontakte` for the season the payload names. */
const holding = (kontakte: unknown) => () => ({
  acknowledged: 1,
  teams: [
    {
      id: TEAM_ID,
      name: "Lessing-Kolleg",
      shorthand: "LK",
      full_name: "Lessing-Kolleg Frankfurt",
      description: "",
      website_url: null,
      schulform: null,
      inactive_since: null,
      address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
      memberships: [{ saison_id: "2627", gruppe: "A", austritt: null, trikot_farbe: null, kontakte: kontakte, kontakte_stand: "9f2c" }],
    },
  ],
});

/** Every message the mailer was handed, as its address and the seats its tags name. */
const mailed = () => mail.sent.map(({ to, tags }) => ({ to, rollen: tags?.rollen, ziel: tags?.ziel, zielId: tags?.ziel_id }));

beforeEach(() => {
  setFresh(true);
  zustellung.length = 0;
  save = () => saved([]);
  resend = () => ({
    acknowledged: 1,
    saison_id: "2627",
    team_id: TEAM_ID,
    saison_team_id: SAISON_TEAM_ID,
    bestaetigung: minted("Bernd", "bernd@schule.example", ["stellvertretung"]),
  });
  memberships = holding(GESPEICHERT);
});

describe("the contacts save that seats new people", () => {
  /* A closed row's newcomer is minted a link whose page takes the Widerspruch alone, so the message
     asks no confirmation. The mint names the row's state, read in its own transaction. */
  for (const [zustand, zeile, grund] of [
    ["a season that is over", "saison_vorbei", /Die Saison ist vorbei/],
    ["a team that has left the season", "ausgetreten", /Das Team spielt in dieser Saison nicht mehr mit/],
  ] as const) {
    it(`mails a person seated on ${zustand} the Widerspruch alone, asking no confirmation`, async () => {
      save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"], "token-Anna", zeile)]);

      await patchSaisonTeamKontakteAction(PAYLOAD);

      assert.equal(mail.sent.length, 1);
      assert.match(mail.sent[0]?.text ?? "", grund);
      assert.doesNotMatch(mail.sent[0]?.text ?? "", /Bitte bestätige/);
    });
  }

  it("asks a person seated on an open row to confirm", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);

    await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.match(mail.sent[0]?.text ?? "", /Bitte bestätige, dass das stimmt:/);
  });

  /* The mint carries the row's state, so a save reads nothing after the write to word its mail: a second
     read could disagree with the mint where the season closed between the two. */
  it("words a minting save's mail from the mint alone, reading no list after the write", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"], "token-Anna", "saison_vorbei")]);

    await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.match(mail.sent[0]?.text ?? "", /Die Saison ist vorbei/);
    assert.deepEqual(
      client.calls.filter(({ endpoint }) => endpoint === "/saisons/list/admin"),
      [],
    );
  });

  /* One message per minted link and no other: a second message to a person spends nothing but trust,
     and a link with none sits in the database alone, the seat never confirming. */
  it("mails one message per link the save minted, to the address each mint names", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"]), minted("Clara", "clara@schule.example", ["trainer"])]);

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.equal(res.success, true);
    assert.deepEqual(mailed(), [
      { to: "anna@schule.example", rollen: "ansprechperson", ziel: "kontakt", zielId: SAISON_TEAM_ID },
      { to: "clara@schule.example", rollen: "trainer", ziel: "kontakt", zielId: SAISON_TEAM_ID },
    ]);
    assert.ok(mail.sent[0]?.text.includes(kontaktBestaetigungsLink(ORIGIN, "token-Anna")), "the message carries no link to its own token");
    assert.ok(!mail.sent[0]?.text.includes("token-Clara"), "one person's message carries another's token");
    assert.equal(res.success && res.versandSatz, "Die Bestätigungslinks gingen an 2 Personen.");
  });

  /* A paired Trainer is one person on two seats: one link, one message, naming both seats so a bounce
     reaches both their records. */
  it("mails a person holding two seats once, naming both seats", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson", "trainer"])]);

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.deepEqual(mailed(), [{ to: "anna@schule.example", rollen: "ansprechperson-trainer", ziel: "kontakt", zielId: SAISON_TEAM_ID }]);
    assert.match(mail.sent[0]?.subject ?? "", /^Du bist als Ansprechperson und Trainer.* für Lessing-Kolleg eingetragen$/);
    assert.equal(res.success && res.versandSatz, describeLinkMail("anna@schule.example", "gesendet"));
  });

  it("records the accepted send against the seats the message covered", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson", "trainer"])]);

    await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.deepEqual(
      zustellung.map(({ ziel, ziel_id, rollen }) => ({ ziel, ziel_id, rollen })),
      [{ ziel: "kontakt", ziel_id: SAISON_TEAM_ID, rollen: ["ansprechperson", "trainer"] }],
    );
  });

  it("mails nothing and says nothing of a link where the save minted none", async () => {
    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.deepEqual(mail.sent, []);
    assert.equal(res.success && res.message, "Kontakte gespeichert");
    assert.equal(res.success && res.versandSatz, undefined);
  });

  /* The backend refuses the save whole, storing nobody: the administrator is told at the save, in
     a sentence naming no address and no seat, since the refusal names neither (`docs/frontend/spec.md :: I542`). */
  it("answers a save seating a barred address with the ban, mailing nobody", async () => {
    save = () => aRefusal("REQ-KONTAKT-003");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.deepEqual(mail.sent, []);
    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /^Eine neu eingetragene E-Mail-Adresse steht auf der Sperrliste\. /);
    assert.doesNotMatch(res.success ? "" : res.error, /@/);
  });

  /* Barred between the mint and the send, the gate withholds it: filed, never failed, and no delivery
     state recorded on the seat (`docs/frontend/spec.md :: I542`). */
  it("files a send the gate withholds as barred, recording no delivery state", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);
    mail.answerWith(() => "barred");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.equal(res.success && res.versandSatz, describeLinkMail("anna@schule.example", "gesperrt"));
    assert.equal(res.success && res.versandFehlgeschlagen, false);
    assert.deepEqual(zustellung, []);
  });

  it("marks a link that did not leave, so the editor grades its toast a warning", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);
    mail.answerWith(() => "refused");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.equal(res.success && res.versandSatz, describeLinkMail("anna@schule.example", "fehlgeschlagen"));
    assert.equal(res.success && res.versandFehlgeschlagen, true);
  });

  /* Outside production every send is withheld, and a warning there grades every local save as failed. */
  it("says a withheld send once, in the deployment's words, and marks no failure", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"]), minted("Clara", "clara@schule.example", ["trainer"])]);
    mail.answerWith(() => "withheld");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    assert.equal(res.success && res.versandSatz, ZURUECKGEHALTEN);
    assert.equal(res.success && res.versandFehlgeschlagen, false);
  });

  it("answers a save whose link broke off in transit as of unknown outcome", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);
    mail.answerWith(() => "lost");

    assert.deepEqual(await patchSaisonTeamKontakteAction(PAYLOAD), outcomeUnknown());
  });
});

/* A seat handed to another person is a new acceptance, admitted under the running label alone; the
   label the editor's page held may be one a deploy has since moved past (`docs/backend/spec.md :: I866`). */
describe("the label a contacts save names", () => {
  it("sends every seat under the label the form runs at the write, whatever label the page held", async () => {
    const alt = (person: typeof BLOCK.trainer) => ({
      ...person,
      einwilligung: { ...person.einwilligung, text_version: "eine-fruehere-fassung" },
    });

    await patchSaisonTeamKontakteAction({
      ...PAYLOAD,
      kontakte: { ...BLOCK, trainer: alt(BLOCK.trainer), stellvertretung: alt(BLOCK.stellvertretung) },
    });

    const [write] = requestsOf(client.calls).filter(({ method }) => method !== undefined);
    assert.deepEqual(write?.body, { kontakte: BLOCK, kontakte_stand: PAYLOAD.kontakte_stand });
  });

  it("reads no label for a save clearing the block", async () => {
    await patchSaisonTeamKontakteAction({ ...PAYLOAD, kontakte: null });

    assert.equal(
      client.calls.some(({ endpoint }) => endpoint === "/einwilligung/seiten"),
      false,
    );
  });
});

describe("a contacts save from a session past the step-up window", () => {
  /* A save that may seat somebody new mints a bearer link, so the passkey is asked before the write. */
  it("is refused where the draft seats a person the row does not hold, reaching no write", async () => {
    setFresh(false);
    memberships = holding({ ...GESPEICHERT, stellvertretung: null });

    assert.deepEqual(await patchSaisonTeamKontakteAction(PAYLOAD), stepUpRequired());
    assert.deepEqual(
      requestsOf(client.calls).filter(({ method }) => method !== undefined),
      [],
      "the write was sent for a session past the window",
    );
  });

  /* Emptying a seat voids the link its person holds, which is a step-up write as much as a mint. */
  it("is refused where the draft empties a seat the row holds, reaching no write", async () => {
    setFresh(false);

    assert.deepEqual(await patchSaisonTeamKontakteAction({ ...PAYLOAD, kontakte: { ...BLOCK, stellvertretung: null } }), stepUpRequired());
    assert.deepEqual(
      requestsOf(client.calls).filter(({ method }) => method !== undefined),
      [],
      "the voiding write was sent for a session past the window",
    );
  });

  /* The same people with a corrected telephone mint nothing, so the edit keeps its undo and asks nothing. */
  it("is let through where every seat keeps its person", async () => {
    setFresh(false);

    const res = await patchSaisonTeamKontakteAction({
      ...PAYLOAD,
      kontakte: { ...BLOCK, trainer: { ...BLOCK.trainer, telefon: "069 7654321" } },
    });

    assert.notDeepEqual(res, stepUpRequired());
    assert.equal(res.success, true);
  });

  /* The backend judges by its own read and may still refuse at the window's edge; the spine answers that as its own. */
  it("answers the backend's own step-up refusal as the spine's", async () => {
    setFresh(false);
    save = () => aRefusal("REQ-AUTH-009", 401);

    assert.deepEqual(await patchSaisonTeamKontakteAction(PAYLOAD), stepUpRequired());
  });
});

describe("the re-send beside an unconfirmed seat", () => {
  it("mints once, mails exactly one link, and reports it in the referee's words", async () => {
    const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

    assert.equal(res.success && res.message, describeLinkMail("bernd@schule.example", "gesendet"));
    assert.deepEqual(
      requestsOf(client.calls).filter(({ endpoint }) => endpoint.endsWith("/bestaetigung/einladen")),
      [{ endpoint: `/teams/${TEAM_ID}/saisons/2627/kontakte/stellvertretung/bestaetigung/einladen`, method: "POST", body: undefined }],
    );
    assert.deepEqual(mailed(), [{ to: "bernd@schule.example", rollen: "stellvertretung", ziel: "kontakt", zielId: SAISON_TEAM_ID }]);
  });

  /* Every call mints a bearer link, so the declaration is the action's: refused before its body. */
  it("is refused from a session past the window before it reaches the endpoint", async () => {
    setFresh(false);

    assert.deepEqual(await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" }), stepUpRequired());
    assert.deepEqual(client.calls, []);
    assert.deepEqual(mail.sent, []);
  });

  for (const [code, fragment] of [
    // „Rolle“, the word every screen names a contact seat by.
    ["REQ-KONTAKT-002", /^Für diese Rolle steht keine Bestätigung mehr aus\. Lade die Seite neu\.$/],
    ["REQ-KONTAKT-003", /Sperrliste/],
    // A reload, the one action left: the reloaded editor offers no send on such a row.
    ["REQ-KONTAKT-005", /Saison ist vorbei oder das Team ist ausgetreten\. Lade die Seite neu, um den aktuellen Stand zu sehen\./],
  ] as const) {
    it(`words ${code} beside the seat, and mails nothing`, async () => {
      resend = () => aRefusal(code);

      const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

      assert.equal(res.success, false);
      assert.match(res.success ? "" : res.error, fragment);
      assert.deepEqual(mail.sent, []);
    });
  }

  it("says so where the link did not leave", async () => {
    mail.answerWith(() => "refused");

    const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

    assert.equal(res.success && res.message, describeLinkMail("bernd@schule.example", "fehlgeschlagen"));
  });
});

/** Every key at every depth of an action's result, which is what reaches the administrator's browser. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

describe("what an action of this slice hands the browser", () => {
  /* A raw token is the seat's whole credential: one in an action's result lets whoever holds the
     administrator's session confirm the seat as its person (`docs/backend/spec.md :: I142`). */
  it("carries no minted link's token at any depth, from the save or the re-send", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"]), minted("Clara", "clara@schule.example", ["trainer"])]);

    const results = [
      await patchSaisonTeamKontakteAction(PAYLOAD),
      await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" }),
    ];

    assert.ok(
      results.every(({ success }) => success),
      "an action failed, so the scan below reads a refusal",
    );
    assert.equal(mail.sent.length, 3, "the actions minted nothing to leak");
    for (const result of results) {
      assert.ok(!keysOf(result).includes("token"), `a result carries a token: ${JSON.stringify(result)}`);
      assert.ok(!JSON.stringify(result).includes("token-"), "a result carries a token's value under another key");
    }
  });
});
