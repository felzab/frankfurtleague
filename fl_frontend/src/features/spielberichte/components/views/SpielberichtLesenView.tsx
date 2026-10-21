import Link from "next/link";

import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { formatSpielDatum, PLACEHOLDER } from "@/shared/utils/format";

import { VorschlagText } from "../ui/VorschlagText";
import { BerichtEintraege } from "./BerichtEintraege";
import { SCHIEDSRICHTER_HREF } from "./SpielberichtZustandView";

import type { FLSpielberichtSchiedsrichterResponse } from "../../schemas";

/**
 * The referee's report once the fixture's season has ended: the report alone, read-only, since the backend refuses
 * their write then (`REQ-BERICHT-007`) and serves no squad to pick from.
 */
export function SpielberichtLesenView({ lesen }: { lesen: FLSpielberichtSchiedsrichterResponse }) {
  const panel = formPanel();
  const { spiel, bericht } = lesen;
  const paarung = `${spiel.team1?.name ?? PLACEHOLDER.slot} gegen ${spiel.team2?.name ?? PLACEHOLDER.slot}`;

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        <section className={panel.root()}>
          <div className={panel.header()}>
            <PanelHeading
              className={panel.heading()}
              title={paarung}>
              <span className="muted-meta">{spiel.datum === null ? null : formatSpielDatum(spiel.datum)}</span>
            </PanelHeading>
          </div>

          <div className={panel.body()}>
            <p className="muted-hint">Die Saison dieses Spiels ist vorbei. Den Spielbericht kannst Du ansehen, aber nicht mehr ändern.</p>
            {bericht === null ? (
              <p className="muted-hint">Zu diesem Spiel hast Du keinen Spielbericht eingetragen.</p>
            ) : (
              <>
                <p className="fluid-sm font-semibold text-foreground">
                  Ergebnis: <VorschlagText vorschlag={bericht.ergebnis_vorschlag} />
                </p>
                <BerichtEintraege
                  lesen={lesen}
                  bericht={bericht}
                  bemerkungenTitel="Deine Bemerkungen"
                />
              </>
            )}
          </div>
        </section>

        <Link
          href={SCHIEDSRICHTER_HREF}
          prefetch={false}
          className={`${formButton({ intent: "nav", size: "xs" })} self-start`}>
          Zu Deinen Spielen
        </Link>
      </div>
    </div>
  );
}
