import Link from "next/link";

import { Angabe, NICHT_HINTERLEGT } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { FIELD_PAIR_CLASSES, FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { textLink } from "@/shared/components/ui/textLink";
import { formatSpielDatum } from "@/shared/utils/format";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { ausgetragenSeit, rolleLabel } from "../../constants";

import type { FLSpielerSelbst, FLSpielerSelbstKaderZeile } from "../../schemas";

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
 * What the league stores on a pupil's record, read-only: the pupil's own page and the account page
 * show the same facts. `kaderEbene` is the squad list's heading rung, one below whatever heads the facts.
 */
export function SpielerAngaben({ spieler, kaderEbene }: { spieler: FLSpielerSelbst; kaderEbene: "h3" | "h5" }) {
  const KaderTitel = kaderEbene;

  return (
    <>
      <dl className={FIELD_PAIR_CLASSES}>
        <Angabe label="Name">{spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`}</Angabe>
        <Angabe label="Geburtsdatum">{formatSpielDatum(spieler.geburtsdatum, NICHT_HINTERLEGT)}</Angabe>
      </dl>

      {spieler.kader.length > 0 && (
        <section className="flex flex-col gap-y-3">
          <KaderTitel className={FORM_SECTION_HEADING_CLASSES}>Kader</KaderTitel>
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
    </>
  );
}
