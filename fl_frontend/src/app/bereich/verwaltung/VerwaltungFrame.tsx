import { Suspense } from "react";
import { connection } from "next/server";

import { RailFrame } from "@/kit/RailFrame";

import { judgeAdminRequest } from "@/core/auth";
import { COPY } from "@/core/copy";
import { UnreadGrantError } from "@/core/errors";
import { formatSaison } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { AdminSessionHold } from "@/features/admin/components/providers/AdminSessionHold";
import { getAdminSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";

import type { RailGroup } from "@/kit/FrameNav";
import type { Route } from "next";
import type { ReactNode } from "react";

/** The administration's menu (D225, D289): the Übersicht with no heading, then its three groups. */
function railGroups(saison: string | undefined): RailGroup[] {
  // A league holding no season yet reaches its season pages through the seasons list, which creates one.
  const imSaison = (pfad: (saison: string) => Route): Route => (saison === undefined ? ROUTES.verwaltungSaisons.pfad() : pfad(saison));
  return [
    {
      entries: [{ id: "uebersicht", label: ROUTES.verwaltungUebersicht.titel, href: imSaison(ROUTES.verwaltungUebersicht.pfad), icon: "info" }],
    },
    {
      heading: COPY.verwaltung.gruppe.saisonsUndSpiele,
      entries: [
        { id: "saisons", label: ROUTES.verwaltungSaisons.titel, href: ROUTES.verwaltungSaisons.pfad(), icon: "kalender" },
        { id: "spiele", label: ROUTES.verwaltungSpiele.titel, href: imSaison(ROUTES.verwaltungSpiele.pfad), icon: "kalender" },
        { id: "spielorte", label: ROUTES.verwaltungSpielorte.titel, href: ROUTES.verwaltungSpielorte.pfad(), icon: "suche" },
        { id: "schiedsrichter", label: ROUTES.verwaltungSchiedsrichter.titel, href: ROUTES.verwaltungSchiedsrichter.pfad(), icon: "haken" },
      ],
    },
    {
      heading: COPY.verwaltung.gruppe.schulenUndSpieler,
      entries: [
        { id: "bewerbungen", label: ROUTES.verwaltungBewerbungen.titel, href: imSaison(ROUTES.verwaltungBewerbungen.pfad), icon: "haken" },
        { id: "teams", label: ROUTES.verwaltungTeams.titel, href: imSaison(ROUTES.verwaltungTeams.pfad), icon: "info" },
        { id: "spieler", label: ROUTES.verwaltungSpieler.titel, href: imSaison(ROUTES.verwaltungSpieler.pfad), icon: "info" },
        {
          id: "registrierungen",
          label: ROUTES.verwaltungRegistrierungen.titel,
          href: imSaison(ROUTES.verwaltungRegistrierungen.pfad),
          icon: "haken",
        },
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
}

/**
 * Where the season button leads: on a league-wide page, which has no counterpart in another season, to that
 * season's Übersicht; under a season, to the page the frame names for it.
 */
type SeasonTarget = (saison: string) => Route;

/**
 * The administration's frame and its guard. The guard is today's admin layout's: the page slot waits until
 * the session is judged and nothing here redirects, since a redirect thrown in a frame unmounts it whole;
 * an outage throws to the boundary's retry, and a session turned away is served the page alone, whose own
 * read sends it to the sign-in. `saison` is the season the page's address names; a league-wide page works in
 * the season the league runs, else the last one.
 */
export function VerwaltungFrame({
  saison,
  seasonTarget = ROUTES.verwaltungUebersicht.pfad,
  back,
  children,
}: {
  saison?: Promise<string>;
  seasonTarget?: SeasonTarget;
  /** An editor's way back, which takes the phone's bottom bar away. */
  back?: (saison: string | undefined) => Route;
  children: ReactNode;
}) {
  return (
    // The frame reads the session and the seasons, so it streams in its own boundary, never the root's.
    <Suspense>
      <Framed
        saison={saison}
        seasonTarget={seasonTarget}
        back={back}>
        {children}
      </Framed>
    </Suspense>
  );
}

async function Framed({
  saison,
  seasonTarget,
  back,
  children,
}: {
  saison?: Promise<string>;
  seasonTarget: SeasonTarget;
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

  const { saisonen, gewaehlt } = await seasonsOf(saison === undefined ? undefined : await saison);
  const adresse = judged.session.user.email;

  return (
    <RailFrame
      groups={railGroups(gewaehlt)}
      bar={["uebersicht", "spiele", "teams"]}
      season={
        gewaehlt === undefined
          ? undefined
          : {
              current: formatSaison(gewaehlt),
              seasons: saisonen.map((id) => ({ text: formatSaison(id), href: seasonTarget(id), isCurrent: id === gewaehlt })),
            }
      }
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
      back={back === undefined ? undefined : { href: back(gewaehlt), rail: false }}>
      <AdminSessionHold>{children}</AdminSessionHold>
    </RailFrame>
  );
}

/** Every season, and the one the frame works in: the address's, else the season the league runs, else the last. */
async function seasonsOf(requested: string | undefined) {
  const { saisons } = await getAdminSaisons();
  return { saisonen: saisons.map((entry) => entry.id), gewaehlt: selectSaison(saisons, requested)?.id };
}
