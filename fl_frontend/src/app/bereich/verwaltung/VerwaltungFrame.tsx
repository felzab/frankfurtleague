import { Suspense } from "react";
import { connection } from "next/server";

import { RailFrame } from "@/kit/RailFrame";

import { judgeAdminRequest } from "@/core/auth";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { AdminSessionHold } from "@/features/admin/components/providers/AdminSessionHold";
import { getAdminSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";

import type { Account, RailGroup, Seasons } from "@/kit/FrameNav";
import type { ReactNode } from "react";

/**
 * The administration's menu: the Übersicht with no heading, then its three groups. A season's
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
 * The administration's frame and its guard. The frame is drawn without waiting for the session: the account
 * and the seasons it shows are handed down as reads still running, each streaming into its own place. The
 * guard is today's admin layout's: the page slot waits in its own boundary until the session is judged, and
 * nothing here redirects, since a redirect thrown in a frame unmounts it whole; an unread grant throws to the
 * error page, and a session turned away is shown no account and no season, while its page's own read sends it
 * to the sign-in. One frame stands around every page of the area, so moving between a list and an editor, or
 * between seasons, keeps it; an editor declares its own way back (`EditorPage`).
 */
export function VerwaltungFrame({ children }: { children: ReactNode }) {
  // One judgement for both reads; the builder stage reaches no sign-in store, hence `connection()` first.
  const session = connection().then(async () => {
    const judged = await judgeAdminRequest();
    return "session" in judged ? judged.session : null;
  });

  return (
    <RailFrame
      groups={RAIL_GROUPS}
      bar={["uebersicht", "spiele", "teams"]}
      // A league-wide page has no counterpart in another season, so a switch there lands on the season's Übersicht.
      season={{ seasons: readSeasons(session), home: "verwaltungUebersicht", withoutSeason: ROUTES.verwaltungSaisons.pfad() }}
      foot={{ kind: "account", account: readAccount(session) }}>
      <Suspense>
        <AdminSessionHold>{children}</AdminSessionHold>
      </Suspense>
    </RailFrame>
  );
}

type Session = Promise<{ user: { email: string } } | null>;

/** The administrator signed in, or `null` for a session the area turns away. */
async function readAccount(session: Session): Promise<Account | null> {
  const served = await session;
  if (served === null) return null;
  // An administrator is an address: the grant stores no name, so the row names the address.
  return { role: COPY.verwaltung.rolle, address: served.user.email };
}

/**
 * Every season, the newest first as the public frame lists them, and the one a page whose address names none
 * works in, chosen from the list as the admin pages choose it; `null` for a league holding none, and for a
 * session turned away, which the list's read would redirect from inside the frame.
 */
async function readSeasons(session: Session): Promise<Seasons | null> {
  if ((await session) === null) return null;
  // Served oldest first, by id: the list's default order.
  const { saisons } = await getAdminSaisons();
  const standard = selectSaison(saisons, undefined);
  if (standard === undefined) return null;
  return { ids: saisons.map((entry) => entry.id).sort((one, other) => other.localeCompare(one)), standard: standard.id };
}
