import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { readAccount } from "@/features/account/account";
import { getOwnSaisons } from "@/features/roles/queries";
import { GuardedRailFrame } from "@/kit/GuardedRailFrame";

import type { Copy } from "@/core/copy";
import type { FrameSaisons, RailGroup } from "@/kit/FrameNav";
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
};

/**
 * The landing between a person's places, and the two places a person holds across every season. Each is one page
 * named „Übersicht“, so each keeps the frame with that entry alone, and a person holding several moves between them
 * through „Funktion wechseln“, as from a team's frame.
 */
const FRAMES = {
  landing: {
    groups: [{ entries: [{ id: "overview", label: ROUTES.areaRoles.title, href: ROUTES.area.path(), icon: "overview" }] }],
  },
  spieler: {
    groups: [{ entries: [{ id: "overview", label: ROUTES.spielerOverview.title, saison: "spielerOverview", icon: "overview" }] }],
    role: COPY.shared.spieler,
    saison: { home: "spielerOverview", withoutSaison: ROUTES.areaSpieler.path() },
  },
  schiedsrichter: {
    groups: [{ entries: [{ id: "overview", label: ROUTES.schiedsrichterOverview.title, saison: "schiedsrichterOverview", icon: "overview" }] }],
    role: COPY.shared.schiedsrichter,
    saison: { home: "schiedsrichterOverview", withoutSaison: ROUTES.areaSchiedsrichter.path() },
  },
} as const satisfies Record<string, Frame>;

const BAR = ["overview"] as const;

/**
 * The frame of a person's own pages, one for each place, each a layout of its own: a frame takes one menu and one
 * list of seasons, and the three differ in both. A place's frame stands above the season of its address, whose
 * subtree Next keys on its value, so a season switch remounts the page alone and keeps the frame. Its seasons and the
 * account are handed down as reads still running, beside each page's own, and it judges no page: each page's read asks
 * who the person is itself. A place's seasons are a read of its own, which its pages share.
 */
export function PersonFrame({ place, children }: { place: keyof typeof FRAMES; children: ReactNode }) {
  const frame: Frame = FRAMES[place];
  return (
    // A failed read of the frame's own is answered in the rail frame: the place's `error.tsx` stands inside its layout.
    <GuardedRailFrame
      groups={frame.groups}
      bar={BAR}
      saison={place === "landing" ? undefined : { saisons: getOwnSaisons(place), ...FRAMES[place].saison }}
      foot={{ kind: "account", account: readAccount(frame.role) }}>
      {children}
    </GuardedRailFrame>
  );
}
