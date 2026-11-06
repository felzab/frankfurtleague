"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { teamsDeleteTeam, teamsInviteKontakt, teamsPutAustritt, teamsPutKontaktSeat, teamsReactivateTeam } from "@/core/generated/client/sdk";
import {
  TeamsDeleteTeamParams,
  TeamsInviteKontaktParams,
  TeamsPutAustrittBody,
  TeamsPutAustrittParams,
  TeamsPutKontaktSeatBody,
  TeamsPutKontaktSeatParams,
  TeamsReactivateTeamParams,
} from "@/core/generated/zod/inputs";

const SEAT_EXAMPLES = { phone: COPY.admin.schiedsrichter.phoneExample };

/**
 * Takes the club out of the league from its editor's danger box: it stays on the seasons it played and no new season
 * offers it. The page closes the act while a running or planned season holds the club, so that refusal meets only a page
 * read before an entry.
 */
export const retireTeam = action({
  lane: "admin",
  name: "retireTeam",
  input: z.object({ id: TeamsDeleteTeamParams.shape.team_id }),
  run: async ({ id }) => {
    await teamsDeleteTeam(id);
    return { ok: true, value: undefined };
  },
});

/** Brings a retired club back into every season's choice. */
export const reactivateTeam = action({
  lane: "admin",
  name: "reactivateTeam",
  input: z.object({ id: TeamsReactivateTeamParams.shape.team_id }),
  run: async ({ id }) => {
    await teamsReactivateTeam(id);
    return { ok: true, value: undefined };
  },
});

/**
 * Records how a club left the season, which is never lifted, from the danger box's dialog: the write closes what the
 * exit ends and owes each opponent and booked referee their mail, in one transaction. A day before the season's start
 * is refused on its box, though the dialog holds that floor itself.
 */
export const recordAustritt = action({
  lane: "admin",
  name: "recordAustritt",
  input: TeamsPutAustrittBody.extend(TeamsPutAustrittParams.shape),
  ownWords: ["austritt_before_saison_start", "saison_past"],
  paths: { date: "date" },
  run: async ({ team_id, saison_id, ...austritt }) => {
    await teamsPutAustritt(team_id, saison_id, austritt);
    return { ok: true, value: undefined };
  },
});

/**
 * „Sitz bearbeiten“: writes the person one seat holds on the row's version the dialog read, by the seat's state, and
 * where the seat takes another person mails them a fresh link, the line naming where it went, the dialog then standing
 * open on it. The Trainer's box says which other seat they hold.
 */
export const writeSeat = action({
  lane: "admin",
  name: "writeSeat",
  input: z.object({
    ...TeamsPutKontaktSeatParams.shape,
    first_name: TeamsPutKontaktSeatBody.shape.first_name,
    last_name: TeamsPutKontaktSeatBody.shape.last_name,
    email: TeamsPutKontaktSeatBody.shape.email,
    phone: TeamsPutKontaktSeatBody.shape.phone,
    trainer_is_also: blankIsNull(TeamsPutKontaktSeatBody.shape.trainer_is_also),
    version: numberBox(TeamsPutKontaktSeatBody.shape.version),
  }),
  ownWords: ["kontakt_email_taken", "kontakt_phone_taken", "kontakt_seat_barred", "email_not_accepted"],
  paths: { email: "email", phone: "phone" },
  examples: SEAT_EXAMPLES,
  run: async ({ team_id, saison_id, seat, ...person }) => {
    const { email } = await teamsPutKontaktSeat(team_id, saison_id, seat, person);
    return email === null ? { ok: true, value: undefined } : { ok: true, value: undefined, note: COPY.admin.schiedsrichter.sentTo(email) };
  },
});

/**
 * Mails a seat waiting on its answer a fresh link from its row, its old link void and its 14 days starting again. An
 * address on the ban list, which the page cannot know, is refused in the list's own sentence.
 */
export const sendSeatLink = action({
  lane: "admin",
  name: "sendSeatLink",
  input: z.object(TeamsInviteKontaktParams.shape),
  ownWords: ["kontakt_seat_barred"],
  run: async ({ team_id, saison_id, seat }) => {
    await teamsInviteKontakt(team_id, saison_id, seat);
    return { ok: true, value: undefined };
  },
});
