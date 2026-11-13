import { RailFrame } from "@/kit/RailFrame";
import { RailFrameBoundary } from "@/kit/RailFrameBoundary";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { readAccount, readAreaBack } from "@/features/account/account";

import { ACCOUNT_ENTRIES, ACCOUNT_HOME } from "./entries";

import type { ReactNode } from "react";

const GROUPS = [{ entries: ACCOUNT_ENTRIES }];

/**
 * Konto's frame, in place of the area's: its own rail of its four pages, „‹ Zurück“ in the logo's place leading to
 * the Übersicht, and no bottom bar, the phone opening on the list of the four instead. A person holding no Funktion
 * keeps the logo: the Übersicht sends them here. The account row and the way back arrive with the page, and each page's
 * own read sends a session turned away to sign in.
 * The phone's band is the route groups' (`(list)`, `(pages)`), since its way back differs: the list's to the
 * Übersicht, a page's to the list.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    // A failed read of the frame's own is answered in the rail frame: Konto's `error.tsx` stands inside this layout.
    <RailFrameBoundary
      groups={GROUPS}
      bar={["signin"]}
      next={ACCOUNT_HOME}
      back={ROUTES.area.path()}>
      <RailFrame
        groups={GROUPS}
        bar={["signin"]}
        foot={{ kind: "account", account: readAccount(COPY.template.account) }}
        back={readAreaBack()}
        columnInLayouts>
        {children}
      </RailFrame>
    </RailFrameBoundary>
  );
}
