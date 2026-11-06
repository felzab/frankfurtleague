import { RailFrame } from "@/kit/RailFrame";
import { RailFrameBoundary } from "@/kit/RailFrameBoundary";

import { judgeAdminRequest } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
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
const RAIL_GROUPS: RailGroup[] = [
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

/** The phone bar's pages, before „Mehr“. */
const BAR = ["uebersicht", "spiele", "teams"] as const;

/**
 * The administration's frame. It is drawn without waiting for the session: the account and the seasons it shows
 * are handed down as reads still running, each streaming into its own place, and the page stands under it at once,
 * its strip and its placeholders drawn while its reads run. Nothing here judges a page: every admin read passes
 * `runAdminRead`, which names the request's actor, sends a session turned away to the sign-in and throws an unread
 * grant to the error page, each inside the page, since a redirect thrown in a frame unmounts it whole. A session
 * turned away is shown no account and no season. One frame stands around every page of the area, so moving between
 * a list and an editor, or between seasons, keeps it. The phone's band and bar are the route groups' (`RailColumn`):
 * an editor's route lies in `(editor)`, every other page in `(liste)`.
 */
export function AdminFrame({ children }: { children: ReactNode }) {
  // One judgement for both reads.
  const session = judgeAdminRequest().then((judged) => ("session" in judged ? judged.session : null));

  return (
    // A failed read of the frame's own is answered in the rail frame: the area's `error.tsx` stands inside this layout.
    <RailFrameBoundary
      groups={RAIL_GROUPS}
      bar={BAR}
      home={ROUTES.admin.path()}>
      <RailFrame
        groups={RAIL_GROUPS}
        bar={BAR}
        // A league-wide page has no counterpart in another season, so a switch there lands on the season's Übersicht.
        saison={{ saisons: readSeasons(session), home: "adminOverview", withoutSaison: ROUTES.adminSaisons.path() }}
        foot={{
          kind: "account",
          account: session.then((served) => (served === null ? null : readAccount(COPY.admin.role, "administration"))),
        }}
        columnInLayouts>
        {children}
      </RailFrame>
    </RailFrameBoundary>
  );
}

type Session = Promise<{ user: { email: string } } | null>;

/**
 * Every season, the newest first as the public frame lists them, and the one a page whose address names none
 * works in, chosen from the list as the admin pages choose it; `null` for a league holding none, and for a
 * session turned away, which the list's read would redirect from inside the frame.
 */
async function readSeasons(session: Session): Promise<Saisons | null> {
  if ((await session) === null) return null;
  // Read oldest first, by id, the order `getAdminSaisons` asks for.
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
