import { doubleActionRequest, loggedLines } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { einwilligungAnswer, publishedLaufendeFassung } from "@/test-support/einwilligungDocument.ts";
import { kenntnisnahme } from "@/test-support/kenntnisnahme.ts";
import { doubleSendMail } from "@/test-support/mailDouble.ts";
import { membershipAnswer } from "@/test-support/membershipFixtures.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/* The real actions, mailer and message builder, called: the request, the backend client and the mail
   transport are the doubles. */
const { setFresh } = doubleActionRequest();
const mail = doubleSendMail();
// The origin the link is minted on, which the real config reads from an environment this run has not got.
const ORIGIN = "http://localhost:3000";
vi.doMock("@/core/config.ts", () => ({ frontend_config: { AUTH_URL: ORIGIN } }));

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
const { refusedOn } = await import("@/test-support/publishedRefusals.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { outcomeUnknown } = await import("@/shared/utils/actionError.ts");

const SAVE_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte";
const RESEND_OPERATION = "POST /teams/{team_id}/saisons/{saison_id}/kontakte/{seat}/bestaetigung/einladen";

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
  einwilligung: kenntnisnahme({ ...sitz(vorname, email).einwilligung, bestaetigt_am: null }),
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
  schule: "Lessing-Kolleg",
  frist: "2026-10-17",
  zeile,
});

/** The save's answer: the block as stored, the links it minted and the mailboxes it took off the row. */
const saved = (bestaetigungen: unknown[], abgaenge: unknown[] = []) => ({
  acknowledged: 1,
  saison_id: "2627",
  team_id: TEAM_ID,
  saison_team_id: SAISON_TEAM_ID,
  kontakte: GESPEICHERT,
  kontakte_stand: "a1b2",
  bestaetigungen,
  abgaenge,
});

/** A mailbox the save took off the row, as the backend answers it. */
const abgang = (email: string, rollen: string[], bleibtAls: string[] = []) => ({
  rollen,
  email,
  schule: "Lessing-Kolleg",
  bleibt_als: bleibtAls,
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
      memberships: [membershipAnswer({ saison_id: "2627", kontakte: kontakte, kontakte_stand: "9f2c" })],
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

      expect(mail.sent.length).toBe(1);
      expect(mail.sent[0]?.text ?? "").toMatch(grund);
      expect(mail.sent[0]?.text ?? "").not.toMatch(/Bitte bestätige/);
    });
  }

  it("asks a person seated on an open row to confirm", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);

    await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(mail.sent[0]?.text ?? "").toMatch(/Bitte bestätige, dass das stimmt:/);
  });

  /* The mint carries the row's state, so a save reads nothing after the write to word its mail: a second
     read could disagree with the mint where the season closed between the two. */
  it("words a minting save's mail from the mint alone, reading no list after the write", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"], "token-Anna", "saison_vorbei")]);

    await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(mail.sent[0]?.text ?? "").toMatch(/Die Saison ist vorbei/);
    expect(client.calls.filter(({ endpoint }) => endpoint === "/saisons/list/admin")).toStrictEqual([]);
  });

  /* One message per minted link and no other: a second message to a person spends nothing but trust,
     and a link with none sits in the database alone, the seat never confirming. */
  it("mails one message per link the save minted, to the address each mint names", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"]), minted("Clara", "clara@schule.example", ["trainer"])]);

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success).toBe(true);
    expect(mailed()).toStrictEqual([
      { to: "anna@schule.example", rollen: "ansprechperson", ziel: "kontakt", zielId: SAISON_TEAM_ID },
      { to: "clara@schule.example", rollen: "trainer", ziel: "kontakt", zielId: SAISON_TEAM_ID },
    ]);
    assert.ok(mail.sent[0]?.text.includes(kontaktBestaetigungsLink(ORIGIN, "token-Anna")), "the message carries no link to its own token");
    assert.ok(!mail.sent[0]?.text.includes("token-Clara"), "one person's message carries another's token");
    expect(res.success && res.versandSatz).toBe("Die Bestätigungslinks gingen an 2 Personen.");
  });

  /* A paired Trainer is one person on two seats: one link, one message, naming both seats so a bounce
     reaches both their records. */
  it("mails a person holding two seats once, naming both seats", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson", "trainer"])]);

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(mailed()).toStrictEqual([{ to: "anna@schule.example", rollen: "ansprechperson-trainer", ziel: "kontakt", zielId: SAISON_TEAM_ID }]);
    expect(mail.sent[0]?.subject ?? "").toMatch(/^Du bist als Ansprechperson und Trainer.* für Lessing-Kolleg eingetragen$/);
    expect(res.success && res.versandSatz).toBe(describeLinkMail("anna@schule.example", "gesendet"));
  });

  it("records the accepted send against the seats the message covered", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson", "trainer"])]);

    await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(zustellung.map(({ ziel, ziel_id, rollen }) => ({ ziel, ziel_id, rollen }))).toStrictEqual([
      { ziel: "kontakt", ziel_id: SAISON_TEAM_ID, rollen: ["ansprechperson", "trainer"] },
    ]);
  });

  it("mails nothing and says nothing of a link where the save minted none", async () => {
    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(mail.sent).toStrictEqual([]);
    expect(res.success && res.message).toBe("Kontakte gespeichert");
    expect(res.success && res.versandSatz).toBe(undefined);
  });

  /* The backend refuses the save whole, storing nobody: the administrator is told at the save, in
     a sentence naming no address and no seat, since the refusal names neither (`docs/frontend/spec.md :: I542`). */
  it("answers a save seating a barred address with the ban, mailing nobody", async () => {
    save = () => refusedOn(SAVE_OPERATION, "REQ-KONTAKT-003");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(mail.sent).toStrictEqual([]);
    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/^Eine neu eingetragene E-Mail-Adresse steht auf der Sperrliste\. /);
    expect(res.success ? "" : res.error).not.toMatch(/@/);
  });

  /* Barred between the mint and the send, the gate withholds it: filed, never failed, and no delivery
     state recorded on the seat (`docs/frontend/spec.md :: I542`). */
  it("files a send the gate withholds as barred, recording no delivery state", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);
    mail.answerWith(() => "barred");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success && res.versandSatz).toBe(describeLinkMail("anna@schule.example", "gesperrt"));
    expect(res.success && res.versand).toBe("gesperrt");
    expect(zustellung).toStrictEqual([]);
  });

  it("reports a link that did not leave, so the editor grades its toast a warning", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);
    mail.answerWith(() => "refused");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success && res.versandSatz).toBe(describeLinkMail("anna@schule.example", "fehlgeschlagen"));
    expect(res.success && res.versand).toBe("fehlgeschlagen");
  });

  /* The editor grades the save's toast off this one field, so a failed link between one that went and one the ban
     kept back is the one reported: neither the first nor the last of them. */
  it("reports the worst of several links the save sent", async () => {
    save = () =>
      saved([
        minted("Anna", "anna@schule.example", ["ansprechperson"]),
        minted("Bernd", "bernd@schule.example", ["stellvertretung"]),
        minted("Clara", "clara@schule.example", ["trainer"]),
      ]);
    mail.answerWith(({ to }) =>
      to === "bernd@schule.example"
        ? "refused"
        : to === "clara@schule.example"
          ? "barred"
          : { accepted: "56761188-7520-42d8-8898-ff6fc54ce618" },
    );

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success && res.versand, "a save whose later link failed was graded by another link").toBe("fehlgeschlagen");
  });

  /* Outside production every send is withheld: filed by the deployment, never a failure of the mailbox. */
  it("says a withheld send once, in the deployment's words, and reports no failure", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"]), minted("Clara", "clara@schule.example", ["trainer"])]);
    mail.answerWith(() => "withheld");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success && res.versandSatz).toBe(ZURUECKGEHALTEN);
    expect(res.success && res.versand).toBe("zurueckgehalten");
  });

  it("answers a save whose link broke off in transit as of unknown outcome", async () => {
    save = () => saved([minted("Anna", "anna@schule.example", ["ansprechperson"])]);
    mail.answerWith(() => "lost");

    expect(await patchSaisonTeamKontakteAction(PAYLOAD)).toStrictEqual(outcomeUnknown());
  });
});

describe("the contacts save that takes a mailbox off the row", () => {
  /* Its seat's delivery record describes the seat's next holder, or nobody, so a record written for this message would
     describe the wrong person. */
  it("tells it once, naming no person and carrying no control, on the lane no record holds", async () => {
    save = () =>
      saved([minted("Anna", "anna@schule.example", ["ansprechperson"])], [abgang("dora@schule.example", ["ansprechperson", "trainer"])]);

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success).toBe(true);
    const notice = mail.sent.find(({ to }) => to === "dora@schule.example");
    expect(notice?.tags).toStrictEqual({ kontakt_abgang: "hinweis" });
    expect(notice?.subject).toBe("Du bist nicht mehr als Ansprechperson und Trainerin oder Trainer für Lessing-Kolleg eingetragen");
    expect(notice?.text ?? "").toMatch(
      /in der Saison 2627 nicht mehr als Ansprechperson und Trainerin oder Trainer für Lessing-Kolleg eingetragen/,
    );
    // The two links the seat took with it and no more: the team's registration link still opens for the row.
    expect(notice?.text ?? "").toMatch(/Der Link zum Bestätigen dieses Eintrags und die Links zum Bestätigen von Spielterminen, die Du dafür/);
    expect(notice?.text ?? "").not.toMatch(/Meier|https?:\/\/\S*token/);
    expect(
      zustellung.map(({ ziel }) => ziel),
      "the notice was recorded on a seat as the newcomer's link is",
    ).toStrictEqual(["kontakt"]);
    expect(res.success && res.versandSatz, "the notice was reported as a link").toBe(describeLinkMail("anna@schule.example", "gesendet"));
  });

  /* The Trainer's pairing alone lets one mailbox hold two seats, and the seat it keeps keeps its links: told it left the row
     and its links died, the reader would take a live link for a dead one. */
  it("tells a mailbox still seated on the row which seat it keeps, and that its links stand", async () => {
    save = () => saved([], [abgang("dora@schule.example", ["ansprechperson"], ["trainer"])]);

    await patchSaisonTeamKontakteAction(PAYLOAD);

    const notice = mail.sent.find(({ to }) => to === "dora@schule.example");
    expect(notice?.subject).toBe("Du bist nicht mehr als Ansprechperson für Lessing-Kolleg eingetragen");
    expect(notice?.text ?? "").toMatch(/Nicht mehr als Ansprechperson eingetragen/);
    expect(notice?.text ?? "").toMatch(/Als Trainerin oder Trainer bleibst Du für Lessing-Kolleg eingetragen, dafür ändert sich nichts\./);
    expect(notice?.text ?? "").not.toMatch(/Nicht mehr als Kontaktperson|funktionieren nicht mehr/);
  });

  // The provider sends nothing for a key it holds from the last 24 hours, so a removal undone and saved again the same day
  // has to arrive under a key of its own.
  it("keys every save's notice afresh, so the same removal saved twice in a day is sent twice", async () => {
    save = () => saved([], [abgang("dora@schule.example", ["ansprechperson"])]);

    await patchSaisonTeamKontakteAction(PAYLOAD);
    await patchSaisonTeamKontakteAction(PAYLOAD);

    const keys = mail.sent.filter(({ to }) => to === "dora@schule.example").map(({ idempotencyKey }) => idempotencyKey);
    expect(keys.length).toBe(2);
    assert.ok(keys.every((key) => key !== undefined));
    expect(keys[0]).not.toBe(keys[1]);
  });

  // Filed as every lane no record holds files a send that did not leave, so a search for unsent messages finds it.
  it("is still a landed save where the notice could not leave, which logs it as an unsent message", async () => {
    save = () => saved([], [abgang("dora@schule.example", ["ansprechperson"])]);
    mail.answerWith(() => "refused");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success && res.message).toBe("Kontakte gespeichert");
    expect(
      loggedLines.filter(({ message }) => message === "kontakt.abgang_failed").map(({ meta }) => (meta as { error_code?: string }).error_code),
    ).toStrictEqual(["FE-MAIL-002"]);
  });
});

/* A seat handed to another person is a new acceptance, admitted under the running label alone; the
   label the editor's page held may be one a deploy has since moved past (`docs/backend/spec.md :: I610`). */
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
    expect(write?.body).toStrictEqual({ kontakte: BLOCK, kontakte_stand: PAYLOAD.kontakte_stand });
  });

  it("reads no label for a save clearing the block", async () => {
    await patchSaisonTeamKontakteAction({ ...PAYLOAD, kontakte: null });

    expect(client.calls.some(({ endpoint }) => endpoint === "/einwilligung/seiten")).toBe(false);
  });
});

describe("a contacts save from a session past the step-up window", () => {
  /* Emptying a seat voids the link its person holds, which is a step-up write as much as a mint. */
  it("is refused where the draft empties a seat the row holds, reaching no write", async () => {
    setFresh(false);

    expect(await patchSaisonTeamKontakteAction({ ...PAYLOAD, kontakte: { ...BLOCK, stellvertretung: null } })).toStrictEqual(stepUpRequired());
    expect(
      requestsOf(client.calls).filter(({ method }) => method !== undefined),
      "the voiding write was sent for a session past the window",
    ).toStrictEqual([]);
  });

  /* The same people with a corrected telephone mint nothing, so the edit keeps its undo and asks nothing. */
  it("is let through where every seat keeps its person", async () => {
    setFresh(false);

    const res = await patchSaisonTeamKontakteAction({
      ...PAYLOAD,
      kontakte: { ...BLOCK, trainer: { ...BLOCK.trainer, telefon: "069 7654321" } },
    });

    expect(res).not.toStrictEqual(stepUpRequired());
    expect(res.success).toBe(true);
  });
});

describe("the re-send beside an unconfirmed seat", () => {
  it("mints once, mails exactly one link, and reports it in the referee's words", async () => {
    const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

    expect(res.success && res.message).toBe(describeLinkMail("bernd@schule.example", "gesendet"));
    expect(requestsOf(client.calls).filter(({ endpoint }) => endpoint.endsWith("/bestaetigung/einladen"))).toStrictEqual([
      { endpoint: `/teams/${TEAM_ID}/saisons/2627/kontakte/stellvertretung/bestaetigung/einladen`, method: "POST", body: undefined },
    ]);
    expect(mailed()).toStrictEqual([{ to: "bernd@schule.example", rollen: "stellvertretung", ziel: "kontakt", zielId: SAISON_TEAM_ID }]);
  });

  /* Every call mints a bearer link, so the declaration is the action's: refused before its body. */
  it("is refused from a session past the window before it reaches the endpoint", async () => {
    setFresh(false);

    expect(await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" })).toStrictEqual(stepUpRequired());
    expect(client.calls).toStrictEqual([]);
    expect(mail.sent).toStrictEqual([]);
  });

  for (const [code, fragment] of [
    // „Rolle“, the word every screen names a contact seat by.
    ["REQ-KONTAKT-002", /^Für diese Rolle steht keine Bestätigung mehr aus\. Lade die Seite neu\.$/],
    ["REQ-KONTAKT-003", /Sperrliste/],
    // A reload, the one action left: the reloaded editor offers no send on such a row.
    ["REQ-KONTAKT-005", /Saison ist vorbei oder das Team ist ausgetreten\. Lade die Seite neu, um den aktuellen Stand zu sehen\./],
  ] as const) {
    it(`words ${code} beside the seat, and mails nothing`, async () => {
      resend = () => refusedOn(RESEND_OPERATION, code);

      const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

      expect(res.success).toBe(false);
      expect(res.success ? "" : res.error).toMatch(fragment);
      expect(mail.sent).toStrictEqual([]);
    });
  }

  it("says so where the link did not leave, and reports it so the control grades its toast a warning", async () => {
    mail.answerWith(() => "refused");

    const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

    expect(res.success && res.message).toBe(describeLinkMail("bernd@schule.example", "fehlgeschlagen"));
    expect(res.success && res.versand).toBe("fehlgeschlagen");
  });

  /* Filed rather than failed, as the save reports it (`docs/frontend/spec.md :: I542`). */
  it("reports no failure where the gate withholds a barred send", async () => {
    mail.answerWith(() => "barred");

    const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

    expect(res.success && res.versand).toBe("gesperrt");
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
    expect(mail.sent.length, "the actions minted nothing to leak").toBe(3);
    for (const result of results) {
      assert.ok(!keysOf(result).includes("token"), `a result carries a token: ${JSON.stringify(result)}`);
      assert.ok(!JSON.stringify(result).includes("token-"), "a result carries a token's value under another key");
    }
  });

  /* The page sent the block that held it, but a mailbox another administrator seated since is one this one never saw. */
  it("carries no address the save took off the row", async () => {
    save = () => saved([], [abgang("dora@schule.example", ["stellvertretung"])]);

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(mail.sent.length, "the save took nobody off, so the scan below reads nothing").toBe(1);
    assert.ok(!JSON.stringify(res).includes("dora@"), `the result carries the address the save took off: ${JSON.stringify(res)}`);
  });
});
