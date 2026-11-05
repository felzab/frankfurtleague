import { Suspense } from "react";

import { RailColumn, RailFrame } from "@/kit/RailFrame";

import { judgeAdminRequest } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { UnreadGrantError } from "@/core/errors";
import { dayOf, formatPeriod } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { readAccount } from "@/features/account/account";
import { getAdminSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";

import type { RailGroup, Saisons } from "@/kit/FrameNav";
import type { ReactNode } from "react";

/**
 * The administration's menu: the Übersicht with no heading, then its three groups. A season's
 * page takes the season the page works in, which the frame reads from the address.
 */
export const RAIL_GROUPS: RailGroup[] = [
  {
    entries: [{ id: "uebersicht", label: ROUTES.adminOverview.title, saison: "adminOverview", icon: "overview" }],
  },
  {
    heading: COPY.admin.group.saisonsAndSpiele,
    entries: [
      { id: "saisons", label: ROUTES.adminSaisons.title, href: ROUTES.adminSaisons.path(), icon: "saisons" },
      { id: "spiele", label: ROUTES.adminSpiele.title, saison: "adminSpiele", icon: "spielplan" },
      { id: "spielorte", label: ROUTES.adminSpielorte.title, href: ROUTES.adminSpielorte.path(), icon: "spielorte" },
      {
        id: "schiedsrichter",
        label: ROUTES.adminSchiedsrichter.title,
        href: ROUTES.adminSchiedsrichter.path(),
        icon: "schiedsrichter",
      },
    ],
  },
  {
    heading: COPY.admin.group.schulenAndSpieler,
    entries: [
      { id: "bewerbungen", label: ROUTES.adminBewerbungen.title, saison: "adminBewerbungen", icon: "bewerbungen" },
      { id: "teams", label: ROUTES.adminTeams.title, saison: "adminTeams", icon: "teams" },
      { id: "spieler", label: ROUTES.adminSpieler.title, saison: "adminSpieler", icon: "spieler" },
      { id: "registrierungen", label: ROUTES.adminRegistrierungen.title, saison: "adminRegistrierungen", icon: "registrierungen" },
    ],
  },
  {
    heading: COPY.admin.group.accessAndPrivacy,
    entries: [
      {
        id: "administratoren",
        label: ROUTES.adminAdministrators.title,
        href: ROUTES.adminAdministrators.path(),
        icon: "administrators",
      },
      { id: "sperrliste", label: ROUTES.adminBanList.title, href: ROUTES.adminBanList.path(), icon: "sperrliste" },
      { id: "loeschungen", label: ROUTES.adminErasures.title, href: ROUTES.adminErasures.path(), icon: "erasures" },
      {
        id: "adressaenderungen",
        label: ROUTES.adminAddressChanges.title,
        href: ROUTES.adminAddressChanges.path(),
        icon: "email",
      },
      { id: "action_log", label: ROUTES.adminActionLog.title, href: ROUTES.adminActionLog.path(), icon: "log" },
    ],
  },
];

/**
 * The administration's frame and its guard. The frame is drawn without waiting for the session: the account
 * and the seasons it shows are handed down as reads still running, each streaming into its own place. The
 * page slot waits in its own boundary until the session is judged (`SessionHold`), and nothing here redirects,
 * since a redirect thrown in a frame unmounts it whole; an unread grant throws to the error page, and a session
 * turned away is shown no account and no season, while its page's own read sends it to the sign-in. One frame stands around every page of the area, so moving between a list and an editor, or
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
      saison={{ saisons: readSeasons(session), home: "adminOverview", withoutSaison: ROUTES.adminSaisons.path() }}
      foot={{
        kind: "account",
        account: session.then((served) => (served === null ? null : readAccount(COPY.admin.role, "administration"))),
      }}
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
        <SessionHold>{children}</SessionHold>
      </Suspense>
    </RailColumn>
  );
}

/**
 * The page once the session is judged, which also names the request's actor before any of the page's reads, so
 * each read is made as the administrator. In a boundary of its own, never awaited by a layout, which would make
 * the whole frame wait. A session turned away is let through bare: its page's own read sends it to the sign-in,
 * where a redirect thrown here would unmount the frame. An acting administrator needs no step-up window here,
 * since an act behind the passkey asks for the touch at its own press.
 */
async function SessionHold({ children }: { children: ReactNode }) {
  const judged = await judgeAdminRequest();
  // An outage keeps the administrator in place with the error page: a sign-in would meet the same unread grant.
  if ("refused" in judged && judged.refused === "unread") throw new UnreadGrantError();
  return children;
}

type Session = Promise<{ user: { email: string } } | null>;

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
      .map((entry) => ({ id: entry.id, span: formatPeriod(dayOf(entry.start_date), dayOf(entry.end_date)) }))
      .sort((one, other) => other.id.localeCompare(one.id)),
    standard: standard.id,
  };
}
