"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox, PAGE_HOLDER } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import {
  teamsDeleteTeam,
  teamsPutAustritt,
  teamsPutKontaktSeat,
  teamsReactivateTeam,
  teamsResendKontaktConfirmation,
} from "@/core/generated/client/sdk";
import {
  TeamsDeleteTeamParams,
  TeamsPutAustrittBody,
  TeamsPutAustrittParams,
  TeamsPutKontaktSeatBody,
  TeamsPutKontaktSeatParams,
  TeamsReactivateTeamParams,
  TeamsResendKontaktConfirmationParams,
} from "@/core/generated/zod/inputs";

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
 * Records how a club left the season, which is never lifted, from the danger box's dialog: the write owes each opponent
 * their mail in its own transaction, and the confirmation sweep then closes what the exit ends and tells a booked referee.
 * A day before the season's start is refused on its box, though the dialog holds that floor itself.
 */
export const recordAustritt = action({
  lane: "admin",
  name: "recordAustritt",
  input: TeamsPutAustrittBody.extend(TeamsPutAustrittParams.shape),
  boxes: ["date"],
  run: async ({ team_id, saison_id, ...austritt }) => {
    await teamsPutAustritt(team_id, saison_id, austritt);
    return { ok: true, value: undefined };
  },
});

/**
 * „Sitz bearbeiten“, behind the passkey touch: writes the person one seat holds on the row's version the dialog read,
 * by the seat's state, and where the seat takes another person mails them a fresh link, the toast naming where it went.
 * The Trainer's box says which other seat they hold. An address or a number another seat's person holds is refused on
 * its box by the dry run, before the touch.
 */
export const writeSeat = action({
  lane: "admin",
  passkey: true,
  dryRun: true,
  name: "writeSeat",
  input: z.object({
    ...TeamsPutKontaktSeatParams.shape,
    first_name: TeamsPutKontaktSeatBody.shape.first_name,
    last_name: TeamsPutKontaktSeatBody.shape.last_name,
    email: TeamsPutKontaktSeatBody.shape.email,
    phone: TeamsPutKontaktSeatBody.shape.phone,
    trainer_is_also: blankIsNull(TeamsPutKontaktSeatBody.shape.trainer_is_also),
    version: numberBox(TeamsPutKontaktSeatBody.shape.version),
    ...PAGE_HOLDER,
  }),
  boxes: ["first_name", "last_name", "email", "phone"],
  examples: {
    first_name: COPY.shared.field.exampleFirstName,
    last_name: COPY.shared.field.exampleLastName,
    email: COPY.shared.field.exampleAddress,
    phone: COPY.shared.field.examplePhone,
  },
  // The holder is the touch's to judge, and no field of the seat's body.
  run: async ({ team_id, saison_id, seat, holder: _holder, ...person }, { dryRun }) => {
    const written = await teamsPutKontaktSeat(team_id, saison_id, seat, person, { dry_run: dryRun });
    // A passing dry run answers 204, which the client reads as no body: nothing was written to name.
    if (!written || written.email === null) return { ok: true, value: undefined };
    return { ok: true, value: undefined, note: ADMIN_COPY.schiedsrichter.sentTo(written.email) };
  },
});

/**
 * Mails a seat waiting on its answer a fresh link from its row, its old link void and its 14 days starting again.
 */
export const sendSeatLink = action({
  lane: "admin",
  name: "sendSeatLink",
  input: z.object(TeamsResendKontaktConfirmationParams.shape),
  run: async ({ team_id, saison_id, seat }) => {
    await teamsResendKontaktConfirmation(team_id, saison_id, seat);
    return { ok: true, value: undefined };
  },
});
