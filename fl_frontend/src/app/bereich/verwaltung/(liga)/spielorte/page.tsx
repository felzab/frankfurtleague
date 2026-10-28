import { Suspense } from "react";
import { connection } from "next/server";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { formatEuro } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getSpielorte } from "@/features/spielorte/queries";

import { spielortAnlegen } from "../../spielortAnlegen";
import { SpielortFelder } from "../../SpielortFelder";
import { SPIELORT_REGELN } from "../../spielortRegeln";

import type { FLSpielort } from "@/features/spielorte/schemas";
import type { TableRow } from "@/kit/Table";
import type { Metadata } from "next";

const WORTE = COPY.verwaltung.spielort;

export const metadata: Metadata = { title: ROUTES.verwaltungSpielorte.titel };

/** One venue's row: its name, „Stillgelegt“ and muted once retired, its street and its price. */
const zeile = (ort: FLSpielort): TableRow => ({
  id: ort.id,
  name: ort.name,
  href: ROUTES.verwaltungSpielort.pfad(ort.id),
  ...(ort.inactive_since === null ? {} : { chip: { tone: "neutral" as const, label: WORTE.stillgelegt }, muted: true }),
  cells: {
    adresse: WORTE.strasseMitNummer(ort.address.strasse, ort.address.hausnummer),
    mietpreis: formatEuro(ort.default_mietpreis),
  },
});

/** The league's venues: searched on the page, a new one created in the dialog over the list. */
export default function SpielortePage() {
  return (
    <Suspense>
      <Spielorte />
    </Suspense>
  );
}

async function Spielorte() {
  await connection();
  // Retired included: the list is the one way into a retired venue's page.
  const { spielorte } = await getSpielorte({ include_inactive: true });

  return (
    <ListPage
      head={{ area: "bereich", title: { route: "verwaltungSpielorte" } }}
      search={{ label: WORTE.suchen }}
      create={{
        title: COPY.shared.mitObjekt(WORTE.objekt, "anlegen"),
        act: { verb: "anlegen", objekt: WORTE.objekt },
        action: spielortAnlegen,
        children: <SpielortFelder regeln={SPIELORT_REGELN} />,
      }}
      list={{
        kind: "table",
        table: {
          label: ROUTES.verwaltungSpielorte.titel,
          nameLabel: WORTE.name,
          columns: [
            { key: "adresse", label: WORTE.adresse, hideOnPhone: true },
            { key: "mietpreis", label: WORTE.mietpreis, figures: true },
          ],
          rows: spielorte.map(zeile),
          empty: { kind: "noch", plural: ROUTES.verwaltungSpielorte.titel },
        },
      }}
    />
  );
}
