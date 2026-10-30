import { getEinwilligungFassung } from "@/core/einwilligung";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { nullAfterLoggingUnexplained } from "@/shared/utils/degradedRead";

import type { EinwilligungSeite } from "@/core/einwilligungSeiten";
import type { FLSaisonTeamKontakte } from "@/core/generated/client/types";
import type { MedienFragen } from "./nachweis";

// The pages that ask the media choice through a control of its own; every other page asks it through its switch, so a
// label of one of those is never read here as one that did not ask.
const KONTAKT_SEITEN: ReadonlySet<string> = new Set<EinwilligungSeite>([
  "bestaetigung_kontakt",
  "bestaetigung_kontakt_verwaltung",
  "bestaetigung_kontakt_saison",
]);

/**
 * Whether each confirmed seat's label asked the media choice, off the registry's words for it, for an admin readout.
 * Called inside the request's trace scope.
 */
export async function getMedienFragen(kontakte: FLSaisonTeamKontakte | null): Promise<MedienFragen> {
  const labels = new Set(
    KONTAKT_ROLLEN.flatMap(({ value }) => {
      const einwilligung = kontakte?.[value]?.einwilligung;
      return einwilligung === undefined || einwilligung.confirmed_at === null ? [] : [einwilligung.text_version];
    }),
  );
  const gelesen = await Promise.all(
    [...labels].map(async (label) => ({ label, fassung: await getEinwilligungFassung(label).catch(nullAfterLoggingUnexplained) })),
  );

  // A label the registry does not hold, or whose read failed, is left out: the readout says nobody checked.
  return Object.fromEntries(
    gelesen.flatMap(({ label, fassung }) =>
      fassung === null || !KONTAKT_SEITEN.has(fassung.seite) ? [] : [[label, Object.hasOwn(fassung.controls, "medien")]],
    ),
  );
}
