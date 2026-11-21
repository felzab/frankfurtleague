"use server";

import { z } from "zod";

import { action, blankIsNull } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { teamsPostTeamEntry } from "@/core/generated/client/sdk";
import { TeamsPostTeamEntryBody, TeamsPostTeamEntryParams } from "@/core/generated/zod/inputs";

import { NEW_TEAM } from "./newTeam";

import type { FLPostTeamEntryPayload } from "@/core/generated/client/types";

const { shape } = TeamsPostTeamEntryBody;
const [known, founded] = shape.team.options;
const team = founded.shape.team.shape;
const address = team.address.shape;

/** What every entry posts: the season its dialog stands over, and the club's group and colour in it. */
const ENTRY = {
  saison_id: TeamsPostTeamEntryParams.shape.saison_id,
  gruppe: shape.gruppe,
  trikot_farbe: blankIsNull(shape.trikot_farbe),
};

/**
 * The dialog's boxes by the names they post under, a new school's held to the entry's own published rules for each: the
 * club's select says which of the two forms it posted, `kind` read off its value as the write's own union names them.
 */
const EnterTeam = z.preprocess(
  (raw) => (typeof raw === "object" && raw !== null && "team" in raw ? { ...raw, kind: raw.team === NEW_TEAM ? "new" : "known" } : raw),
  z.discriminatedUnion("kind", [
    z.object({ ...ENTRY, kind: z.literal("known"), team: known.shape.team_id }),
    z.object({
      ...ENTRY,
      kind: z.literal("new"),
      name: team.name,
      shorthand: team.shorthand,
      full_name: team.full_name,
      schulform: blankIsNull(team.schulform),
      website_url: blankIsNull(team.website_url),
      street: address.street,
      house_number: address.house_number,
      postcode: address.postcode,
      district: address.district,
      city: address.city,
    }),
  ]),
);

type Entered = z.output<typeof EnterTeam>;

/** The write's club: the one picked, or the one the entry founds, its description left for its editor. */
function teamOf(entered: Entered): FLPostTeamEntryPayload["team"] {
  if (entered.kind === "known") return { kind: "known", team_id: entered.team };
  const { name, shorthand, full_name, schulform, website_url, street, house_number, postcode, district, city } = entered;
  return {
    kind: "new",
    team: {
      name,
      shorthand,
      full_name,
      schulform,
      website_url,
      description: "",
      address: { street, house_number, postcode, district, city },
    },
  };
}

/**
 * Enters a club into a planned season from the dialog over its list, founding it first where it is new, in one
 * transaction: a refused entry leaves no new club behind. A Kürzel another club holds, a retired one's included, and a
 * colour another row holds are refused on their boxes, and a club retired since the dialog opened on the status line. A
 * season gone live and a group filled since are a stale page.
 */
export const enterTeam = action({
  lane: "admin",
  name: "enterTeam",
  input: EnterTeam,
  boxes: ["shorthand", "trikot_farbe"],
  examples: {
    shorthand: COPY.team.shorthandExample,
    postcode: COPY.shared.address.postcodeExample,
    house_number: COPY.shared.address.houseNumberExample,
  },
  run: async (entered) => {
    const { saison_id, gruppe, trikot_farbe } = entered;
    await teamsPostTeamEntry(saison_id, { team: teamOf(entered), gruppe, trikot_farbe });
    return { ok: true, value: undefined };
  },
});
