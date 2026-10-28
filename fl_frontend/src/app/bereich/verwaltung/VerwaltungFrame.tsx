import { Suspense } from "react";
import { connection } from "next/server";

import { RailFrame } from "@/kit/RailFrame";

import { judgeAdminRequest } from "@/core/auth";
import { COPY } from "@/core/copy";
import { UnreadGrantError } from "@/core/errors";
import { ROUTES } from "@/core/routes";
import { AdminSessionHold } from "@/features/admin/components/providers/AdminSessionHold";
import { getAdminSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";

import type { RailGroup, Seasons } from "@/kit/FrameNav";
import type { Route } from "next";
import type { ReactNode } from "react";

/**
 * The administration's menu (D225, D289): the Übersicht with no heading, then its three groups. A season's
 * page takes the season the page works in, which the frame reads from the address.
 */
const RAIL_GROUPS: RailGroup[] = [
  {
    entries: [{ id: "uebersicht", label: ROUTES.verwaltungUebersicht.titel, season: "verwaltungUebersicht", icon: "info" }],
  },
  {
    heading: COPY.verwaltung.gruppe.saisonsUndSpiele,
    entries: [
      { id: "saisons", label: ROUTES.verwaltungSaisons.titel, href: ROUTES.verwaltungSaisons.pfad(), icon: "kalender" },
      { id: "spiele", label: ROUTES.verwaltungSpiele.titel, season: "verwaltungSpiele", icon: "kalender" },
      { id: "spielorte", label: ROUTES.verwaltungSpielorte.titel, href: ROUTES.verwaltungSpielorte.pfad(), icon: "suche" },
      { id: "schiedsrichter", label: ROUTES.verwaltungSchiedsrichter.titel, href: ROUTES.verwaltungSchiedsrichter.pfad(), icon: "haken" },
    ],
  },
  {
    heading: COPY.verwaltung.gruppe.schulenUndSpieler,
    entries: [
      { id: "bewerbungen", label: ROUTES.verwaltungBewerbungen.titel, season: "verwaltungBewerbungen", icon: "haken" },
      { id: "teams", label: ROUTES.verwaltungTeams.titel, season: "verwaltungTeams", icon: "info" },
      { id: "spieler", label: ROUTES.verwaltungSpieler.titel, season: "verwaltungSpieler", icon: "info" },
      { id: "registrierungen", label: ROUTES.verwaltungRegistrierungen.titel, season: "verwaltungRegistrierungen", icon: "haken" },
    ],
  },
  {
    heading: COPY.verwaltung.gruppe.zugangUndDatenschutz,
    entries: [
      { id: "administratoren", label: ROUTES.verwaltungAdministratoren.titel, href: ROUTES.verwaltungAdministratoren.pfad(), icon: "info" },
      { id: "sperrliste", label: ROUTES.verwaltungSperrliste.titel, href: ROUTES.verwaltungSperrliste.pfad(), icon: "warnung" },
      { id: "loeschungen", label: ROUTES.verwaltungLoeschungen.titel, href: ROUTES.verwaltungLoeschungen.pfad(), icon: "schliessen" },
      {
        id: "adressaenderungen",
        label: ROUTES.verwaltungAdressaenderungen.titel,
        href: ROUTES.verwaltungAdressaenderungen.pfad(),
        icon: "info",
      },
      { id: "protokoll", label: ROUTES.verwaltungProtokoll.titel, href: ROUTES.verwaltungProtokoll.pfad(), icon: "filter" },
    ],
  },
];

/**
 * The administration's frame and its guard. The guard is today's admin layout's: the page slot waits until
 * the session is judged and nothing here redirects, since a redirect thrown in a frame unmounts it whole;
 * an outage throws to the boundary's retry, and a session turned away is served the page alone, whose own
 * read sends it to the sign-in. `saison` is the season the page's address names, for an editor's way back.
 */
export function VerwaltungFrame({
  saison,
  back,
  children,
}: {
  saison?: Promise<string>;
  /** An editor's way back, which takes the phone's bottom bar away. */
  back?: (saison: string | undefined) => Route;
  children: ReactNode;
}) {
  return (
    // The frame reads the session and the seasons, so it streams in its own boundary, never the root's.
    <Suspense>
      <Framed
        saison={saison}
        back={back}>
        {children}
      </Framed>
    </Suspense>
  );
}

async function Framed({
  saison,
  back,
  children,
}: {
  saison?: Promise<string>;
  back?: (saison: string | undefined) => Route;
  children: ReactNode;
}) {
  // The builder stage reaches no sign-in store.
  await connection();
  const judged = await judgeAdminRequest();
  if ("refused" in judged) {
    if (judged.refused === "unread") throw new UnreadGrantError();
    return children;
  }

  const seasons = readSeasons();
  const adresse = judged.session.user.email;

  return (
    <RailFrame
      groups={RAIL_GROUPS}
      bar={["uebersicht", "spiele", "teams"]}
      // A league-wide page has no counterpart in another season, so a switch there lands on the season's Übersicht.
      season={{ seasons, home: "verwaltungUebersicht", withoutSeason: ROUTES.verwaltungSaisons.pfad() }}
      foot={{
        kind: "account",
        account: {
          // An administrator is an address: the grant stores no name.
          name: adresse,
          role: COPY.verwaltung.rolle,
          address: adresse,
          menu: [
            [{ kind: "link", label: COPY.vorlage.konto, href: ROUTES.kontoAnmeldung.pfad() }],
            [
              { kind: "link", label: ROUTES.impressum.titel, href: ROUTES.impressum.pfad() },
              { kind: "link", label: ROUTES.datenschutz.titel, href: ROUTES.datenschutz.pfad() },
            ],
          ],
        },
      }}
      back={back === undefined ? undefined : { href: back(saison === undefined ? undefined : await saison), rail: false }}>
      <AdminSessionHold>{children}</AdminSessionHold>
    </RailFrame>
  );
}

/**
 * Every season, as the list serves them, and the one a page whose address names none works in: the season
 * the league runs, else the last; `null` for a league holding none.
 */
async function readSeasons(): Promise<Seasons | null> {
  const { saisons } = await getAdminSaisons();
  const standard = selectSaison(saisons, undefined);
  return standard === undefined ? null : { ids: saisons.map((entry) => entry.id), standard: standard.id };
}
