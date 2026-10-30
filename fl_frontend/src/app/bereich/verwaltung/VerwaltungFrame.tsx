import { Suspense } from "react";

import { RailColumn, RailFrame } from "@/kit/RailFrame";

import { judgeAdminRequest } from "@/core/auth";
import { COPY } from "@/core/copy";
import { formatPeriod } from "@/core/format";
import { ROUTES } from "@/core/routes";
// Session 5: the old admin layout's guard, which moves with that layout.
import { AdminSessionHold } from "@/features/admin/components/providers/AdminSessionHold";
import { getAdminSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";

import type { CalendarDay } from "@/core/format";
import type { Account, RailGroup, Saisons } from "@/kit/FrameNav";
import type { ReactNode } from "react";

/**
 * The administration's menu: the Übersicht with no heading, then its three groups. A season's
 * page takes the season the page works in, which the frame reads from the address.
 */
export const RAIL_GROUPS: RailGroup[] = [
  {
    entries: [{ id: "uebersicht", label: ROUTES.verwaltungOverview.title, saison: "verwaltungOverview", icon: "overview" }],
  },
  {
    heading: COPY.verwaltung.gruppe.saisonsUndSpiele,
    entries: [
      { id: "saisons", label: ROUTES.verwaltungSaisons.title, href: ROUTES.verwaltungSaisons.path(), icon: "saisons" },
      { id: "spiele", label: ROUTES.verwaltungSpiele.title, saison: "verwaltungSpiele", icon: "spielplan" },
      { id: "spielorte", label: ROUTES.verwaltungSpielorte.title, href: ROUTES.verwaltungSpielorte.path(), icon: "spielorte" },
      {
        id: "schiedsrichter",
        label: ROUTES.verwaltungSchiedsrichter.title,
        href: ROUTES.verwaltungSchiedsrichter.path(),
        icon: "schiedsrichter",
      },
    ],
  },
  {
    heading: COPY.verwaltung.gruppe.schulenUndSpieler,
    entries: [
      { id: "bewerbungen", label: ROUTES.verwaltungBewerbungen.title, saison: "verwaltungBewerbungen", icon: "bewerbungen" },
      { id: "teams", label: ROUTES.verwaltungTeams.title, saison: "verwaltungTeams", icon: "teams" },
      { id: "spieler", label: ROUTES.verwaltungSpieler.title, saison: "verwaltungSpieler", icon: "spieler" },
      { id: "registrierungen", label: ROUTES.verwaltungRegistrierungen.title, saison: "verwaltungRegistrierungen", icon: "registrierungen" },
    ],
  },
  {
    heading: COPY.verwaltung.gruppe.zugangUndDatenschutz,
    entries: [
      {
        id: "administratoren",
        label: ROUTES.verwaltungAdministratoren.title,
        href: ROUTES.verwaltungAdministratoren.path(),
        icon: "administratoren",
      },
      { id: "sperrliste", label: ROUTES.verwaltungSperrliste.title, href: ROUTES.verwaltungSperrliste.path(), icon: "sperrliste" },
      { id: "loeschungen", label: ROUTES.verwaltungErasures.title, href: ROUTES.verwaltungErasures.path(), icon: "erasures" },
      {
        id: "adressaenderungen",
        label: ROUTES.verwaltungAdressaenderungen.title,
        href: ROUTES.verwaltungAdressaenderungen.path(),
        icon: "adressaenderungen",
      },
      { id: "action_log", label: ROUTES.verwaltungActionLog.title, href: ROUTES.verwaltungActionLog.path(), icon: "log" },
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
 * between seasons, keeps it. The phone's band and bar are the route groups' (`VerwaltungColumn`): an editor's
 * route lies in `(editor)`, every other page in `(liste)`.
 */
export function VerwaltungFrame({ children }: { children: ReactNode }) {
  // One judgement for both reads.
  const session = judgeAdminRequest().then((judged) => ("session" in judged ? judged.session : null));

  return (
    <RailFrame
      groups={RAIL_GROUPS}
      bar={["uebersicht", "spiele", "teams"]}
      // A league-wide page has no counterpart in another season, so a switch there lands on the season's Übersicht.
      saison={{ saisons: readSeasons(session), home: "verwaltungOverview", withoutSaison: ROUTES.verwaltungSaisons.path() }}
      foot={{ kind: "account", account: readAccount(session) }}
      columnInLayouts>
      {children}
    </RailFrame>
  );
}

/**
 * A route group's column: the band, and the bar where the group is no editor's, drawn at once around the page,
 * which waits in its own boundary until the session is judged.
 */
export function VerwaltungColumn({ editor = false, children }: { editor?: boolean; children: ReactNode }) {
  return (
    <RailColumn editor={editor}>
      <Suspense>
        <AdminSessionHold>{children}</AdminSessionHold>
      </Suspense>
    </RailColumn>
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
async function readSeasons(session: Session): Promise<Saisons | null> {
  if ((await session) === null) return null;
  // Served oldest first, by id: the list's default order.
  const { saisons } = await getAdminSaisons();
  const standard = selectSaison(saisons, undefined);
  if (standard === undefined) return null;
  return {
    entries: saisons
      // The season's own strings, which its schema has already held to the stored format.
      .map((entry) => ({ id: entry.id, span: formatPeriod(entry.start_date as CalendarDay, entry.end_date as CalendarDay) }))
      .sort((one, other) => other.id.localeCompare(one.id)),
    standard: standard.id,
  };
}
