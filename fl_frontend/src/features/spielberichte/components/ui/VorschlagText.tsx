import { ImElfmeterschiessen } from "@/features/spiele/components/ui/ImElfmeterschiessen";
import { SONDEREREIGNIS_LABELS } from "@/features/spiele/constants";

import type { FLSpielberichtVorschlag } from "../../schemas";

/**
 * The proposal as one line: the score, its shoot-out, and the event, a no-show naming its event alone. The shoot-out
 * wears the house's mark, which a screen reader speaks in full rather than as two letters.
 */
export function VorschlagText({ vorschlag }: { vorschlag: FLSpielberichtVorschlag }) {
  const ereignis = vorschlag.sonderereignis === null ? null : SONDEREREIGNIS_LABELS[vorschlag.sonderereignis];
  if (vorschlag.team1_tore === null || vorschlag.team2_tore === null) return ereignis;

  const { elfmeterschiessen } = vorschlag;
  return (
    <>
      {`${String(vorschlag.team1_tore)}:${String(vorschlag.team2_tore)}`}
      {elfmeterschiessen !== null && (
        <>
          {` (${String(elfmeterschiessen.team1)}:${String(elfmeterschiessen.team2)} `}
          <ImElfmeterschiessen />)
        </>
      )}
      {ereignis !== null && `, ${ereignis}`}
    </>
  );
}
