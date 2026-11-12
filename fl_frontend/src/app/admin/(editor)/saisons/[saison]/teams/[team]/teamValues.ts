import type { FLTeamMembership, FLTeamRecord } from "@/core/generated/client/types";

/**
 * What the team editor's boxes hold, each as the text typed or the choice's id, an absent value an empty box: the club
 * and its address, and its group and colour in the season the page stands under.
 */
export type TeamValues = {
  name: string;
  shorthand: string;
  full_name: string;
  schulform: string;
  website_url: string;
  description: string;
  street: string;
  house_number: string;
  postcode: string;
  district: string;
  city: string;
  gruppe: string;
  trikot_farbe: string;
};

/** The editor's values as a stored club and its season's row give them; a retired club holding no row shows its own alone. */
export function valuesOf(team: FLTeamRecord, membership: FLTeamMembership | null): TeamValues {
  const { street, house_number, postcode, district, city } = team.address;
  return {
    name: team.name,
    shorthand: team.shorthand,
    full_name: team.full_name,
    schulform: team.schulform ?? "",
    website_url: team.website_url ?? "",
    description: team.description,
    street,
    house_number,
    postcode,
    district,
    city,
    gruppe: membership?.gruppe ?? "",
    trikot_farbe: membership?.trikot_farbe ?? "",
  };
}
