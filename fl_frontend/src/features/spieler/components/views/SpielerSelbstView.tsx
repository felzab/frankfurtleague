import Link from "next/link";

import { KONTO_HREF } from "@/core/kontoHref";
import { Angabe } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { FIELD_PAIR_CLASSES, FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";
import { formatSpielDatum } from "@/shared/utils/format";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { ausgetragenSeit, rolleLabel } from "../../constants";

import type { FLSpielerSelbst, FLSpielerSelbstKaderZeile } from "../../schemas";

const NICHT_HINTERLEGT = "Nicht hinterlegt";

/** One squad row, linked to the squad where everyone reads it rather than repeated here. */
function KaderEintrag({ zeile }: { zeile: FLSpielerSelbstKaderZeile }) {
  const fakten = [
    zeile.nummer === null ? "Ohne Nummer" : `Nummer ${zeile.nummer}`,
    zeile.position ?? "Ohne Position",
    ...(zeile.stufe === null ? [] : [zeile.stufe]),
    ...(zeile.rolle === null ? [] : [rolleLabel(zeile.rolle)]),
  ];

  return (
    <li className="flex flex-col gap-y-1">
      <p className="fluid-sm font-bold text-foreground">
        {zeile.team_name}, Saison {zeile.saison_id}
      </p>
      <p className="muted-hint">{fakten.join(" · ")}</p>
      {/* The tones and the precedence the administrator's squad list gives the same two facts. */}
      {zeile.inactive_since !== null ? (
        <p>
          <span className={labelBadge("warning")}>{ausgetragenSeit(zeile.inactive_since)}</span>
        </p>
      ) : (
        zeile.ist_nachnominiert && (
          <p>
            <span className={labelBadge("info")}>Nachnominiert</span>
          </p>
        )
      )}
      <Link
        href={withSaisonId(`/dashboard/spieler/${zeile.team_id}`, zeile.saison_id)}
        prefetch={false}
        className={`${textLink()} w-fit fluid-sm`}>
        Kader von {zeile.team_name} ansehen
      </Link>
    </li>
  );
}

/**
 * A pupil's own data, read-only: the consent the record holds is changed on the account page, which
 * the stamped wording names as the place to change it, so this page links there rather than offering
 * a second control.
 */
export function SpielerSelbstView({ spieler }: { spieler: FLSpielerSelbst }) {
  const panel = formPanel();

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        <section className={panel.root()}>
          <div className={panel.header()}>
            <PanelHeading
              className={panel.heading()}
              title="Deine Angaben"
            />
          </div>
          <div className={panel.body()}>
            <dl className={FIELD_PAIR_CLASSES}>
              <Angabe label="Name">{spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`}</Angabe>
              <Angabe label="Geburtsdatum">{formatSpielDatum(spieler.geburtsdatum, NICHT_HINTERLEGT)}</Angabe>
            </dl>

            {spieler.kader.length > 0 && (
              <section className="flex flex-col gap-y-3">
                <h3 className={FORM_SECTION_HEADING_CLASSES}>Kader</h3>
                <ul className="flex flex-col gap-y-4">
                  {spieler.kader.map((zeile) => (
                    <KaderEintrag
                      key={`${zeile.team_id}-${zeile.saison_id}`}
                      zeile={zeile}
                    />
                  ))}
                </ul>
              </section>
            )}

            <p className="fluid-sm font-medium text-foreground">
              Was von Dir auf der Website stehen darf, änderst Du unter{" "}
              <Link
                href={KONTO_HREF}
                prefetch={false}
                className={textLink()}>
                Konto
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
