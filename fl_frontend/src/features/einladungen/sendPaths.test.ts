import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { doubleOutbox } from "@/test-support/mailDouble.ts";
import { refused } from "@/test-support/refusals.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* The real client reaches a backend no test process runs, so it is replaced; what each press is told is read off the
   endpoint's answer, the mails themselves being the backend's to owe. */
const CONFIG = { frontend_config: { AUTH_URL: "https://liga.example.de" } };
/** What the client answers in this case, whichever endpoint the action reads. */
let apiAnswer: (endpoint: string) => unknown = () => undefined;
const calls = doubleApiClient(({ endpoint }) => apiAnswer(endpoint));
/** The club list the action reads, which each case names. */
let sendTeams: () => unknown = () => undefined;
const TEAMS = { getTeamSaisons: async () => sendTeams() };

// The Postausgang doubled: the mails are the backend's to owe and the drain's to send.
doubleOutbox();
doubleActionRequest();

vi.doMock("@/core/config.ts", () => CONFIG);
vi.doMock("@/features/teams/queries.ts", () => TEAMS);

const { mailEinladungAction } = await import("./actions.ts");

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
  sendTeams = teamsHolding({ trainer: null, ansprechperson: null, stellvertretung: null, trainer_is_also: null });
});

describe("what the single invite press answers", () => {
  it("names how many addresses the link is owed to, off the endpoint's own answer", async () => {
    apiAnswer = () => ({ invitation_id: EINLADUNG_ID, recipient: [empfaenger("jonas@beispiel.de"), empfaenger("erika@beispiel.de")] });

    const res = await press();

    expect(res.success).toBe(true);
    expect(sentence(res)).toBe("Der Link ist an alle 2 Adressen unterwegs.");
    expect(calls.map((call): unknown => JSON.parse(call.body ?? "null"))).toStrictEqual([{ invitation_id: EINLADUNG_ID }]);
  });

  it("refuses a team holding no contact block before anything is owed", async () => {
    sendTeams = teamsHolding(null);

    const res = await press();

    expect(res.success).toBe(false);
    expect(calls).toStrictEqual([]);
  });

  it("refuses where nobody has confirmed a seat, the endpoint having owed nobody", async () => {
    apiAnswer = () => ({ invitation_id: EINLADUNG_ID, recipient: [] });

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
