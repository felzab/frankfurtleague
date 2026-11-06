import "server-only";

import { requires } from "@/core/action";
import {
  TeamsPatchTeamSaisonBody,
  teamsPatchTeamSaisonBodyAddressHausnummerMax,
  teamsPatchTeamSaisonBodyAddressPlzMax,
  teamsPatchTeamSaisonBodyAddressStadtMax,
  teamsPatchTeamSaisonBodyAddressStadtteilMax,
  teamsPatchTeamSaisonBodyAddressStrasseMax,
  teamsPatchTeamSaisonBodyDescriptionMax,
  teamsPatchTeamSaisonBodyFullNameMax,
  teamsPatchTeamSaisonBodyNameMax,
  teamsPatchTeamSaisonBodyWebsiteUrlOneMax,
  TeamsPostTeamEntryBody,
  teamsPostTeamEntryBodyClubTwoTeamAddressHausnummerMax,
  teamsPostTeamEntryBodyClubTwoTeamAddressPlzMax,
  teamsPostTeamEntryBodyClubTwoTeamAddressStadtMax,
  teamsPostTeamEntryBodyClubTwoTeamAddressStadtteilMax,
  teamsPostTeamEntryBodyClubTwoTeamAddressStrasseMax,
  teamsPostTeamEntryBodyClubTwoTeamFullNameMax,
  teamsPostTeamEntryBodyClubTwoTeamNameMax,
  teamsPostTeamEntryBodyClubTwoTeamWebsiteUrlOneMax,
  TeamsPutAustrittBody,
  teamsPutAustrittBodyReasonMax,
  TeamsPutKontaktSeatBody,
  teamsPutKontaktSeatBodyEmailMax,
  teamsPutKontaktSeatBodyFirstNameMax,
  teamsPutKontaktSeatBodyLastNameMax,
} from "@/core/generated/zod/inputs";

import type { AddressRules } from "@/kit/AddressFields";

/** What a write of a club asks of each box, read on the server so its schema never reaches the browser. */
export type TeamRules = {
  required: Readonly<Record<"name" | "shorthand" | "full_name", boolean>>;
  /** The season's row, which an editor of a retired club never sends. */
  gruppeRequired: boolean;
  max: Readonly<Record<"name" | "full_name" | "website_url", number>>;
  address: AddressRules;
};

type TeamShape = typeof TeamsPatchTeamSaisonBody.shape | (typeof TeamsPostTeamEntryBody.shape.club.options)[1]["shape"]["team"]["shape"];

const requiredOf = (shape: TeamShape): TeamRules["required"] => ({
  name: requires(shape.name, ""),
  shorthand: requires(shape.shorthand, ""),
  full_name: requires(shape.full_name, ""),
});

const addressRequiredOf = ({ address: { shape } }: TeamShape): AddressRules["required"] => ({
  strasse: requires(shape.strasse, ""),
  hausnummer: requires(shape.hausnummer, ""),
  plz: requires(shape.plz, ""),
  stadtteil: requires(shape.stadtteil, ""),
  stadt: requires(shape.stadt, ""),
});

const ENTERED = TeamsPostTeamEntryBody.shape.club.options[1].shape.team.shape;

/** The entry's rules, which „Team eintragen“ holds a new club's boxes to. */
export const TEAM_ENTRY_RULES: TeamRules = {
  required: requiredOf(ENTERED),
  gruppeRequired: requires(TeamsPostTeamEntryBody.shape.gruppe, ""),
  max: {
    name: teamsPostTeamEntryBodyClubTwoTeamNameMax,
    full_name: teamsPostTeamEntryBodyClubTwoTeamFullNameMax,
    website_url: teamsPostTeamEntryBodyClubTwoTeamWebsiteUrlOneMax,
  },
  address: {
    required: addressRequiredOf(ENTERED),
    maxLength: {
      strasse: teamsPostTeamEntryBodyClubTwoTeamAddressStrasseMax,
      hausnummer: teamsPostTeamEntryBodyClubTwoTeamAddressHausnummerMax,
      stadtteil: teamsPostTeamEntryBodyClubTwoTeamAddressStadtteilMax,
      stadt: teamsPostTeamEntryBodyClubTwoTeamAddressStadtMax,
    },
    plzLength: teamsPostTeamEntryBodyClubTwoTeamAddressPlzMax,
  },
};

/** The save's rules, which the team editor holds its boxes to. */
export const TEAM_SAVE_RULES: TeamRules = {
  required: requiredOf(TeamsPatchTeamSaisonBody.shape),
  gruppeRequired: requires(TeamsPatchTeamSaisonBody.shape.gruppe, ""),
  max: {
    name: teamsPatchTeamSaisonBodyNameMax,
    full_name: teamsPatchTeamSaisonBodyFullNameMax,
    website_url: teamsPatchTeamSaisonBodyWebsiteUrlOneMax,
  },
  address: {
    required: addressRequiredOf(TeamsPatchTeamSaisonBody.shape),
    maxLength: {
      strasse: teamsPatchTeamSaisonBodyAddressStrasseMax,
      hausnummer: teamsPatchTeamSaisonBodyAddressHausnummerMax,
      stadtteil: teamsPatchTeamSaisonBodyAddressStadtteilMax,
      stadt: teamsPatchTeamSaisonBodyAddressStadtMax,
    },
    plzLength: teamsPatchTeamSaisonBodyAddressPlzMax,
  },
};

/** Whether the entry asks for a club, its select posting an id or the new school's entry. */
export const TEAM_CLUB_REQUIRED = requires(TeamsPostTeamEntryBody.shape.club.options[0].shape.team_id, "");

/** The description's bound, the one box only the editor shows. */
export const TEAM_DESCRIPTION_MAX = teamsPatchTeamSaisonBodyDescriptionMax;

/** What „Sitz bearbeiten“ asks of each box. */
export const SEAT_RULES = {
  required: {
    first_name: requires(TeamsPutKontaktSeatBody.shape.first_name, ""),
    last_name: requires(TeamsPutKontaktSeatBody.shape.last_name, ""),
    email: requires(TeamsPutKontaktSeatBody.shape.email, ""),
    phone: requires(TeamsPutKontaktSeatBody.shape.phone, ""),
  },
  max: {
    first_name: teamsPutKontaktSeatBodyFirstNameMax,
    last_name: teamsPutKontaktSeatBodyLastNameMax,
    email: teamsPutKontaktSeatBodyEmailMax,
  },
};

export type SeatRules = typeof SEAT_RULES;

/** What the exit's dialog asks of each box. */
export const AUSTRITT_RULES = {
  required: {
    type: requires(TeamsPutAustrittBody.shape.type, ""),
    reason: requires(TeamsPutAustrittBody.shape.reason, ""),
    date: requires(TeamsPutAustrittBody.shape.date, null),
  },
  reasonMax: teamsPutAustrittBodyReasonMax,
};

export type AustrittRules = typeof AUSTRITT_RULES;
