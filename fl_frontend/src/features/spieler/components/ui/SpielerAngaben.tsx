import { Fragment } from "react";
import Link from "next/link";

import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { FIELD_PAIR_CLASSES, FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { textLink } from "@/shared/components/ui/textLink";
import { formatSpielDatum } from "@/shared/utils/format";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { ausgetragenSeit, kaderName, OHNE_NUMMER, rolleLabel } from "../../constants";

import type { ReactNode } from "react";
import type { FLSpielerSelbst, FLSpielerSelbstKaderZeile } from "../../schemas";

/** One squad row, linked to the squad where everyone reads it rather than repeated here. */
function KaderEintrag({ zeile }: { zeile: FLSpielerSelbstKaderZeile }) {
  const fakten: readonly (readonly [string, ReactNode])[] = [
    ["nummer", zeile.nummer === null ? <Leer>{OHNE_NUMMER}</Leer> : `Nummer ${zeile.nummer}`],
    ["position", zeile.position ?? <Leer>Ohne Position</Leer>],
    ...(zeile.stufe === null ? [] : [["stufe", zeile.stufe] as const]),
    ...(zeile.rolle === null ? [] : [["rolle", rolleLabel(zeile.rolle)] as const]),
  ];

  return (
    <li className="flex flex-col gap-y-1">
      <p className="fluid-sm font-bold text-foreground">
        {zeile.team_name}, Saison {zeile.saison_id}
      </p>
      <p className="muted-hint">
        {fakten.map(([feld, fakt], index) => (
          <Fragment key={feld}>
            {index > 0 && " · "}
            {fakt}
          </Fragment>
        ))}
      </p>
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
 * Each rung's look, as its neighbours take it: an h3 the section heading's, an h5 the account page's h4
 * rung's, so a record's squad list never reads as the next record.
 */
const KADER_TITEL_CLASSES = { h3: FORM_SECTION_HEADING_CLASSES, h5: "fluid-sm font-bold text-foreground" } as const;

/**
 * What the league stores on a pupil's record, read-only: the pupil's own page and the account page
 * show the same facts. `kaderEbene` is the squad list's heading rung, one below whatever heads the facts.
 */
export function SpielerAngaben({ spieler, kaderEbene }: { spieler: FLSpielerSelbst; kaderEbene: keyof typeof KADER_TITEL_CLASSES }) {
  const KaderTitel = kaderEbene;

  return (
    <>
      <dl className={FIELD_PAIR_CLASSES}>
        <Angabe label="Name">{kaderName(spieler)}</Angabe>
        <Angabe label="Geburtsdatum">{spieler.geburtsdatum ? formatSpielDatum(spieler.geburtsdatum) : <Leer />}</Angabe>
      </dl>

      {spieler.kader.length > 0 && (
        <section className="flex flex-col gap-y-3">
          <KaderTitel className={KADER_TITEL_CLASSES[kaderEbene]}>Kader</KaderTitel>
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
