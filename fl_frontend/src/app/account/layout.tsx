import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { readAccount, readAreaBack } from "@/features/account/account";
import { GuardedRailFrame } from "@/kit/GuardedRailFrame";

import { ACCOUNT_ENTRIES } from "./entries";

import type { ReactNode } from "react";

const GROUPS = [{ entries: ACCOUNT_ENTRIES }];

/**
 * Konto's frame, in place of the area's: its own rail of its three pages, „‹ Zurück“ in the logo's place leading to
 * the area's page Konto was opened from, or to the Übersicht after a reload, and no bottom bar, the phone opening on
 * the list of the three instead. A person holding no Funktion keeps the logo: the Übersicht sends them here. The
 * account row and the way back arrive with the page, and each page's own read sends a session turned away to sign in.
 * On a phone the list's band leads where the rail's head does, and a page's to the list, the place its route declares.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    // A failed read of the frame's own is answered in the rail frame: Konto's `error.tsx` stands inside this layout.
    <GuardedRailFrame
      groups={GROUPS}
      bar={["signin"]}
      foot={{ kind: "account", account: readAccount(COPY.template.account) }}
      back={{ read: readAreaBack(), failed: ROUTES.area.path() }}>
      {children}
    </GuardedRailFrame>
  );
}
