import { RailFrame } from "@/kit/RailFrame";
import { RailFrameBoundary } from "@/kit/RailFrameBoundary";

import { COPY } from "@/core/copy";
import { dayOf, formatPeriod } from "@/core/format";
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
 * a season's, that place's first page and its address without a season.
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

/**
 * Session 8: a place's seasons are the ones the person's own read names, a pupil's squad rows and a referee's matches,
 * the newest first, and `null` where it names none. Until that read stands, the one season the site is on.
 */
async function readSeasons(): Promise<Saisons | null> {
  // A session turned away is shown no season; its page sends it to sign in.
  if ((await getSubjectSession()) === null) return null;
  const { saisons, active_saison_id: active } = await getSaisonFrame();
  const running = saisons.find((saison) => saison.id === active);
  if (running === undefined) return null;
  return {
    entries: [{ id: running.id, span: formatPeriod(dayOf(running.start_date), dayOf(running.end_date)) }],
    standard: running.id,
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
        saison={frame.saison === undefined ? undefined : { saisons: readSeasons(), ...frame.saison }}
        foot={{ kind: "account", account: readAccount(frame.role) }}
        columnInLayouts={frame.columnInLayouts}>
        {children}
      </RailFrame>
    </RailFrameBoundary>
  );
}
