"use server";

import { z } from "zod";

import { action, blankIsNull } from "@/core/action";
import { COPY } from "@/core/copy";
import { teamsPatchTeamSaison } from "@/core/generated/client/sdk";
import { TeamsPatchTeamSaisonBody, TeamsPatchTeamSaisonParams } from "@/core/generated/zod/inputs";
import { getTeamSaisonAdmin } from "@/features/teams/queries";

import { valuesOf } from "./teamValues";

import type { ActionAnswer } from "@/core/action";

const { shape } = TeamsPatchTeamSaisonBody;
const address = shape.address.shape;

/** What the editor's boxes send, each held to the save's own published rule for it. */
const SaveTeam = z.object({
  id: TeamsPatchTeamSaisonParams.shape.team_id,
  saison_id: TeamsPatchTeamSaisonParams.shape.saison_id,
  // The sum the editor read, of the club's count and its row's.
  version: shape.version,
  changes: z
    .object({
      name: shape.name,
      shorthand: shape.shorthand,
      full_name: shape.full_name,
      schulform: blankIsNull(shape.schulform),
      website_url: blankIsNull(shape.website_url),
      description: shape.description,
      strasse: address.strasse,
      hausnummer: address.hausnummer,
      plz: address.plz,
      stadtteil: address.stadtteil,
      stadt: address.stadt,
      gruppe: blankIsNull(shape.gruppe),
      trikot_farbe: blankIsNull(shape.trikot_farbe),
    })
    .partial(),
});

/**
 * Saves the team editor's one record, the club and its row of the season, in one transaction, answering the sum the
 * next save sends. The write replaces both whole, so every field left alone is sent as stored, read again here. A club
 * or a row moved since the editor read them is refused as stale, a Kürzel another club holds and a colour another row
 * holds on their boxes, and a group filled or drawn since the page's read is the stale page it is.
 */
export const saveTeam = action({
  lane: "admin",
  name: "saveTeam",
  input: SaveTeam,
  ownWords: ["duplicate_key", "saison_past", "trikot_farbe_taken"],
  paths: { shorthand: "changes.shorthand", trikot_farbe: "changes.trikot_farbe" },
  examples: {
    "changes.shorthand": COPY.team.shorthandExample,
    "changes.plz": COPY.admin.spielort.plzExample,
    "changes.hausnummer": COPY.admin.spielort.hausnummerExample,
  },
  run: async ({ id, saison_id, version, changes }): Promise<ActionAnswer<number>> => {
    const read = await getTeamSaisonAdmin(id, saison_id);
    if (read?.membership == null) return { ok: false, reason: COPY.shared.failure.stale };

    const { team, membership } = read;
    const { schulform, website_url, trikot_farbe, gruppe, ...text } = changes;
    const { name, shorthand, full_name, description, strasse, hausnummer, plz, stadtteil, stadt } = { ...valuesOf(team, membership), ...text };
    const written = await teamsPatchTeamSaison(id, saison_id, {
      name,
      shorthand,
      full_name,
      description,
      schulform: schulform === undefined ? team.schulform : schulform,
      website_url: website_url === undefined ? team.website_url : website_url,
      address: { strasse, hausnummer, plz, stadtteil, stadt },
      gruppe: gruppe ?? membership.gruppe,
      trikot_farbe: trikot_farbe === undefined ? membership.trikot_farbe : trikot_farbe,
      version,
    });
    return { ok: true, value: written.version };
  },
});
