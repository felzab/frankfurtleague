import { RailFrame } from "@/kit/RailFrame";
import { RailFrameBoundary } from "@/kit/RailFrameBoundary";

import { COPY } from "@/core/copy";
import { dayOf, formatPeriod } from "@/core/format";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { readAccount } from "@/features/account/account";
import { getSaisonFrame } from "@/features/saisons/queries";

import { AREA_HOME } from "../areaHome";

import type { Copy } from "@/core/copy";
import type { FrameSaisons, RailGroup, Saisons } from "@/kit/FrameNav";
import type { ReactNode } from "react";

/** A person's own seasons, as a frame of one place takes them. */
type PersonSaisons = Extract<FrameSaisons, { saisons: unknown }>;

/**
 * One frame of a person's own pages: its menu, the area's line in the account row, and, for a place whose pages are
 * a season's, that place's first page and its address without a season, where „Übersicht“ leads while the person's
 * records stand in no season.
 */
type Frame = {
  groups: RailGroup[];
  role?: Copy;
  saison?: Pick<PersonSaisons, "home" | "withoutSaison">;
  /** Whether the place holds an editor, so its route groups place the phone's band and bar. */
  columnInLayouts: boolean;
};

/**
 * The landing between a person's places, and the two places a person holds across every season. Each is one page
 * named „Übersicht“, so each keeps the frame with that entry alone, and a person holding several moves between them
 * through „Funktion wechseln“, as from a team's frame.
 */
const FRAMES = {
  landing: {
    groups: [{ entries: [{ id: "overview", label: ROUTES.area.title, href: ROUTES.area.path(), icon: "overview" }] }],
    columnInLayouts: false,
  },
  spieler: {
    groups: [{ entries: [{ id: "overview", label: ROUTES.spielerOverview.title, saison: "spielerOverview", icon: "overview" }] }],
    role: COPY.shared.spieler,
    saison: { home: "spielerOverview", withoutSaison: ROUTES.areaSpieler.path() },
    columnInLayouts: false,
  },
  schiedsrichter: {
    groups: [{ entries: [{ id: "overview", label: ROUTES.schiedsrichterOverview.title, saison: "schiedsrichterOverview", icon: "overview" }] }],
    role: COPY.shared.schiedsrichter,
    saison: { home: "schiedsrichterOverview", withoutSaison: ROUTES.areaSchiedsrichter.path() },
    columnInLayouts: true,
  },
} as const satisfies Record<string, Frame>;

const BAR = ["overview"] as const;

/** One season a person's own records stand in, as the seasons read of their place serves it, the newest first. */
type OwnSaison = { id: string; start_date: string; end_date: string };

/**
 * Session 8: a pupil's and a referee's seasons are their place's own read, `GET /spieler/self/saisons` and
 * `GET /schiedsrichter/self/saisons`: the seasons their squad rows and their fixtures stand in. Until the generated
 * client holds the two, the one season the site is on.
 */
async function readOwnSaisons(): Promise<OwnSaison[]> {
  const { saisons, active_saison_id: active } = await getSaisonFrame();
  return saisons.filter((saison) => saison.id === active);
}

/**
 * The seasons a place's season button offers and the one its „Übersicht“ leads to: the season the site is on where
 * the person's records stand in it, else their newest; `null` where they stand in none. A session turned away and a
 * person holding no such Funktion are shown none, without a read: their page sends them on, and a read the backend
 * refuses here would fail the frame around that redirect.
 */
async function readSeasons(kind: "spieler" | "schiedsrichter"): Promise<Saisons | null> {
  const subject = await getSubjectSession();
  if (subject === null || !rolesOf(subject).roles.some((role) => role.kind === kind)) return null;

  const own = await readOwnSaisons();
  const [newest] = own;
  if (newest === undefined) return null;
  const { active_saison_id: running } = await getSaisonFrame();
  return {
    entries: own.map((saison) => ({ id: saison.id, span: formatPeriod(dayOf(saison.start_date), dayOf(saison.end_date)) })),
    standard: own.find((saison) => saison.id === running)?.id ?? newest.id,
  };
}

/**
 * The frame of a person's own pages, one for each place, each a layout of its own: a frame takes one menu and one
 * list of seasons, and the three differ in both. A place's frame stands above the season of its address, whose
 * subtree Next keys on its value, so a season switch remounts the page alone and keeps the frame. It is drawn without
 * waiting for the session, the seasons and the account streaming into their places, and judges no page: each page's
 * read asks who the person is itself (`fl_frontend/src/features/roles/resolvers.ts :: requireRole`).
 */
export function PersonFrame({ place, children }: { place: keyof typeof FRAMES; children: ReactNode }) {
  const frame: Frame = FRAMES[place];
  return (
    // A failed read of the frame's own is answered in the rail frame: the place's `error.tsx` stands inside its layout.
    <RailFrameBoundary
      groups={frame.groups}
      bar={BAR}
      next={AREA_HOME}>
      <RailFrame
        groups={frame.groups}
        bar={BAR}
        saison={place === "landing" ? undefined : { saisons: readSeasons(place), ...FRAMES[place].saison }}
        foot={{ kind: "account", account: readAccount(frame.role) }}
        columnInLayouts={frame.columnInLayouts}>
        {children}
      </RailFrame>
    </RailFrameBoundary>
  );
}
