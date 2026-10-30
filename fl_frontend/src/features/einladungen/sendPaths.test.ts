import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { doubleSendMail } from "@/test-support/mailDouble.ts";
import { refused } from "@/test-support/refusals.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

/* The real client reaches a backend no test process runs, so it is replaced; what each press is told is read off the
   endpoint's answer, the mails themselves being the backend's to owe. */
const CONFIG = { frontend_config: { AUTH_URL: "https://liga.example.de" } };
/** What the client answers in this case, whichever endpoint the action reads. */
let apiAnswer: (endpoint: string) => unknown = () => undefined;
const calls = doubleApiClient(({ endpoint }) => apiAnswer(endpoint));
/** The club list the action reads, which each case names. */
let sendTeams: () => unknown = () => undefined;
const TEAMS = { getTeamMemberships: async () => sendTeams() };

// `drainSoon` a no-op, as the double makes it in every suite: the mails are the backend's to owe and the drain's to send.
doubleSendMail();
doubleActionRequest();

vi.doMock("@/core/config.ts", () => CONFIG);
vi.doMock("@/features/teams/queries.ts", () => TEAMS);

const { mailEinladungAction, postEinladungVersandAction } = await import("./actions.ts");

const SAISON_ID = "2627";
const TEAM_ID = "a".repeat(24);
const EINLADUNG_ID = "b".repeat(24);

const empfaenger = (email: string) => ({ rolle: "trainer", vorname: "Erika", email: email });

const teamsHolding = (kontakte: unknown) => () => ({
  teams: [{ id: TEAM_ID, name: "Ernst-Reuter-Schule", memberships: [{ saison_id: SAISON_ID, kontakte: kontakte }] }],
});

const press = () => mailEinladungAction({ team_id: TEAM_ID, saison_id: SAISON_ID, einladung_id: EINLADUNG_ID });

const sentence = (res: { success: boolean; message?: string; error?: string }): string => res.message ?? res.error ?? "";

beforeEach(() => {
  calls.length = 0;
  sendTeams = teamsHolding({ trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null });
});

describe("what the single invite press answers", () => {
  it("names how many addresses the link is owed to, off the endpoint's own answer", async () => {
    apiAnswer = () => ({ einladung_id: EINLADUNG_ID, empfaenger: [empfaenger("jonas@beispiel.de"), empfaenger("erika@beispiel.de")] });

    const res = await press();

    expect(res.success).toBe(true);
    expect(sentence(res)).toBe("Der Link ist an alle 2 Adressen unterwegs.");
    expect(calls.map((call) => JSON.parse(call.body ?? "null"))).toStrictEqual([{ einladung_id: EINLADUNG_ID }]);
  });

  it("refuses a team holding no contact block before anything is owed", async () => {
    sendTeams = teamsHolding(null);

    const res = await press();

    expect(res.success).toBe(false);
    expect(calls).toStrictEqual([]);
  });

  it("refuses where nobody has confirmed a seat, the endpoint having owed nobody", async () => {
    apiAnswer = () => ({ einladung_id: EINLADUNG_ID, empfaenger: [] });

    const res = await press();

    expect(res.success).toBe(false);
    expect(sentence(res)).toContain("Keine Kontaktperson dieses Teams hat ihre Daten bisher selbst bestätigt");
  });

  it("refuses an invite replaced since the panel read it, in the reload's words", async () => {
    apiAnswer = () => {
      throw refused("document_not_found");
    };

    const res = await press();

    expect(res.success).toBe(false);
    expect(sentence(res)).toContain("Dieser Link ist nicht mehr der offene Link dieses Teams");
  });
});

describe("what the season-wide press answers", () => {
  const zeile = (teamId: string, uebersprungen: string | null, adressen: string[]) => ({
    team_id: teamId,
    team_name: "Team",
    empfaenger: adressen.map(empfaenger),
    uebersprungen: uebersprungen,
    ersetzt_link: false,
    hatte_link: false,
  });

  it("counts the teams it reached over the teams it meant to write to, never those the rule passed over", async () => {
    apiAnswer = () => ({
      saison_id: SAISON_ID,
      zeilen: [
        zeile("1".repeat(24), null, ["a@b.de"]),
        zeile("2".repeat(24), "erzeugung_fehlgeschlagen", []),
        zeile("3".repeat(24), "keine_bestaetigte_kontaktperson", []),
      ],
    });

    const res = await postEinladungVersandAction({ id: SAISON_ID });

    assert(res.success);
    expect([res.erreicht, res.gemeint, sentence(res)]).toStrictEqual([1, 2, "Registrierungslinks gesendet: 1 von 2 Teams."]);
  });
});
