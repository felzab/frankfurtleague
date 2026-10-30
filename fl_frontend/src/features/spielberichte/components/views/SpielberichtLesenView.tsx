import Link from "next/link";

import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { formatSpielDatum, PLACEHOLDER } from "@/shared/utils/format";

import { VorschlagText } from "../ui/VorschlagText";
import { BerichtEintraege } from "./BerichtEintraege";
import { SCHIEDSRICHTER_HREF } from "./SpielberichtZustandView";

import type { FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

/**
 * A fixture's report as its booked referee reads it once the fixture's season has ended: the report alone, read-only,
 * since the backend refuses their write then (`saison_past`) and serves no squad to pick from.
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
              <p className="muted-hint">Zu diesem Spiel liegt kein Spielbericht vor.</p>
            ) : (
              <>
                {/* A proposal by side about clubs that left: beside the clubs heading this page it would read as theirs, as
                    the administrator's panel withholds it
                    (`fl_frontend/src/features/spielberichte/components/views/AdminSpielberichtPanel.tsx :: BerichtInhalt`). */}
                {lesen.seiten_changed.length === 0 ? (
                  <p className="fluid-sm font-semibold text-foreground">
                    Ergebnis: <VorschlagText vorschlag={bericht.ergebnis_vorschlag} />
                  </p>
                ) : (
                  <p className="muted-hint">
                    Der Bericht wurde für andere Teams geschrieben, als jetzt im Spiel stehen. Sein Ergebnis steht deshalb nicht hier.
                  </p>
                )}
                {/* The fixture's referee booked now reads it, who may not have written it, nor every remark in it. */}
                <BerichtEintraege
                  lesen={lesen}
                  bericht={bericht}
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
