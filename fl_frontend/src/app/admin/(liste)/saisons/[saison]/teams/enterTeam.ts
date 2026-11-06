"use server";

import { z } from "zod";

import { action, blankIsNull } from "@/core/action";
import { COPY } from "@/core/copy";
import { teamsPostTeamEntry } from "@/core/generated/client/sdk";
import { TeamsPostTeamEntryBody, TeamsPostTeamEntryParams } from "@/core/generated/zod/inputs";

import { NEW_CLUB } from "./newClub";

import type { FLPostTeamEntryPayload } from "@/core/generated/client/types";

const { shape } = TeamsPostTeamEntryBody;
const [known, founded] = shape.club.options;
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
  (raw) => (typeof raw === "object" && raw !== null && "club" in raw ? { ...raw, kind: raw.club === NEW_CLUB ? "new" : "known" } : raw),
  z.discriminatedUnion("kind", [
    z.object({ ...ENTRY, kind: z.literal("known"), club: known.shape.team_id }),
    z.object({
      ...ENTRY,
      kind: z.literal("new"),
      name: team.name,
      shorthand: team.shorthand,
      full_name: team.full_name,
      schulform: blankIsNull(team.schulform),
      website_url: blankIsNull(team.website_url),
      strasse: address.strasse,
      hausnummer: address.hausnummer,
      plz: address.plz,
      stadtteil: address.stadtteil,
      stadt: address.stadt,
    }),
  ]),
);

type Entered = z.output<typeof EnterTeam>;

/** The write's club: the one picked, or the one the entry founds, its description left for its editor. */
function clubOf(entered: Entered): FLPostTeamEntryPayload["club"] {
  if (entered.kind === "known") return { kind: "known", team_id: entered.club };
  const { name, shorthand, full_name, schulform, website_url, strasse, hausnummer, plz, stadtteil, stadt } = entered;
  return {
    kind: "new",
    team: {
      name,
      shorthand,
      full_name,
      schulform,
      website_url,
      description: "",
      address: { strasse, hausnummer, plz, stadtteil, stadt },
    },
  };
}

/**
 * Enters a club into a planned season from the dialog over its list, founding it first where it is new, in one
 * transaction: a refused entry leaves no new club behind. A Kürzel another club holds, a retired one's included, is
 * refused on its box. A season gone live, a group filled and a club retired since the dialog opened are a stale page.
 */
export const enterTeam = action({
  lane: "admin",
  name: "enterTeam",
  input: EnterTeam,
  ownWords: ["duplicate_key"],
  paths: { shorthand: "shorthand" },
  examples: {
    shorthand: COPY.team.shorthandExample,
    plz: COPY.admin.spielort.plzExample,
    hausnummer: COPY.admin.spielort.hausnummerExample,
  },
  run: async (entered) => {
    const { saison_id, gruppe, trikot_farbe } = entered;
    await teamsPostTeamEntry(saison_id, { club: clubOf(entered), gruppe, trikot_farbe });
    return { ok: true, value: undefined };
  },
});
