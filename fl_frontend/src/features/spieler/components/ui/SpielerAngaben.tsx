import { Fragment } from "react";
import Link from "next/link";

import { ROUTES } from "@/core/routes";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { FIELD_PAIR_CLASSES, FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { textLink } from "@/shared/components/ui/textLink";
import { formatSpielDatum, nichtHinterlegt } from "@/shared/utils/format";

import { ausgetragenSeit, kaderName, NUMMER_NICHT_HINTERLEGT, rolleLabel } from "../../constants";

import type { FLSpielerSelf, FLSpielerSelfKaderRow } from "@/core/generated/client/types";
import type { ReactNode } from "react";

/** One squad row, linked to the squad where everyone reads it rather than repeated here. */
function KaderEintrag({ row }: { row: FLSpielerSelfKaderRow }) {
  const fakten: readonly (readonly [string, ReactNode])[] = [
    ["nummer", row.nummer === null ? <Leer>{NUMMER_NICHT_HINTERLEGT}</Leer> : `Nummer ${row.nummer}`],
    ["position", row.position ?? <Leer>{nichtHinterlegt("Position")}</Leer>],
    ...(row.stufe === null ? [] : [["stufe", row.stufe] as const]),
    ...(row.rolle === null ? [] : [["rolle", rolleLabel(row.rolle)] as const]),
  ];

  return (
    <li className="flex flex-col gap-y-1">
      <p className="fluid-sm font-bold text-foreground">
        {row.team_name}, Saison {row.saison_id}
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
      {row.inactive_since !== null ? (
        <p>
          <span className={labelBadge("warning")}>{ausgetragenSeit(row.inactive_since)}</span>
        </p>
      ) : (
        row.is_nachnominiert && (
          <p>
            <span className={labelBadge("info")}>Nachnominiert</span>
          </p>
        )
      )}
      <Link
        href={ROUTES.team.path(row.saison_id, row.team_id)}
        prefetch={false}
        className={`${textLink()} w-fit fluid-sm`}>
        Kader von {row.team_name} ansehen
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
export function SpielerAngaben({ spieler, kaderEbene }: { spieler: FLSpielerSelf; kaderEbene: keyof typeof KADER_TITEL_CLASSES }) {
  const KaderTitel = kaderEbene;

  return (
    <>
      <dl className={FIELD_PAIR_CLASSES}>
        <Angabe label="Name">{kaderName(spieler)}</Angabe>
        <Angabe label="Geburtsdatum">{formatSpielDatum(spieler.geburtsdatum)}</Angabe>
      </dl>

      {spieler.kader.length > 0 && (
        <section className="flex flex-col gap-y-3">
          <KaderTitel className={KADER_TITEL_CLASSES[kaderEbene]}>Kader</KaderTitel>
          <ul className="flex flex-col gap-y-4">
            {spieler.kader.map((row) => (
              <KaderEintrag
                key={`${row.team_id}-${row.saison_id}`}
                row={row}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
