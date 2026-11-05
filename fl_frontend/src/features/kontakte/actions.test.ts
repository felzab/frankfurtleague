import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { kenntnisnahme } from "@/test-support/kenntnisnahme.ts";
import { doubleOutbox } from "@/test-support/mailDouble.ts";
import { membershipAnswer } from "@/test-support/membershipFixtures.ts";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/* The real actions, their mutations and reads, called: the request, the backend client and the mailer are the doubles.
   The mailer's double also stills the drain behind the response, which the backend's Postausgang feeds: a write owing
   a link sends nothing itself. */
const { setFresh } = doubleActionRequest();
const mail = doubleOutbox();

const TEAM_ID = "6890a1b2c3d4e5f607182932";

/** What each endpoint answers in this case, returned or, where it is an `Error`, thrown. */
type Answer = () => unknown;
let save: Answer;
let resend: Answer;
let memberships: Answer;

function answerFor({ endpoint }: ApiCall): unknown {
  if (endpoint === "/teams/saisons") return memberships();
  return endpoint.endsWith("/confirmation/invite") ? resend() : save();
}

const client = doubleApiAnswers(async (call) => {
  const answer = answerFor(call);
  if (answer instanceof Error) throw answer;
  return answer;
});

const { einladeKontaktAction, patchSaisonTeamKontakteAction } = await import("./actions.ts");
const { refused } = await import("@/test-support/refusals.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");

/** A number per person: two seats sharing one are refused as one person entered twice. */
const TELEFON: Record<string, string> = { Anna: "069 501", Bernd: "069 502", Clara: "069 503" };

/** One seat as an administrator types it into the editor, under the running label. */
const seat = (vorname: string, email: string) => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: TELEFON[vorname] ?? "069 1234567",
  einwilligung: { scope: "kontaktdaten" as const, date: "2026-10-03" },
});

/** The same seat as the read model stores it, unconfirmed. */
const storedSeat = (vorname: string, email: string) => ({
  ...seat(vorname, email),
  geburtsdatum: null,
  einwilligung: kenntnisnahme({ ...seat(vorname, email).einwilligung, confirmed_at: null }),
});

const BLOCK = {
  trainer: seat("Clara", "clara@schule.example"),
  ansprechperson: seat("Anna", "anna@schule.example"),
  stellvertretung: seat("Bernd", "bernd@schule.example"),
  trainer_is_also: null,
};
const GESPEICHERT = {
  trainer: storedSeat("Clara", "clara@schule.example"),
  ansprechperson: storedSeat("Anna", "anna@schule.example"),
  stellvertretung: storedSeat("Bernd", "bernd@schule.example"),
  trainer_is_also: null,
};
const PAYLOAD = { team_id: TEAM_ID, saison_id: "2627", kontakte: BLOCK, kontakte_stand: "9f2c" };

/** The save's answer: the block as stored and each person it owed a link. */
const saved = (confirmations: unknown[]) => ({
  saison_id: "2627",
  team_id: TEAM_ID,
  kontakte: GESPEICHERT,
  confirmations: confirmations,
});

/** The club's membership read, holding `kontakte` for the season the payload names. */
const holding = (kontakte: unknown) => () => ({
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

beforeEach(() => {
  setFresh(true);
  save = () => saved([]);
  resend = () => ({ saison_id: "2627", team_id: TEAM_ID, confirmation: { rollen: ["stellvertretung"], email: "bernd@schule.example" } });
  memberships = holding(GESPEICHERT);
});

describe("the contacts save", () => {
  /* The addresses the write's own transaction read: a save landing between the page's read and this one moved a mailbox. */
  it("names every address the save owed a link, and mails nothing itself", async () => {
    save = () =>
      saved([
        { rollen: ["ansprechperson"], email: "anna@schule.example" },
        { rollen: ["trainer"], email: "clara@schule.example" },
      ]);

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success && res.versandSatz).toBe("Die Bestätigungslinks gehen an anna@schule.example und clara@schule.example.");
    expect(mail.sent).toStrictEqual([]);
  });

  it("says nothing of a link where the save owed none", async () => {
    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success && res.message).toBe("Kontakte gespeichert");
    expect(res.success && res.versandSatz).toBe(undefined);
  });

  /* The backend refuses the save whole, storing nobody: the administrator is told at the save, in
     a sentence naming no address and no seat, since the refusal names neither. */
  it("answers a save seating a barred address with the ban", async () => {
    save = () => refused("kontakt_seat_barred");

    const res = await patchSaisonTeamKontakteAction(PAYLOAD);

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/^Eine neu eingetragene E-Mail-Adresse steht auf der Sperrliste\. /);
    expect(res.success ? "" : res.error).not.toMatch(/@/);
  });
});

describe("a contacts save from a session past the step-up window", () => {
  /* Emptying a seat voids the link its person holds, which is a step-up write as much as a mint. */
  it("is refused where the draft empties a seat the row holds, reaching no write", async () => {
    setFresh(false);

    expect(await patchSaisonTeamKontakteAction({ ...PAYLOAD, kontakte: { ...BLOCK, stellvertretung: null } })).toStrictEqual(stepUpRequired());
    expect(
      requestsOf(client.calls).filter(({ method }) => method !== undefined && method !== "GET"),
      "the voiding write was sent for a session past the window",
    ).toStrictEqual([]);
  });

  /* The same people with a corrected telephone mint nothing, so the edit asks nothing. */
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
  it("presses its one endpoint and names the address the write owed the link, mailing nothing itself", async () => {
    const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

    expect(res.success && res.message).toBe("Der Bestätigungslink geht an bernd@schule.example. Der vorherige Link gilt nicht mehr.");
    expect(requestsOf(client.calls).filter(({ endpoint }) => endpoint.endsWith("/confirmation/invite"))).toStrictEqual([
      { endpoint: `/teams/${TEAM_ID}/saisons/2627/kontakte/stellvertretung/confirmation/invite`, method: "POST", body: undefined },
    ]);
    expect(mail.sent).toStrictEqual([]);
  });

  /* Every call owes a bearer link, so the declaration is the action's: refused before its body. */
  it("is refused from a session past the window before it reaches the endpoint", async () => {
    setFresh(false);

    expect(await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" })).toStrictEqual(stepUpRequired());
    expect(client.calls).toStrictEqual([]);
  });

  for (const [code, fragment] of [
    // „Rolle“, the word every screen names a contact seat by.
    ["kontakt_seat_without_confirmation", /^Für diese Rolle steht keine Bestätigung mehr aus\. Lade die Seite neu\.$/],
    ["kontakt_seat_barred", /Sperrliste/],
    // A reload, the one action left: the reloaded editor offers no send on such a row.
    ["kontakt_row_without_saison", /Saison ist vorbei oder das Team ist ausgetreten\. Lade die Seite neu, um den aktuellen Stand zu sehen\./],
  ] as const) {
    it(`words ${code} beside the seat`, async () => {
      resend = () => refused(code);

      const res = await einladeKontaktAction({ team_id: TEAM_ID, saison_id: "2627", rolle: "stellvertretung" });

      expect(res.success).toBe(false);
      expect(res.success ? "" : res.error).toMatch(fragment);
    });
  }
});
